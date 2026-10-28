# Mercado Libre Chile URL reference

Observed 2026-10-28.

| Purpose | URL | Status |
| --- | --- | --- |
| Search (API) | `https://api.mercadolibre.com/sites/MLC/search?category=MLC1744&q=...&limit=..&offset=..` | 403 anonymous (token required) |
| Item (API) | `https://api.mercadolibre.com/items/MLC<id>` | not probed (same API, same 403 expected) |
| robots.txt | `https://listado.mercadolibre.cl/robots.txt` | 200; `Claude-User`/`ClaudeBot` disallowed |
| HTML listing / item pages | `listado.mercadolibre.cl/...`, `auto.mercadolibre.cl/MLC-<id>-...` | not fetched |

## Filter mapping

| CLI flag | Implementation |
| --- | --- |
| `--query`, `--make`, `--model` | joined into the API `q` parameter |
| `--condition` | `ITEM_CONDITION` = `2230284` (nuevo) / `2230581` (usado, unverified); `ambos` = omitted; also filtered client-side |
| `--page`, `--limit` | `offset = (page-1)*limit`, `limit` |
| `--year-min/max`, `--price-max`, `--km-max`, `--region` | client-side over the returned page (unknown value dropped when the filter is set) |

`--price-max` compares CLP only; UF and USD listings have `priceClp = null`
and are dropped when it is set. The API's own range filters were not used
because they could not be verified.
