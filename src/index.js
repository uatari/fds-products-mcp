import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEnvFile() {
  const envPath = path.resolve(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const packageJson = readJson(path.resolve(projectRoot, "package.json"));
const gristApiBaseUrl = (process.env.GRIST_API_BASE_URL || "http://grist:8484").replace(/\/$/, "");
const gristDocId = process.env.GRIST_DOC_ID || "";
const gristApiKey = process.env.GRIST_API_KEY || "";
const relayUrl = (process.env.GRIST_RELAY_URL || process.env.N8N_GRIST_RELAY_URL || "").replace(/\/$/, "");
const relayApiKey = process.env.GRIST_RELAY_API_KEY || process.env.N8N_GRIST_RELAY_API_KEY || "";
const config = {
  ...readJson(path.resolve(projectRoot, "config/sku-resolver.config.json")),
  gristApiBaseUrl,
  gristDocId,
  gristApiKey,
  relayUrl,
  relayApiKey,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 60000),
  gristSqlTimeoutMs: Number(process.env.GRIST_SQL_TIMEOUT_MS || 1000),
  bomRootDir: path.isAbsolute(process.env.BOM_ROOT_DIR || "")
    ? process.env.BOM_ROOT_DIR
    : path.resolve(projectRoot, process.env.BOM_ROOT_DIR || "./boms"),
  familyRulesDir: path.isAbsolute(process.env.FAMILY_RULES_DIR || "")
    ? process.env.FAMILY_RULES_DIR
    : path.resolve(projectRoot, process.env.FAMILY_RULES_DIR || "./family-rules")
};
const catalogSchema = readJson(path.resolve(projectRoot, "config/catalog-schema.config.json"));

function quoteIdentifier(identifier) {
  if (!/^[\w .-]+$/.test(identifier)) throw new Error(`Unsafe identifier: ${identifier}`);
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function asFlatRecords(result) {
  return (result.records || []).map((record) => (record.fields ? { id: record.id, ...record.fields } : record));
}

function asTextResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function normalizeLimit(limit) {
  const max = Number(config.maxResults || 5);
  return Math.max(1, Math.min(Number(limit || max), max));
}

const toolConfigByName = new Map((config.familyTools || []).map((toolConfig) => [toolConfig.toolName, toolConfig]));
const familySchemaByName = new Map((catalogSchema.families || []).map((family) => [family.name, family]));
const familyNames = (catalogSchema.families || []).map((family) => family.name);

function normalizeResolverText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/["“”]/g, '"')
    .replace(/\bfeet\b/g, "ft")
    .replace(/\bfoot\b/g, "ft")
    .replace(/\binches\b/g, "in")
    .replace(/\binch\b/g, "in")
    .replace(/[^a-z0-9"'/. -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasEntries(aliases = []) {
  return Array.from(new Set((aliases || []).map((alias) => normalizeResolverText(alias)).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textHasAlias(text, alias) {
  if (!alias) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(alias)}([^a-z0-9]|$)`, "i").test(text);
}

function findAliasMatch(text, aliases = []) {
  const normalized = normalizeResolverText(text);
  for (const alias of aliasEntries(aliases)) {
    if (textHasAlias(normalized, alias)) return alias;
  }
  return null;
}

function getToolConfig(toolName) {
  const toolConfig = toolConfigByName.get(toolName);
  if (!toolConfig) throw new Error(`Unknown lookup tool config: ${toolName}`);
  return toolConfig;
}

function getFamilySchema(familyName) {
  const family = familySchemaByName.get(familyName);
  if (!family) throw new Error(`Unsupported family_name: ${familyName}`);
  return family;
}

function getSubtypeSchema(family, subtypeName) {
  const subtype = (family.subtypes || []).find((candidate) => candidate.name === subtypeName);
  if (!subtype) throw new Error(`Unsupported subtype_name: ${subtypeName} for family ${family.name}`);
  return subtype;
}

function resolveFamilyFromText(text) {
  const normalized = normalizeResolverText(text);
  const matches = [];
  for (const family of catalogSchema.families || []) {
    const match = findAliasMatch(normalized, [family.name, ...(family.aliases || [])]);
    if (match) matches.push({ family, alias: match });
  }
  if (matches.length !== 1) return null;
  return matches[0].family;
}

function resolveSubtypeFromText(family, text) {
  const normalized = normalizeResolverText(text);
  const matches = [];
  for (const subtype of family.subtypes || []) {
    const match = findAliasMatch(normalized, [subtype.name, ...(subtype.aliases || [])]);
    if (match) matches.push({ subtype, alias: match });
  }
  if (matches.length !== 1) return null;
  return matches[0].subtype;
}

function canonicalizeStringAlias(value, aliasMap = {}) {
  const normalized = normalizeResolverText(value);
  if (!normalized) return null;
  for (const [alias, canonical] of Object.entries(aliasMap || {})) {
    if (normalizeResolverText(alias) === normalized) return canonical;
  }
  return typeof value === "string" ? value.trim() : String(value);
}

function extractNumberCandidates(text) {
  const normalized = normalizeResolverText(text);
  const feetPair = normalized.match(/(\d+(?:\.\d+)?)\s*(?:ft|'|f)\s*x\s*(\d+(?:\.\d+)?)\s*(?:ft|'|f)?/i);
  const inchPair = normalized.match(/(\d+(?:\.\d+)?)\s*(?:in|")\s*x\s*(\d+(?:\.\d+)?)\s*(?:in|")?/i);
  const lengthFeet = normalized.match(/(\d+(?:\.\d+)?)\s*(?:ft|'|f)\b/i);
  const lengthInches = normalized.match(/(\d+(?:\.\d+)?)\s*(?:in|")\b/i);
  return {
    feetPair: feetPair ? [Number(feetPair[1]), Number(feetPair[2])] : null,
    inchPair: inchPair ? [Number(inchPair[1]), Number(inchPair[2])] : null,
    firstFeet: lengthFeet ? Number(lengthFeet[1]) : null,
    firstInches: lengthInches ? Number(lengthInches[1]) : null
  };
}

function extractDeterministicFilters(text, family, subtype) {
  const allowed = new Set(subtype.allowedFilters || []);
  const filterValues = {};
  const normalized = normalizeResolverText(text);
  const numeric = extractNumberCandidates(normalized);
  const mergedAliases = {
    ...(catalogSchema.globalFilterAliases || {}),
    ...(family.filterAliases || {}),
    ...(subtype.filterAliases || {})
  };

  for (const filterName of Object.keys(mergedAliases)) {
    if (!allowed.has(filterName)) continue;
    for (const [alias, canonical] of Object.entries(mergedAliases[filterName] || {})) {
      if (textHasAlias(normalized, normalizeResolverText(alias))) {
        filterValues[filterName] = canonical;
        break;
      }
    }
  }

  if (allowed.has("height_ft") && allowed.has("width_ft") && numeric.feetPair) {
    filterValues.height_ft = numeric.feetPair[0];
    filterValues.width_ft = numeric.feetPair[1];
  } else if (allowed.has("length_ft") && numeric.firstFeet != null) {
    filterValues.length_ft = numeric.firstFeet;
  } else if (allowed.has("height_ft") && numeric.firstFeet != null && !allowed.has("width_ft")) {
    filterValues.height_ft = numeric.firstFeet;
  }

  if (allowed.has("height_in") && allowed.has("width_in") && numeric.inchPair) {
    filterValues.height_in = numeric.inchPair[0];
    filterValues.width_in = numeric.inchPair[1];
  } else if (allowed.has("height_in") && numeric.firstInches != null && !allowed.has("width_in")) {
    filterValues.height_in = numeric.firstInches;
  } else if (allowed.has("width_in") && numeric.firstInches != null && !allowed.has("height_in")) {
    filterValues.width_in = numeric.firstInches;
  }

  return filterValues;
}

function coerceFilterValue(filterConfig, value, aliasMaps = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  if (filterConfig.type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }
  if (filterConfig.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (String(value).toLowerCase() === "true") return true;
    if (String(value).toLowerCase() === "false") return false;
    return undefined;
  }
  if (filterConfig.type === "boolean_string") {
    const resolved = boolStringToSql(value);
    return resolved === null ? undefined : resolved;
  }
  if (filterConfig.type === "string") {
    const aliasMap = aliasMaps[filterConfig.column || ""] || aliasMaps[filterConfig.name || ""] || {};
    return canonicalizeStringAlias(value, aliasMap);
  }
  return value;
}

function validateAndNormalizeFilters(toolConfig, family, subtype, filters = {}) {
  const allowedFilters = new Set(subtype.allowedFilters || []);
  const normalizedFilters = { ...(subtype.fixedFilters || {}) };
  const ignoredFilters = [];
  const aliasMaps = {
    ...(catalogSchema.globalFilterAliases || {}),
    ...(family.filterAliases || {}),
    ...(subtype.filterAliases || {})
  };

  for (const [filterName, rawValue] of Object.entries(filters || {})) {
    if (!allowedFilters.has(filterName)) {
      ignoredFilters.push(filterName);
      continue;
    }
    const filterConfig = toolConfig.filters?.[filterName];
    if (!filterConfig) {
      ignoredFilters.push(filterName);
      continue;
    }
    const value = coerceFilterValue({ ...filterConfig, name: filterName }, rawValue, aliasMaps);
    if (value === undefined) continue;
    normalizedFilters[filterName] = value;
  }

  return { filters: normalizedFilters, ignored_filters: ignoredFilters };
}

function applySubtypeDefaultsAndImplications(subtype, filters = {}) {
  const nextFilters = { ...(filters || {}) };
  const appliedDefaults = {};

  for (const [filterName, value] of Object.entries(subtype.defaultFilters || {})) {
    if (nextFilters[filterName] === undefined || nextFilters[filterName] === null || nextFilters[filterName] === "") {
      nextFilters[filterName] = value;
      appliedDefaults[filterName] = value;
    }
  }

  for (const rule of subtype.impliedFilters || []) {
    const conditions = rule.when || {};
    const matches = Object.entries(conditions).every(([filterName, expectedValue]) => nextFilters[filterName] === expectedValue);
    if (!matches) continue;
    for (const [filterName, value] of Object.entries(rule.apply || {})) {
      if (nextFilters[filterName] === undefined || nextFilters[filterName] === null || nextFilters[filterName] === "") {
        nextFilters[filterName] = value;
        appliedDefaults[filterName] = value;
      }
    }
  }

  return { filters: nextFilters, applied_defaults: appliedDefaults };
}

function resolveCatalogPlan({ query_text = "", family_name, subtype_name, filters = {} } = {}) {
  const normalizedText = normalizeResolverText(query_text);
  let family = null;
  let subtype = null;
  const resolution = {
    query_text,
    family_name: null,
    subtype_name: null,
    status: "unresolved",
    filters: {},
    fixed_filters: {},
    applied_defaults: {},
    ignored_filters: [],
    errors: []
  };

  if (family_name) {
    family = familySchemaByName.get(family_name) || null;
    if (!family) resolution.errors.push(`Unsupported family_name: ${family_name}`);
  } else if (normalizedText) {
    family = resolveFamilyFromText(normalizedText);
  }

  if (!family) {
    resolution.status = "needs_family";
    return resolution;
  }

  if (subtype_name) {
    subtype = (family.subtypes || []).find((candidate) => candidate.name === subtype_name) || null;
    if (!subtype) resolution.errors.push(`Unsupported subtype_name: ${subtype_name} for family ${family.name}`);
  } else if (normalizedText) {
    subtype = resolveSubtypeFromText(family, normalizedText);
  }
  if (!subtype && family.defaultSubtype) subtype = getSubtypeSchema(family, family.defaultSubtype);

  resolution.family_name = family.name;
  if (!subtype) {
    resolution.status = "needs_subtype";
    return resolution;
  }

  resolution.subtype_name = subtype.name;
  resolution.fixed_filters = { ...(subtype.fixedFilters || {}) };
  const toolConfig = getToolConfig(subtype.lookupToolName || family.lookupToolName);
  const deterministicFilters = extractDeterministicFilters(normalizedText, family, subtype);
  const { filters: normalizedFilters, ignored_filters } = validateAndNormalizeFilters(
    toolConfig,
    family,
    subtype,
    { ...deterministicFilters, ...(filters || {}) }
  );
  const { filters: finalFilters, applied_defaults } = applySubtypeDefaultsAndImplications(subtype, normalizedFilters);
  resolution.filters = finalFilters;
  resolution.applied_defaults = applied_defaults;
  resolution.ignored_filters = ignored_filters;
  resolution.status = resolution.errors.length ? "invalid" : "resolved";
  return resolution;
}

function familySummary(family) {
  return {
    family_name: family.name,
    family_code: family.familyCode,
    aliases: family.aliases || [],
    default_subtype: family.defaultSubtype || null,
    subtypes: (family.subtypes || []).map((subtype) => ({
      subtype_name: subtype.name,
      aliases: subtype.aliases || [],
      fixed_filters: subtype.fixedFilters || {},
      default_filters: subtype.defaultFilters || {},
      allowed_filters: subtype.allowedFilters || []
    }))
  };
}

function hasDirectGristConfig() {
  return Boolean(config.gristApiBaseUrl && config.gristDocId);
}

function hasRelayConfig() {
  return Boolean(config.relayUrl && config.relayApiKey);
}

function runtimeBackendLabel() {
  if (hasDirectGristConfig()) return `grist ${config.gristApiBaseUrl}/api/docs/${config.gristDocId}/sql`;
  if (hasRelayConfig()) return `relay ${config.relayUrl}`;
  return "unconfigured";
}

function failIfMissingRuntimeConfig() {
  const missing = [];
  if (hasDirectGristConfig() || hasRelayConfig()) return;
  missing.push("GRIST_DOC_ID + optional GRIST_API_KEY (preferred)", "or GRIST_RELAY_URL + GRIST_RELAY_API_KEY (legacy)");
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
}

async function relayFetch(payload) {
  const response = await fetch(config.relayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.relayApiKey
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Relay request failed (${response.status}): ${text}`);
  const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!envelope?.ok) throw new Error(`Relay returned malformed response: ${text}`);
  return envelope.response;
}

async function gristSqlFetch(sql, args = []) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (config.gristApiKey) headers.Authorization = `Bearer ${config.gristApiKey}`;
  const response = await fetch(`${config.gristApiBaseUrl}/api/docs/${encodeURIComponent(config.gristDocId)}/sql`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sql,
      args,
      timeout: Math.max(1, Math.min(Number(config.gristSqlTimeoutMs || 1000), Number(config.requestTimeoutMs || 60000)))
    }),
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Grist SQL request failed (${response.status}): ${text}`);
  return parsed;
}

async function runSql(sql, args = []) {
  const compact = String(sql || "").trim().replace(/^\(+/, "").trimStart().toUpperCase();
  if (!(compact.startsWith("SELECT") || compact.startsWith("WITH"))) {
    throw new Error("Only read-only SELECT/WITH SQL is allowed");
  }
  failIfMissingRuntimeConfig();
  if (hasDirectGristConfig()) {
    return gristSqlFetch(sql, args);
  }
  return relayFetch({ op: "sql_query", sql, args });
}

function boolStringToSql(value) {
  if (value === true || value === "true" || value === "yes") return true;
  if (value === false || value === "false" || value === "no") return false;
  return null;
}

function buildLookupWhere(toolConfig, query = {}) {
  const where = [];
  const args = [];
  where.push("family_code = ?");
  args.push(toolConfig.familyCode);

  for (const [inputKey, filter] of Object.entries(toolConfig.filters || {})) {
    if (filter.type === "constant") {
      where.push(`${filter.column || inputKey} = ?`);
      args.push(filter.value);
      continue;
    }
    let value = query[inputKey];
    if ((value === undefined || value === null || value === "") && Object.prototype.hasOwnProperty.call(filter, "default")) {
      value = filter.default;
    }
    if (filter.type === "string") {
      if (typeof value !== "string" || !value.trim()) continue;
      where.push(`LOWER(${filter.column || inputKey}) = LOWER(?)`);
      args.push(value.trim());
      continue;
    }
    if (filter.type === "number") {
      const numberValue = Number(value || 0);
      if (!Number.isFinite(numberValue) || numberValue === 0) continue;
      where.push(`${filter.column || inputKey} ${filter.operator || "="} ?`);
      args.push(numberValue);
      continue;
    }
    if (filter.type === "boolean") {
      if (typeof value !== "boolean") continue;
      where.push(`${filter.column || inputKey} = ?`);
      args.push(value);
      continue;
    }
    if (filter.type === "boolean_string") {
      const resolved = boolStringToSql(value);
      if (resolved === null) continue;
      where.push(`${filter.column || inputKey} = ?`);
      args.push(resolved);
    }
  }

  return { where, args };
}

function normalizeProductRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data) && value.data.length > 0) {
      const char = String.fromCharCode(value.data[0]).toUpperCase();
      if (["T", "Y", "1"].includes(char)) out[key] = true;
      else if (["F", "N", "0"].includes(char)) out[key] = false;
      else out[key] = value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function buildFacetSummary(records, facetFields, totalCount) {
  const facets = {};
  for (const row of records) {
    const field = row.field;
    const value = row.value;
    const cnt = Number(row.cnt || 0);
    if (!field || value === null || value === undefined || value === "") continue;
    if (!facetFields.includes(field)) continue;
    if (!facets[field]) facets[field] = { values: [], counts: [] };
    facets[field].values.push(value);
    facets[field].counts.push(cnt);
  }
  for (const field of Object.keys(facets)) {
    if (facets[field].values.length <= 1) delete facets[field];
  }
  let suggestedFilter = null;
  let bestScore = 0;
  for (const [field, data] of Object.entries(facets)) {
    const maxCount = Math.max(...data.counts);
    const score = 1 - maxCount / totalCount;
    if (score > bestScore && data.values.length >= 2) {
      bestScore = score;
      suggestedFilter = field;
    }
  }
  return { facets, suggested_filter: suggestedFilter };
}

async function executeFamilyLookup(toolConfig, query = {}) {
  const { where, args } = buildLookupWhere(toolConfig, query);
  const whereClause = ` WHERE ${where.join(" AND ")}`;
  const productColumns = toolConfig.productColumns.join(", ");
  const productsSql =
    `SELECT ${productColumns}, (SELECT COUNT(*) FROM ${config.pricingTable}${whereClause}) as total_count ` +
    `FROM ${config.pricingTable}${whereClause} ORDER BY ${toolConfig.defaultSort.join(", ")} LIMIT ${normalizeLimit(config.maxResults)}`;
  const productRows = asFlatRecords(await runSql(productsSql, [...args, ...args])).map(normalizeProductRecord);
  const totalCount = Number(productRows[0]?.total_count || 0);

  let mode = "none";
  if (totalCount === 1) mode = "exact";
  else if (totalCount > 1 && totalCount <= normalizeLimit(config.maxResults)) mode = "full";
  else if (totalCount > normalizeLimit(config.maxResults) && totalCount <= Number(config.maxFacetModeCount || 20)) mode = "guided";
  else if (totalCount > Number(config.maxFacetModeCount || 20)) mode = "narrow";

  const response = {
    mode,
    total_count: totalCount,
    products: productRows.slice(0, normalizeLimit(config.maxResults)).map(({ total_count, ...row }) => row)
  };

  if (totalCount > normalizeLimit(config.maxResults)) {
    const facetSql = toolConfig.facetFields.map((field) =>
      `SELECT '${field}' as field, ${field} as value, COUNT(*) as cnt FROM ${config.pricingTable}${whereClause} AND ${field} IS NOT NULL AND ${field} != '' GROUP BY ${field}`
    ).join(" UNION ALL ");
    const facetArgs = [];
    for (let i = 0; i < toolConfig.facetFields.length; i += 1) facetArgs.push(...args);
    const facetRows = asFlatRecords(await runSql(facetSql, facetArgs));
    const { facets, suggested_filter } = buildFacetSummary(facetRows, toolConfig.facetFields, totalCount);
    if (Object.keys(facets).length) {
      response.facets = facets;
      response.suggested_filter = suggested_filter;
    }
  }

  if (mode === "none") response.message = "No products found matching your criteria.";
  return response;
}

async function listFilterOptions(toolConfig, query = {}, facetFields = []) {
  const fields = (facetFields || []).filter((field) => toolConfig.facetFields.includes(field));
  if (!fields.length) return {};
  const { where, args } = buildLookupWhere(toolConfig, query);
  const whereClause = ` WHERE ${where.join(" AND ")}`;
  const facetSql = fields.map((field) =>
    `SELECT '${field}' as field, ${field} as value, COUNT(*) as cnt FROM ${config.pricingTable}${whereClause} AND ${field} IS NOT NULL AND ${field} != '' GROUP BY ${field}`
  ).join(" UNION ALL ");
  const facetArgs = [];
  for (let i = 0; i < fields.length; i += 1) facetArgs.push(...args);
  const facetRows = asFlatRecords(await runSql(facetSql, facetArgs));
  const options = {};
  for (const field of fields) options[field] = [];
  for (const row of facetRows) {
    if (!options[row.field]) options[row.field] = [];
    options[row.field].push({ value: row.value, count: Number(row.cnt || 0) });
  }
  for (const field of Object.keys(options)) {
    options[field].sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" }));
  }
  return options;
}

async function lookupCatalog(query = {}) {
  const plan = resolveCatalogPlan(query);
  if (plan.status !== "resolved") return plan;
  const family = getFamilySchema(plan.family_name);
  const subtype = getSubtypeSchema(family, plan.subtype_name);
  const toolConfig = getToolConfig(subtype.lookupToolName || family.lookupToolName);
  const result = await executeFamilyLookup(toolConfig, plan.filters);
  return {
    plan,
    ...result
  };
}

async function lookupProductBySku(sku) {
  const sql = `
    SELECT *
    FROM ${config.pricingTable}
    WHERE sku = ?
    LIMIT 1
  `;
  const rows = asFlatRecords(await runSql(sql, [sku])).map(normalizeProductRecord);
  return rows[0] || null;
}

function readBomRule(familyName) {
  const bomFamily = config.bomFamilies[familyName];
  if (!bomFamily) throw new Error(`Unsupported family_name: ${familyName}`);
  const filePath = path.resolve(config.bomRootDir, bomFamily.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`BOM file not found: ${filePath}`);
  }
  return {
    family_name: familyName,
    family_code: bomFamily.familyCode,
    file: filePath,
    rules_text: fs.readFileSync(filePath, "utf8")
  };
}

function readFamilyRule(familyName) {
  const fileName = config.familyRuleFiles?.[familyName];
  if (!fileName) throw new Error(`Unsupported family_name: ${familyName}`);
  const filePath = path.resolve(config.familyRulesDir, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Family rule file not found: ${filePath}`);
  }
  return {
    family_name: familyName,
    file: filePath,
    rules_text: fs.readFileSync(filePath, "utf8")
  };
}

