# Chain Link Fence Family Rules

- Mesh and pipe are separate lookup paths.
- Mesh defaults:
  - `unit_name=Mesh`
  - default `mesh_type=2 x 9` unless the customer explicitly specifies another
  - black or green mesh -> `color=Black/Green`
  - galvanized/silver -> `color=Galv`
- Pipe defaults:
  - `unit_name=Pipe`
  - green pipes do not exist; map green pipe requests to black only if context requires pipe
  - normalize spoken diameters to `pipe_diameter_label`
  - normalize grades to `Resi`, `SS20`, `SS40`
- Never pass `length_ft` for mesh lookups.
- Pipe is priced per piece; mesh is priced per foot.

