import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/["“”]/g, '"')
    .replace(/\ball white\b/g, "white")
    .replace(/\bsections?\b/g, "panel")
    .replace(/\bpanels?\b/g, "panel")
    .replace(/\bgates?\b/g, "gate")
    .replace(/\bposts?\b/g, "post")
    .replace(/\bprivacy fence\b/g, "privacy")
    .replace(/[^a-z0-9"' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(value) {
  const stop = new Set(["x", "for", "with", "the", "and", "all", "ft", "in"]);
  return Array.from(new Set(
    normalizeSearchText(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token && !stop.has(token))
  ));
}

function normalizeUnitHint(value) {
  const normalized = normalizeSearchText(value);
  const map = {
    panel: "section",
    section: "section",
    "section kit": "section kit",
    gate: "gate",
    post: "post",
    board: "board",
    mesh: "mesh",
    pipe: "pipe",
    hardware: "hardware",
    stand: "stand",
    clamp: "clamp",
    "fascia board": "fascia board"
  };
  return map[normalized] || normalized;
}

function inferProductClass(text) {
  const normalized = normalizeSearchText(text);
  if (/\bpost\b/.test(normalized)) return "post";
  if (/\bgate\b/.test(normalized)) return "gate";
  if (/\bpanel\b|\bsection\b|\bfence\b/.test(normalized)) return "panel";
  if (/\bboard\b|\bfascia\b/.test(normalized)) return "board";
  if (/\bmesh\b/.test(normalized)) return "mesh";
  if (/\bpipe\b|\brail\b/.test(normalized)) return "pipe";
  return "";
}

function extractDimensions(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const out = {};
  const feetPair = normalized.match(/(\d+(?:\.\d+)?)\s*['hH]?\s*x\s*(\d+(?:\.\d+)?)\s*['wW]?/);
  if (feetPair) {
    out.height_ft = Number(feetPair[1]);
    out.width_ft = Number(feetPair[2]);
  }
  const inchTriple = normalized.match(/(\d+(?:\.\d+)?)\s*"\s*x\s*(\d+(?:\.\d+)?)\s*"\s*x\s*(\d+(?:\.\d+)?)\s*'/);
  if (inchTriple) {
    out.thickness_in = Number(inchTriple[1]);
    out.width_in = Number(inchTriple[2]);
    out.length_ft = Number(inchTriple[3]);
  }
  return out;
}

function scoreCandidate(query, candidate) {
  const queryTokens = searchTokens(query.query);
  const queryDims = extractDimensions(query.query);
  const candidateText = `${candidate.name || ""} ${candidate.unit_name || ""} ${candidate.color || ""} ${candidate.design || ""}`;
  const candidateTokens = new Set(searchTokens(candidateText));
  const reasons = [];
  let score = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += 1;
      reasons.push(`token:${token}`);
    }
  }

  if (query.family_name && Number(candidate.family_code) === Number(query.family_code || 0)) {
    score += 2;
    reasons.push("family");
  }

  const queryUnit = normalizeUnitHint(query.unit_name || "");
  const candidateUnit = normalizeUnitHint(candidate.unit_name || "");
  if (queryUnit && queryUnit === candidateUnit) {
    score += 2;
    reasons.push("unit");
  } else if (queryUnit && candidateUnit.includes(queryUnit)) {
    score += 1;
    reasons.push("unit_partial");
  }

  const queryClass = inferProductClass(`${query.query} ${query.unit_name || ""}`);
  const candidateClass = inferProductClass(`${candidate.name || ""} ${candidate.unit_name || ""}`);
  if (queryClass && candidateClass) {
    if (queryClass === candidateClass) {
      score += 3;
      reasons.push("class");
    } else {
      score -= 4;
    }
  }

  const numericFields = ["height_ft", "width_ft", "height_in", "length_ft", "width_in"];
  for (const field of numericFields) {
    if (queryDims[field] == null) continue;
    if (candidate[field] == null || candidate[field] === "") {
      score -= 1;
      continue;
    }
    if (Number(candidate[field]) === Number(queryDims[field])) {
      score += 3;
      reasons.push(`dim:${field}`);
    } else {
      score -= 2;
    }
  }

  if (query.query && normalizeSearchText(candidate.name || "").includes(normalizeSearchText(query.query))) {
    score += 3;
    reasons.push("name_contains_query");
  }

  return { score, reasons };
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

async function fuzzyFindProducts({ query, family_name, unit_name, limit = 10 }) {
  const familyCode = family_name ? config.bomFamilies?.[family_name]?.familyCode || null : null;
  const tokens = searchTokens(query).slice(0, 6);
  const baseWhere = [];
  const baseArgs = [];
  if (familyCode) {
    baseWhere.push("family_code = ?");
    baseArgs.push(familyCode);
  }
  baseWhere.push("active = ?");
  baseArgs.push(true);
  const tokenWhere = [...baseWhere];
  const tokenArgs = [...baseArgs];
  if (tokens.length) {
    tokenWhere.push(`(${tokens.map(() => "LOWER(name) LIKE LOWER(?)").join(" OR ")})`);
    tokenArgs.push(...tokens.map((token) => `%${token}%`));
  }
  const baseSelect = `
    SELECT sku, family_code, name, price, unit_name, color, design, height_ft, width_ft, height_in, width_in, length_ft, vendor_sku, note
    FROM ${config.pricingTable}
  `;
  let rows = asFlatRecords(await runSql(`${baseSelect} WHERE ${tokenWhere.join(" AND ")} LIMIT 200`, tokenArgs)).map(normalizeProductRecord);
  if (!rows.length) {
    rows = asFlatRecords(await runSql(`${baseSelect} WHERE ${baseWhere.join(" AND ")} LIMIT 500`, baseArgs)).map(normalizeProductRecord);
  }
  const scored = rows
    .map((row) => {
      const { score, reasons } = scoreCandidate({ query, family_name, family_code: familyCode, unit_name }, row);
      return { ...row, score, reasons };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.name || "").localeCompare(String(b.name || "")))
    .slice(0, Math.max(1, Math.min(Number(limit || 10), 20)));
  return {
    query,
    family_name: family_name || null,
    unit_name: unit_name || null,
    candidates: scored
  };
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

const server = new McpServer({
  name: config.serverName || "fds-sku-resolver",
  version: packageJson.version || config.serverVersion || "0.1.0"
});

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
  "fuzzy_find_products",
  "Find likely matching products when the wording differs. Use for duplicate checks and loose customer phrasing.",
  {
    query: z.string(),
    family_name: z.enum(["aluminum-fence", "chainlink-fence", "composite-board", "vinyl-fence", "vinyl-railing", "temporary-fence"]).optional(),
    unit_name: z.string().optional(),
    limit: z.number().int().min(1).max(20).optional()
  },
  async ({ query, family_name, unit_name, limit }) => asTextResult(await fuzzyFindProducts({ query, family_name, unit_name, limit }))
);

server.tool(
  "get_bom_rules",
  "Return BOM rules text for one allowed family from local repo files.",
  { family_name: z.enum(["aluminum-fence", "chainlink-fence", "composite-board", "vinyl-fence", "vinyl-railing", "temporary-fence"]) },
  async ({ family_name }) => asTextResult(readBomRule(family_name))
);

server.tool(
  "get_family_rules",
  "Return family-specific lookup and quoting rules for one allowed family.",
  { family_name: z.enum(["aluminum-fence", "chainlink-fence", "composite-board", "vinyl-fence", "vinyl-railing", "temporary-fence"]) },
  async ({ family_name }) => asTextResult(readFamilyRule(family_name))
);

for (const toolConfig of config.familyTools) {
  const schemaShape = {};
  for (const [inputKey, filter] of Object.entries(toolConfig.filters || {})) {
    if (filter.type === "constant") continue;
    if (filter.type === "number") schemaShape[inputKey] = z.number().optional();
    else if (filter.type === "boolean") schemaShape[inputKey] = z.boolean().optional();
    else if (filter.type === "boolean_string") schemaShape[inputKey] = z.union([z.literal("yes"), z.literal("no"), z.string()]).optional();
    else schemaShape[inputKey] = z.string().optional();
  }
  server.tool(
    toolConfig.toolName,
    toolConfig.description,
    schemaShape,
    async (query) => asTextResult(await executeFamilyLookup(toolConfig, query))
  );
}

async function main() {
  failIfMissingRuntimeConfig();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${config.serverName || packageJson.name} MCP ${packageJson.version} running on stdio via ${runtimeBackendLabel()}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