function createServer() {
  const server = new McpServer({
    name: config.serverName || "fds-sku-resolver",
    version: packageJson.version || config.serverVersion || "0.1.0"
  });
  const familyNameEnum = z.enum(familyNames);
  const looseFiltersSchema = z.record(z.union([z.string(), z.number(), z.boolean()])).optional();

  server.tool(
    "lookup_product_by_sku",
    "Look up one product row in the pricing summary table by exact SKU.",
    { sku: z.string() },
    async ({ sku }) => {
      const record = await lookupProductBySku(sku);
      return asTextResult({ found: Boolean(record), product: record });
    }
  );

  server.tool(
    "list_catalog_families",
    "List supported catalog families and their deterministic subtype/filter structure.",
    {},
    async () => asTextResult({
      families: (catalogSchema.families || []).map(familySummary)
    })
  );

  server.tool(
    "describe_catalog_family",
    "Return the subtype structure, aliases, and allowed filters for one catalog family.",
    { family_name: familyNameEnum },
    async ({ family_name }) => asTextResult(familySummary(getFamilySchema(family_name)))
  );

  server.tool(
    "resolve_catalog_query",
    "Resolve natural language into a validated search plan: family, subtype, valid filters, and ignored filters.",
    {
      query_text: z.string().optional(),
      family_name: familyNameEnum.optional(),
      subtype_name: z.string().optional(),
      filters: looseFiltersSchema
    },
    async ({ query_text, family_name, subtype_name, filters }) => asTextResult(
      resolveCatalogPlan({ query_text, family_name, subtype_name, filters })
    )
  );

  server.tool(
    "get_catalog_options",
    "Return valid option lists for the filters supported by one resolved family/subtype path.",
    {
      family_name: familyNameEnum,
      subtype_name: z.string().optional(),
      query_text: z.string().optional(),
      filters: looseFiltersSchema
    },
    async ({ family_name, subtype_name, query_text, filters }) => {
      const plan = resolveCatalogPlan({ family_name, subtype_name, query_text, filters });
      if (plan.status !== "resolved") return asTextResult(plan);
      const family = getFamilySchema(plan.family_name);
      const subtype = getSubtypeSchema(family, plan.subtype_name);
      const toolConfig = getToolConfig(subtype.lookupToolName || family.lookupToolName);
      const options = await listFilterOptions(toolConfig, plan.filters, subtype.allowedFilters || []);
      return asTextResult({
        plan,
        options
      });
    }
  );

  server.tool(
    "lookup_catalog",
    "Execute a validated catalog lookup after resolving family, subtype, and allowed filters.",
    {
      query_text: z.string().optional(),
      family_name: familyNameEnum.optional(),
      subtype_name: z.string().optional(),
      filters: looseFiltersSchema
    },
    async ({ query_text, family_name, subtype_name, filters }) => asTextResult(
      await lookupCatalog({ query_text, family_name, subtype_name, filters })
    )
  );

  server.tool(
    "get_bom_rules",
    "Return BOM rules text for one allowed family from local repo files.",
    { family_name: familyNameEnum },
    async ({ family_name }) => asTextResult(readBomRule(family_name))
  );

  server.tool(
    "get_family_rules",
    "Return family-specific lookup and quoting rules for one allowed family.",
    { family_name: familyNameEnum },
    async ({ family_name }) => asTextResult(readFamilyRule(family_name))
  );

  return server;
}
async function main() {
  failIfMissingRuntimeConfig();
  const port = parseInt(process.env.MCP_PORT || "8000", 10);
  const apiKey = process.env.MCP_API_KEY || "";

  const httpServer = http.createServer(async (req, res) => {
    if (apiKey && req.headers["x-api-key"] !== apiKey) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    if (req.url !== "/mcp" || (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(port, () => {
    process.stderr.write(`${config.serverName || packageJson.name} MCP ${packageJson.version} listening on :${port}/mcp via ${runtimeBackendLabel()}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
