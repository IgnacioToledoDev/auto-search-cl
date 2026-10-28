# Chileautos URL reference

Observed 2026-10-28. Only path-only URLs are used because robots.txt (group
`User-agent: *`) disallows the query-string search forms.

| Purpose | URL | Allowed by robots.txt | Reachable (plain HTTP) |
| --- | --- | --- | --- |
| Home | `https://www.chileautos.cl/` | yes | 200 |
| All cars | `/vehiculos/autos-veh%C3%ADculo/` | yes (path only) | 403 DataDome |
| New cars | `/vehiculos/autos-veh%C3%ADculo/nuevo-tipo/` | yes | not probed (usado-tipo is 403) |
| Used cars | `/vehiculos/autos-veh%C3%ADculo/usado-tipo/` | yes | 403 DataDome |
| Listing detail | `/vehiculos/detalles/<slug>/<id>` (id like `GI-AD-945645`, `CP-AD-8563470`) | yes, without parameters | 403 DataDome |

Landing-path patterns seen in homepage links (not used): `/vehiculos/<x>-carroceria/`
(`suv`, `hatchback`, `sedán`), `/vehiculos/autos-vehículo/van-categoria/`.

## Filter mapping

| CLI flag | Implementation |
| --- | --- |
| `--condition` | path segment `nuevo-tipo` / `usado-tipo` (`ambos` = no segment) |
| `--query`, `--make`, `--model`, `--region` | client-side substring match |
| `--year-min/max`, `--price-max`, `--km-max` | client-side numeric filters (unknown value is dropped when the filter is set) |
| `--page`, `--limit` | client-side slicing of the returned cards |

The portal's own filter parameters were not documented because every
query-string form is disallowed. Do not add them without a policy change.
