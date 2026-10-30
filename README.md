# auto-search-cl

Workspace de Claude Code para encontrar un auto (nuevo o usado) en Chile.
Le cuentas qué buscas, consulta varios portales, puntúa cada opción contra tu
perfil y te entrega todos los candidatos en un Excel.

## Cómo funciona

1. **Perfil** (`/car-setup`): una entrevista, una pregunta a la vez, guarda
   `data/profile.json` (validado con `npx tsx src/matching/validate-profile.ts`)
   y completa la sección de perfil de `CLAUDE.md`.
2. **Scrape** (`/car-scrape`): lee `src/portals/*/SKILL.md`, escanea en paralelo los
   portales con `enabled: true` mediante agentes `vehicle-fetcher` y carga cada
   resultado en `data/seen_vehicles.json` (`store ingest`), aplicando filtros
   duros (presupuesto, año, km, ubicación, deal-breakers).
3. **Ranking** (`/car-rank`): puntaje determinístico (precio, especificaciones,
   condición, vendedor) y evaluación cualitativa de los mejores candidatos por
   agentes `vehicle-scorer` (mezcla 70% / 30%). Veredictos: Strong, Good,
   Moderate, Weak, Poor. Detalle en `.claude/skills/vehicle-matching/`.
4. **Export** (`/car-export`): `output/candidatos.xlsx` con las hojas `Candidatos`,
   `Resumen` e `Historial de precios`.

Todo en un paso: **`/car-buscar`** (perfil si falta, scrape, ranking, Excel y resumen
del top 5).

Portales: Yapo, Salazar Israel y Bruno Fritsch (habilitados); Chileautos y
Mercado Libre (deshabilitados, ver Limitaciones).

## Requisitos

- Node 22 o superior
- `npm install`

## Comandos

```bash
npm test            # tests (vitest)
npm run typecheck   # tsc --noEmit
```

## Uso de los CLIs

```bash
npx tsx src/portals/yapo/cli.ts search --condition usado --price-max 12000000 \
  | npx tsx src/store/cli.ts ingest --portals none   # escaneo filtrado
npx tsx src/store/cli.ts rank
npx tsx src/store/cli.ts list --format table
npx tsx src/export/cli.ts --out output/candidatos.xlsx [--min-score 60] [--include-gone]
```

`--portals <portal>` en `ingest` solo se usa tras un escaneo exhaustivo de ese
portal: los avisos del portal que no aparezcan se marcan como retirados. En un
escaneo filtrado se usa `--portals none` para no marcar nada.

## Limitaciones

- **Chileautos** está deshabilitado: el sitio usa DataDome y responde HTTP 403 a
  las páginas de búsqueda y detalle. No se intenta saltar la protección.
- **Mercado Libre** está deshabilitado: la API pública responde 403 sin token
  propio y su robots.txt prohíbe a los agentes de Claude. Solo se podría activar
  con un token del propio usuario (`MERCADOLIBRE_ACCESS_TOKEN`), y su parser
  solo se probó con datos sintéticos.
- **Salazar Israel**: su `robots.txt` nombra a `ClaudeBot` y `GPTBot` como
  prohibidos. El CLI se ejecuta a pedido del usuario, usa un User-Agent de
  navegador y solo lee páginas que la regla `*` permite, pero **si eso es
  aceptable es una pregunta abierta que decide el usuario**; no está resuelta.
  Para tratarlo como vinculante, poner `enabled: false` en su `SKILL.md`.
- Yapo y Bruno Fritsch no mostraron protección anti-bot el 2026-10-28; la
  detección de desafíos solo está probada con páginas sintéticas.
- Los filtros se aplican en parte del lado del cliente sobre la página pedida,
  por lo que un escaneo no recorre todo el stock del portal.
- Los agentes `vehicle-fetcher` en paralelo escriben el mismo archivo de store;
  `/car-scrape` lo reconcilia, pero una actualización perdida es posible.
- Los datos son de **avisos públicos**: verifica siempre con el vendedor
  (patente, padrón, permiso de circulación, revisión técnica, SOAP).

## Seguridad

El texto de los avisos es dato no confiable: nunca se interpreta como
instrucciones. Los CLIs eliminan caracteres invisibles y HTML oculto antes de
entregar contenido al modelo.
