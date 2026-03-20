# BOM: Chain Link Fence

**Family:** chainlink-fence
**Purpose:** Resolve posts and top rail from mesh length and height.

---

## Assumptions (defaults)

| Setting | Default |
|---------|---------|
| Post spacing | 10 ft |
| Terminal posts | 2 |
| Corner posts | 0 |
| Top rail | included |
| Gates | 0 |

---

## Lookup Defaults

**Mesh**
- `unit_name=Mesh`
- `mesh_type=2 x 9` unless explicitly specified

**Pipe**
- `unit_name=Pipe`
- `wall_thickness=0.065`
- `material_grade=Resi`
- color follows mesh:
  - `Black/Green` mesh -> `Black` pipe
  - `Galv` mesh -> `Galv` pipe

**Top Rail**
- `pipe_diameter_label=1-3/8"`
- `length_ft=21`
- `end_type=SE`

---

## Diameter by Height

| Height | Line Posts | Terminal Posts | Corner Posts |
|--------|------------|----------------|--------------|
| `>= 6 ft` | `2-1/2"` | `3"` | `3"` |
| `< 6 ft` | `2"` | `2-1/2"` | `2-1/2"` |

---

## Quantity Formulas

| Component | Formula |
|-----------|---------|
| Line posts | `max(0, ceil(L_ft / 10) - 1)` |
| Terminal posts | `2` |
| Corner posts | `0` |
| Top rail sticks | `ceil(L_ft / 21)` |

---

## Components to Generate

### Line Posts
- **Lookup:** `lookup_chain_link_fence_pipe`
- **Params:** `pipe_diameter_label={by height}`, `length_ft={H_FT + 2}`
- **Qty formula:** `line_posts_qty`

### Terminal Posts
- **Lookup:** `lookup_chain_link_fence_pipe`
- **Params:** `pipe_diameter_label={by height}`, `length_ft={H_FT + 2}`
- **Qty formula:** `terminal_posts_qty`

### Top Rail
- **Lookup:** `lookup_chain_link_fence_pipe`
- **Params:** `pipe_diameter_label=1-3/8"`, `length_ft=21`, `end_type=SE`
- **Qty formula:** `top_rail_sticks_qty`

---

## Guardrails

- Never pass `length_ft` to mesh lookups.
- Keep diameter fixed when relaxing terminal post lookup.
- Relax grade before diameter or length.

