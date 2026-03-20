# BOM: Temporary Fence

**Family:** temporary-fence
**Purpose:** Resolve stands and clamps from panel count.

---

## Assumptions (defaults)

| Setting | Default |
|---------|---------|
| Stands per panel | 2 |
| Clamps per connection | 1 |

---

## Quantity Formulas

| Component | Formula |
|-----------|---------|
| Stands | `panel_count * 2` |
| Clamps | `panel_count - 1` |

---

## Components to Generate

### Stands
- **Lookup:** `lookup_temporary_fence`
- **Params:** `unit_name=Stand`
- **Qty formula:** `stands_qty`

### Clamps
- **Lookup:** `lookup_temporary_fence`
- **Params:** `unit_name=Clamp`
- **Qty formula:** `clamps_qty`

---

## Trigger Conditions

Generate hardware when the customer asks for:
- stands and clamps
- everything needed for panels
- full kit / complete setup
- hardware / accessories

