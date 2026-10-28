# Yapo.cl URL reference

Observed 2026-10-28 with plain HTTP and a browser User-Agent.

| Purpose | URL | robots.txt | Result |
| --- | --- | --- | --- |
| robots | `https://www.yapo.cl/robots.txt` | n/a | 200 |
| Used cars | `/autos-usados` | allowed | 200, 20 cards |
| Used cars, page N | `/autos-usados?page=2` | allowed | 200, different cards |
| Used by make/model | `/autos-usados/toyota/rav4` | allowed | 200, filtered cards |
| New cars | `/autos-nuevos` | allowed | 200, 20 cards, same layout |
| Detail | `/autos-usados/<slug>/<id>` (`/autos-nuevos/...` for new) | allowed | 200, JSON-LD `Car` |
| Detail, wrong slug | `/autos-usados/x/<id>` | allowed | 308 to the canonical URL |

## Filter mapping

| CLI flag | Implementation |
| --- | --- |
| `--condition` | `/autos-usados` or `/autos-nuevos`; `ambos` fetches both |
| `--make`, `--model` | used cars: path `/autos-usados/<make>/<model>` (slugified) and title match; new cars: title match only |
| `--page` | `?page=N` (portal page of 20 cards) |
| `--limit` | slices the fetched page |
| `--query` | client-side match on title and description |
| `--year-min/max`, `--price-max`, `--km-max`, `--region` | client-side numeric/text filters (unknown value is dropped when the filter is set) |

Yapo's own query-string filters were not probed. Do not add them without
verifying them first.
