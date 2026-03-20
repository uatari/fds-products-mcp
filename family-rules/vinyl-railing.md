# Vinyl Railing Family Rules

- `unit_name=Section Kit` is the only valid section product type in current data.
- Any length-based railing request should force `unit_name=Section Kit`.
- Normalize:
  - `36"` -> `height_in=36`
  - `42"` -> `height_in=42`
  - `4/6/8/10 ft` -> `length_ft`
  - vinyl/aluminum -> `baluster_material`
  - square/round -> `baluster_shape`
  - black/white balusters -> `baluster_color`
- Do not invent unit types.
- Invalid combos should clarify instead of infer.
- Use lookup facets for browse-style questions.

