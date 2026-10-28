# Bruno Fritsch URL reference

Observed 2026-10-28 with Node `fetch` and a browser User-Agent.

| Purpose | URL | robots.txt | Result |
| --- | --- | --- | --- |
| robots | `https://www.brunofritsch.cl/robots.txt` | n/a | 200 |
| sitemap | `/sitemap.xml` -> `staticSitemap.xml`, `categorySitemap.xml` | listed | 200 (no vehicle detail URLs) |
| Used cars | `/autos-usados` | allowed | 200, 14 records, total 724 |
| Used, page N | `/autos-usados?page=2` | allowed | 200, records 15-28 |
| Used detail | `/autos-usados/<PLATE>` | allowed | 200, product state + `Car` JSON-LD |
| Brand (new) | `/byd` | allowed | 200, 14 versions in one page |
| Model (new) | `/byd-atto-8` | allowed | 200, versions, prices client-side only |
| New detail | `/<model-slug>/<VERSION_CODE>` | allowed | 200, product state + `Car` JSON-LD |
| Filter pages | `/autos-usados/usados-*` (with or without `?`) | **disallowed** | never requested |

## Filter mapping

| CLI flag | Implementation |
| --- | --- |
| `--condition` | `usado`: `/autos-usados`; `nuevo`: `/<make>` (needs `--make`); `ambos`: used, plus the brand page when `--make` is given |
| `--make` | new cars: brand page slug; used cars: client-side match on the make |
| `--page` | `?page=N` on `/autos-usados` (14 cars per page); ignored for brand pages |
| `--limit` | slices the fetched results |
| `--query`, `--model`, `--year-min/max`, `--price-max`, `--km-max`, `--region` | client-side filters (an unknown value is dropped when the filter is set) |

The embedded state is `window.state = JSON.parse(decodeURI("..."))`; listing
records live at `searchRepository.pages[<path>].results.records[].attributes`
(keys `sku.listingId`, `product.x_marca`, `product.x_modelo`, `product.x_version`,
`product.x_agno`, `product.x_kilometraje`, `sku.minActivePrice`, ...).
