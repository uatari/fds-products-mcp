# Temporary Fence Family Rules

- Normalize:
  - section/panel -> `unit_name=Section`
  - stand/base -> `unit_name=Stand`
  - clamp/coupler -> `unit_name=Clamp`
  - hardware -> `unit_name=Hardware`
- For section dimensions, parse `height x width` into `height_ft` and `width_ft`.
- If panel size is discussed, force `unit_name=Section`.
- Do not apply section dimensions to stands or clamps.
- Use lookup `mode` and facets to narrow when needed.

