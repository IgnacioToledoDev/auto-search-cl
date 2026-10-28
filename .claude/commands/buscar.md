---
description: Búsqueda completa de vehículo: perfil, scrape, ranking y Excel, con resumen del top 5
argument-hint: [portal opcional]
allowed-tools: Read, Glob, Agent, WebSearch, Write, Edit, Bash(npx tsx src/portals/*/cli.ts:*), Bash(npx tsx src/store/cli.ts:*), Bash(npx tsx src/export/cli.ts:*), Bash(npx tsx src/matching/validate-profile.ts:*)
---

# /buscar: de punta a punta

Ejecuta en orden, sin pedir permiso entre pasos (solo `/setup` hace preguntas):

1. **Perfil**: si no existe `data/profile.json` (o `npx tsx src/matching/validate-profile.ts` falla), sigue las instrucciones de `.claude/commands/setup.md` (`/setup`) hasta tenerlo.
2. **Scrape**: sigue `.claude/commands/scrape.md` (`/scrape`), pasando `$ARGUMENTS` si el usuario eligió un portal.
3. **Rank**: sigue `.claude/commands/rank.md` (`/rank`).
4. **Export**: sigue `.claude/commands/export.md` (`/export`).

## Resumen final

Termina con un mensaje corto:

- Portales escaneados y los omitidos (con motivo).
- Contadores del scrape (nuevos, actualizados, vetados).
- **Top 5** (de `npx tsx src/store/cli.ts list --format json`, primeros 5): marca, modelo, año, km, precio CLP, puntaje, veredicto y una línea con la principal fortaleza y la principal brecha. Marca los que tengan alertas.
- Ruta del Excel y total de candidatos.
- Recordatorio: los datos son de avisos públicos, verifica con el vendedor (patente, padrón, permiso de circulación, revisión técnica, SOAP).
