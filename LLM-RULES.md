# FDS SKU Resolver LLM Rules

Use this MCP for product lookup, family rule retrieval, and BOM rule retrieval.

Rules:

- Do not invent SQL or bypass the MCP with direct backend calls.
- Always resolve family first.
- Then resolve subtype.
- Then apply only filters allowed for that subtype.
- Use `list_catalog_families` and `describe_catalog_family` to inspect the allowed structure.
- Use `resolve_catalog_query` before `lookup_catalog` when natural language needs to be normalized into a deterministic search plan.
- Use `get_catalog_options` when the result must be narrowed via valid dropdown-style choices.
- Use `lookup_product_by_sku` when SKU is already known.
- Use `get_family_rules` for family-specific lookup and quoting behavior.
- Use `get_bom_rules` once per family when computing components or quantity formulas.
- Treat family attribute lists as reference only, not as a hard restriction on what attributes may exist or be added elsewhere.
- Respect tool defaults and fixed unit assumptions handled by the server.
- If a lookup returns `guided` or `narrow`, use `facets` and `suggested_filter` to refine.
- Do not invent products that are not in lookup results.
- Treat `mode=exact` as authoritative.
- Keep follow-up lookups to the minimum needed to disambiguate.
- Never mix filters across subtypes.

Ask only when:

- the family is unknown
- two family tools are both plausible
- the user is asking for something outside the indexed pricing catalog

Do not ask for:

- fields the lookup tool can leave empty to return facets
- BOM rules when `get_bom_rules` can provide them
- duplicate-check SQL
