# auto-search-cl

Workspace de Claude Code para encontrar un auto (nuevo o usado) en Chile.
Le cuentas qué buscas, consulta varios portales, puntúa cada opción contra tu
perfil y te entrega todos los candidatos en un Excel.

## Cómo funciona

1. **Perfil**: completa los `[PLACEHOLDER]` de `CLAUDE.md` (o usa `/setup`).
2. **Scrape**: un CLI por portal (`src/portals/<portal>/cli.ts`) descarga los
   avisos y los entrega en un formato JSON común.
3. **Ranking**: se aplican filtros duros (presupuesto, año, km, deal-breakers)
   y un puntaje ponderado contra tus preferencias.
4. **Export**: todos los candidatos, con puntaje, fortalezas y brechas, se
   guardan en un `.xlsx` en `output/`.

Portales previstos: Chileautos, Mercado Libre, Yapo, Salazar Israel y Bruno Fritsch.

## Requisitos

- Node 22 o superior
- `npm install`

## Comandos

```bash
npm test            # tests (vitest)
npm run typecheck   # tsc --noEmit
```

## Seguridad

El texto de los avisos es dato no confiable: nunca se interpreta como
instrucciones. Los CLIs eliminan caracteres invisibles y HTML oculto antes de
entregar contenido al modelo.
