# BOM: Aluminum Fence

**Family:** aluminum-fence
**Purpose:** Resolve posts needed from panel count.

---

## Fixed Facts

| Fact | Value |
|------|-------|
| Color | Black (always) |
| Panel width | 6 ft |
| Post size | 2" x 2" |
| Posts include | flat caps + screws |

---

## Assumptions (defaults)

| Setting | Default |
|---------|---------|
| Terminal posts | 2 |
| Gates | 0 |

---

## Quantity Formulas

| Component | Formula |
|-----------|---------|
| Total posts | `panel_count + 1` |
| Line posts | `panel_count - 1` |
| Terminal posts | `2` |

---

## Components to Generate

### Posts
- **Lookup:** `lookup_aluminum_fence`
- **Params:** `unit_name=Post`, `height_ft={H_FT}`, `design={DESIGN}`
- **Qty formula:** `total_posts_qty`

---

## Lookup Strategy

**Attempt 1:**
- `unit_name=Post` + `height_ft`

**Attempt 2:**
- add `design`
- if still not exact, choose the best option from Attempt 1 with lower confidence

