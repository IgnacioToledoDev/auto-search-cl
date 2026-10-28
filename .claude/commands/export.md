---
description: Exporta todos los candidatos del store a un archivo Excel en output/
argument-hint: [--min-score N] [--include-gone] [--out ruta.xlsx]
allowed-tools: Bash(npx tsx src/export/cli.ts:*)
---

# /export: Excel de candidatos

1. Ejecuta `npx tsx src/export/cli.ts $ARGUMENTS`. Sin argumentos exporta todos los candidatos activos a `output/candidatos.xlsx`. Opciones: `--out`, `--min-score N`, `--include-gone`, `--store`.
2. La salida es `{"path","exported"}`. Informa la ruta del archivo y cuántos candidatos contiene. Si `exported` es 0, sugiere `/scrape` y `/rank`.
3. Recuerda en una línea que el Excel tiene las hojas `Candidatos`, `Resumen` e `Historial de precios` y que los datos vienen de publicaciones públicas y deben verificarse con el vendedor.
4. Si el CLI devuelve un error JSON, muéstralo tal cual y no reintentes sin corregir la causa.
