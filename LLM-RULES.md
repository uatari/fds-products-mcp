# FDS SKU Resolver LLM Rules

Use this MCP for product lookup, family rule retrieval, and BOM rule retrieval.

Rules:

- Do not invent SQL or bypass the MCP with direct relay calls.
- Use the family-specific lookup tool that matches the product family.
- Use `lookup_product_by_sku` when SKU is already known.
- Use `fuzzy_find_products` for duplicate checks or when the user phrasing is loose.
- Use `get_family_rules` for family-specific lookup and quoting behavior.
- Use `get_bom_rules` once per family when computing components or quantity formulas.
- Treat family attribute lists as reference only, not as a hard restriction on what attributes may exist or be added elsewhere.
- Respect tool defaults and fixed unit assumptions handled by the server.
- If a lookup returns `guided` or `narrow`, use `facets` and `suggested_filter` to refine.
- Do not invent products that are not in lookup results.
- Treat `mode=exact` as authoritative.
- Keep follow-up lookups to the minimum needed to disambiguate.

Ask only when:

- the family is unknown
- two family tools are both plausible
- the user is asking for something outside the indexed pricing catalog

Do not ask for:

- fields the lookup tool can leave empty to return facets
- BOM rules when `get_bom_rules` can provide them
- duplicate-check SQL
