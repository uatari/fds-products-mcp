# Families Update Plan

## Goal

Expand the MCP to support more product families and their BOMs without repeating hard-coded family lists across the server, docs, and downstream resolver prompts.

## Current Constraints

- Lookup tools are mostly config-driven in `config/sku-resolver.config.json`.
- BOM families and family-rule files are config-driven in `config/sku-resolver.config.json`.
- `src/index.js` still hard-codes allowed `family_name` values for:
  - `fuzzy_find_products`
  - `get_bom_rules`
  - `get_family_rules`
- `README.md` and downstream resolver prompts may also hard-code the currently supported families and lookup tools.

## Target Outcome

Adding a new family should require:

1. Adding config entries in `config/sku-resolver.config.json`
2. Adding one BOM file in `boms/`
3. Adding one family rules file in `family-rules/`
4. Updating downstream prompts/docs only where unavoidable

Server code should not need family-specific edits for each new family.

## Implementation Plan

### Phase 1: Remove Hard-Coded Family Enums

Update `src/index.js` so allowed `family_name` values are derived from config instead of hand-written enums.

Scope:

- Build a shared list from `Object.keys(config.bomFamilies)` and `Object.keys(config.familyRuleFiles)`
- Use that list to construct the zod enum for:
  - `fuzzy_find_products`
  - `get_bom_rules`
  - `get_family_rules`

Reason:

- Right now new families must be added in both config and code
- This is the main maintenance bottleneck

### Phase 2: Define Family Addition Contract

For each new family, define whether it is:

- a standalone family with its own BOM
- a shared BOM family with multiple lookup tools

Recommended rule:

- Use one BOM family when multiple lookup tools share the same install logic
- Split into separate BOM families only when quantity formulas, defaults, or required components differ materially

Example:

- `chainlink-fence` is one BOM family
- `lookup_chain_link_fence_mesh` and `lookup_chain_link_fence_pipe` are separate lookup tools under that family

### Phase 3: Add Config Entries Per New Family

For each new family or lookup surface:

1. Add a `familyTools[]` entry when a dedicated lookup tool is needed
2. Add a `bomFamilies` entry when BOM logic exists
3. Add a `familyRuleFiles` entry when family-specific guidance exists

Each `familyTools[]` entry should define:

- `toolName`
- `description`
- `familyCode`
- `productColumns`
- `facetFields`
- `filters`
- `defaultSort`

### Phase 4: Add BOM Files

Create one markdown file per BOM family in `boms/`.

Standard BOM structure:

1. Family name and purpose
2. Required inputs
3. Defaults and assumptions
4. Quantity formulas
5. Component list
6. Lookup tool to use for each component
7. Fallback behavior when no SKU is found

This keeps BOM parsing consistent for the resolver agent.

### Phase 5: Add Family Rule Files

Create one markdown file per family in `family-rules/`.

Standard family rule structure:

1. Which lookup tool(s) to use
2. Common defaults
3. Guardrails for quoting
4. Important product compatibility rules
5. Follow-up question rules

These files should remain advisory, not schema ceilings.

### Phase 6: Update Downstream Consumers

After the MCP supports the new families, update the downstream references that still enumerate family names or lookup tools.

Files to update:

- `README.md`
- `LLM-RULES.md`
- any external resolver prompt or workflow that lists exact supported families/tools

Important:

- Downstream resolver prompts may still list allowed family names and lookup tools explicitly
- If MCP support is added without prompt updates, the agent may still avoid the new families

### Phase 7: Add Validation

Add a lightweight startup validation or test script that checks:

- every `bomFamilies` file exists
- every `familyRuleFiles` file exists
- every `familyTools[]` entry has required fields
- every BOM references valid lookup tool names
- every family listed for resolver use is present in config

This prevents silent drift between config, markdown files, and prompts.

## Recommended Rollout Order

1. Refactor `src/index.js` to derive family enums from config
2. Add the next highest-priority families and BOMs
3. Update resolver prompts and documentation
4. Add validation so future family additions are mostly config + markdown

## Checklist For Each New Family

- Add lookup tool config in `config/sku-resolver.config.json` if needed
- Add BOM family entry in `config/sku-resolver.config.json` if needed
- Add family rules entry in `config/sku-resolver.config.json`
- Add `boms/<family>.md`
- Add `family-rules/<family>.md`
- Update `README.md`
- Update `LLM-RULES.md`
- Update any external resolver prompt or workflow configuration
- Verify lookup returns sensible `mode`, `products`, and `facets`
- Verify BOM retrieval works for the exact `family_name`

## Decision Rules For New Families

- If products share the same quantity formulas and install logic, keep them under one BOM family
- If products need different formulas, defaults, or component breakdowns, create separate BOM families
- If a family needs different lookup behavior for different component classes, split lookup tools but keep one BOM family when possible

## End State

The desired end state is a config-first MCP where:

- lookup tools are declared in config
- BOM families are declared in config
- family rules are file-backed and config-mapped
- resolver prompts are aligned with config
- new family onboarding is predictable and low-risk
