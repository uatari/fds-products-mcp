# FDS Products MCP

Deterministic MCP server for product lookup, family rules, and BOM-rule retrieval.

Use this MCP for:

- product-adder duplicate checks
- on-the-fly quote lookups
- VAPI backend product resolution
- family-specific pricing search
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

- `lookup_product_by_sku`
- `fuzzy_find_products`
- `get_bom_rules`
- `get_family_rules`
- `lookup_vinyl_fence`
- `lookup_aluminum_fence`
- `lookup_vinyl_railing`
- `lookup_composite_decking`
- `lookup_temporary_fence`
- `lookup_chain_link_fence_mesh`
- `lookup_chain_link_fence_pipe`

## Response Shape

Family lookup tools return:

- `mode`: `none`, `exact`, `full`, `guided`, or `narrow`
- `total_count`
- `products`: up to 5 rows
- `facets` when result count is above 5
- `suggested_filter` when one facet best narrows the set

This keeps lookup behavior deterministic and reusable.

## Fuzzy Matching

Use `fuzzy_find_products` for duplicate checks or loose phrasing.

It scores candidates using:

- normalized name token overlap
- family and unit hints
- dimension matches from the query text

Example:

```json
{
  "query": "White Vinyl Privacy Fence 5'H x 6'W",
  "family_name": "vinyl-fence",
  "unit_name": "Panel"
}
```
