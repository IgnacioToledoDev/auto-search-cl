# Salazar Israel URL reference

Observed 2026-10-28 with plain HTTP and a browser User-Agent.

| Purpose | URL | robots.txt | Result |
| --- | --- | --- | --- |
| robots | `https://www.salazarisrael.cl/robots.txt` | n/a | 200 |
| sitemap | `/sitemap.xml` | listed | 200, 3,433 URLs |
| Used cars | `/vehiculos/usado` | allowed | 200, 12 cards |
| New cars | `/vehiculos/nuevo` | allowed | 200, 12 cards |
| Page N | `/vehiculos/usado?page=2` | allowed | 200, different cards |
| By make | `/marcas/toyota/usado`, `/marcas/audi/nuevo` | allowed | 200 |
| By make, page N | `/marcas/toyota/usado?page=2` | allowed | 200, different cards |
| Used detail | `/marcas/<make>/usado/<make>-<model>-<id>` | allowed | 200, `Car` JSON-LD |
| New detail | `/marcas/<make>/nuevo/<model-slug>` | allowed | 200, `Car` JSON-LD |
| Quote flow | `/buy-process/<id>` | **disallowed** | never requested |
| Search filters | `?marca=`, `?categoria=`, `?utm*` | **disallowed** | never requested |
| Bare id | `/marcas/x/usado/x-<id>` | n/a | 308 to a `?marca=` URL (disallowed); not supported |

## Filter mapping

| CLI flag | Implementation |
| --- | --- |
| `--condition` | `/vehiculos/usado` or `/vehiculos/nuevo`; `ambos` fetches both |
| `--make` | path `/marcas/<make>/<condition>` (slugified) and a client-side make match |
| `--page` | `?page=N` (portal page of 12 cards) |
| `--limit` | slices the fetched page |
| `--query` | client-side match on the card title |
| `--model`, `--year-min/max`, `--price-max`, `--km-max`, `--region` | client-side filters (an unknown value is dropped when the filter is set) |
