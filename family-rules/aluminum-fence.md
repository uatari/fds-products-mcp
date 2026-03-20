# Aluminum Fence Family Rules

- Normalize customer words before lookup:
  - section/fence section -> `unit_name=Panel`
  - gate -> `unit_name=Gate`
  - post -> `unit_name=Post`
  - 2-rail -> `style=Concord`
  - lex -> `style=Lexington`
  - charles -> `style=Charleston`
- Never pass raw customer words when a normalized token exists.
- For "what widths/heights/styles are available", omit that field and use facets.
- Gate widths live in `width_in`.
- Follow lookup `mode` strictly: `exact`, `full`, `guided`, `narrow`, `none`.

