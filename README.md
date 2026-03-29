# FDS Products MCP

Deterministic MCP server for product lookup, family rules, and BOM-rule retrieval.

Use this MCP for:

- on-the-fly quote lookups
- VAPI backend product resolution
- family-specific pricing search via resolver -> validated lookup
- family rule retrieval from repo files
- BOM rule retrieval from repo files

Family rules and attribute lists are advisory:

- they help the LLM choose common lookup facets
- they do not define a hard schema ceiling for product attributes elsewhere in the system

## Runtime

Required env:

- Preferred:
  - `GRIST_API_BASE_URL`
  - `GRIST_DOC_ID`
  - `GRIST_API_KEY` if the document is not public to the MCP container
- Legacy fallback:
  - `GRIST_RELAY_URL`
  - `GRIST_RELAY_API_KEY`

Optional:

- `GRIST_SQL_TIMEOUT_MS` default `1000`
- `BOM_ROOT_DIR` default `./boms`
- `FAMILY_RULES_DIR` default `./family-rules`
- `REQUEST_TIMEOUT_MS` default `60000`

The server prefers direct Grist SQL via `POST /api/docs/{docId}/sql`. It falls back to the relay only when direct Grist settings are not configured.

## Install

```bash
cd /Users/dimi3/workflows/fds-sku-resolver-mcp
npm install
```

## Launch

```bash
node src/index.js
```

## Main Tools

- `list_catalog_families`
- `describe_catalog_family`
- `resolve_catalog_query`
- `get_catalog_options`
- `lookup_catalog`
- `lookup_product_by_sku`
- `get_bom_rules`
- `get_family_rules`

## Response Shape

Family lookup tools return:

- `mode`: `none`, `exact`, `full`, `guided`, or `narrow`
- `total_count`
- `products`: up to 5 rows
- `facets` when result count is above 5
- `suggested_filter` when one facet best narrows the set

This keeps lookup behavior deterministic and reusable.

## Search Flow

The resolver-based flow is:

1. `list_catalog_families`
2. `describe_catalog_family`
3. `resolve_catalog_query`
4. `get_catalog_options` if more narrowing is needed
5. `lookup_catalog`

The server always resolves family first, then subtype, then validates filters against that subtype before querying.
