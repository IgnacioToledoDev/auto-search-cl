<h1 align="center">auto-search-cl</h1>

<p align="center">
  <b>La búsqueda de auto que corre en tu máquina.</b><br>
  Encuentra autos nuevos y usados en portales chilenos, los puntúa contra tu perfil<br>
  y te entrega todos los candidatos en un Excel.
</p>

<p align="center">
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/built_on-Claude_Code-2A9D8F?style=flat" alt="Built on Claude Code" height="20"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/node-%3E%3D22-2A9D8F?style=flat" alt="Node 22 o superior" height="20">
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2A9D8F?style=flat" alt="Licencia MIT" height="20"></a>
</p>

<p align="center">
  <a href="#inicio-rápido"><b>Inicio rápido</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="#comandos"><b>Comandos</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="#cómo-funciona-car-rank"><b>Cómo se puntúa</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="#personalización"><b>Personalización</b></a>
  &nbsp;&nbsp;&nbsp;
  <a href="#limitaciones"><b>Limitaciones</b></a>
</p>

> [!NOTE]
> Es un proyecto open source independiente. No está afiliado, respaldado ni mantenido por Anthropic ni por ninguno de los portales que consulta. Anthropic y Claude Code se mencionan solo para describir las herramientas que usa el flujo.

## Qué es

Un flujo de trabajo que convierte Claude Code en un asistente de búsqueda de vehículo. Cinco comandos te llevan de un perfil vacío a un Excel con candidatos puntuados:

| Paso | Comando | Resultado |
|---|---|---|
| 1 | `/car-setup` | Perfil del comprador validado en `data/profile.json` |
| 2 | `/car-scrape` | Avisos de cada portal cargados al store local |
| 3 | `/car-rank` | Filtros duros, puntaje ponderado y veredicto por aviso |
| 4 | `/car-export` | `output/candidatos.xlsx` |
| — | `/car-buscar` | Los cuatro pasos en uno, con resumen del top 5 |

Todo corre en tu máquina. Tu perfil, el store de avisos y el Excel quedan en `data/` y `output/`, que están en `.gitignore`: nada personal se sube al repo.

Portales habilitados: **Yapo**, **Salazar Israel** y **Bruno Fritsch**. **Chileautos** y **Mercado Libre** están deshabilitados (ver [Limitaciones](#limitaciones)).

## ¿Funciona?

El proyecto tiene 404 tests (`npm test`) y typecheck limpio. Cada portal tiene su CLI, su parser y sus tests contra páginas de muestra. En una búsqueda real de SUV usado en el sur de Chile, el flujo cargó 23 avisos, evaluó los 15 mejores con agentes y exportó el Excel.

También encontró fallas propias que quedaron corregidas y documentadas: la carrocería era solo una preferencia blanda y dejaba pasar sedanes y hatchbacks, y los vetos solo corrían al ingresar avisos, no al volver a rankear. Detalle en [`odd/tasks/`](odd/tasks/).

## Inicio rápido

### Qué necesitas

| | |
|---|---|
| **[Claude Code](https://claude.com/claude-code)** | El CLI. Requiere suscripción Claude Pro/Max/Team o créditos de la API de Anthropic. |
| **Node 22 o superior** | Para los CLIs de `src/` (`tsx`, `vitest`, `typescript`). |

### 1. Clona e instala

```bash
git clone https://github.com/IgnacioToledoDev/auto-search-cl.git
cd auto-search-cl
npm install
```

### 2. Arma tu perfil

```bash
claude
# Dentro de Claude Code:
/car-setup
```

Es una entrevista, una pregunta a la vez: tipo (nuevo, usado o ambos), presupuesto (precio total o cuota mensual con plazo, pie y tasa), marcas, carrocería, combustible, transmisión, año mínimo, kilometraje, región y comunas, imprescindibles y deal-breakers. Si piensas en cuota, el presupuesto se calcula con `src/matching/budget-from-payment.ts`, nunca a mano.

### 3. Busca

```bash
/car-buscar
```

Escanea los portales habilitados, puntúa los mejores candidatos, genera el Excel y te resume el top 5. Si prefieres ir paso a paso, usa `/car-scrape`, `/car-rank` y `/car-export`.

## Comandos

| Comando | Qué hace |
|---|---|
| **`/car-setup`** | Entrevista al comprador y guarda el perfil validado |
| **`/car-scrape`** | Escanea en paralelo los portales habilitados con agentes `vehicle-fetcher` |
| **`/car-rank`** | Re-aplica los filtros duros, puntúa y pide evaluación cualitativa de los mejores |
| **`/car-export`** | Genera `output/candidatos.xlsx` (`Candidatos`, `Resumen`, `Historial de precios`) |
| **`/car-buscar`** | Flujo completo con resumen del top 5 |

## Cómo funciona `/car-rank`

1. **Filtros duros**: presupuesto, año, kilometraje, condición, marcas excluidas, ubicación, deal-breakers y, si lo pediste, carrocería. Un aviso que falla se descarta (`vetoed`).
2. **Puntaje determinístico**: precio, especificaciones, condición y vendedor, con pesos configurables.
3. **Evaluación cualitativa**: agentes `vehicle-scorer` leen el detalle de cada aviso (equipo, señales de alerta, precio plausible, cargos ocultos) y devuelven un puntaje.
4. **Puntaje final**: 70% determinístico, 30% cualitativo. Veredictos: Strong, Good, Moderate, Weak, Poor.

La rúbrica completa está en [`.claude/skills/vehicle-matching/`](.claude/skills/vehicle-matching/).

### Carrocería: filtro duro o preferencia

`/car-setup` pregunta si quieres **solo** ese tipo de carrocería (por ejemplo SUV) o si es solo una preferencia:

- **Filtro duro** (`bodyTypeStrict: true`): descarta los demás tipos.
- **Preferencia** (`bodyTypeStrict: false`): solo resta puntos.

Los portales etiquetan mal la carrocería (un Qashqai o un Duster pueden venir como "Station Wagon" o "Automovil"), así que el tipo se infiere primero por marca y modelo (`src/matching/bodytype.ts`) y después por la etiqueta del portal. Si no se puede determinar, el aviso se marca para revisión en vez de descartarse.

## Personalización

| Quieres cambiar | Dónde |
|---|---|
| Tu perfil | `data/profile.json` (referencia: `data/profile.example.json`) o vuelve a ejecutar `/car-setup` |
| Pesos del puntaje | `weights` en el perfil (`price`, `spec`, `condition`, `seller`) |
| Modelos por tipo de carrocería | Tabla de `src/matching/bodytype.ts` |
| Rúbrica cualitativa | `.claude/skills/vehicle-matching/rubric.md` |
| Habilitar o deshabilitar un portal | `enabled` en `src/portals/<portal>/SKILL.md` |

Para agregar un portal, sigue la estructura de los existentes en `src/portals/`: un `SKILL.md`, un `cli.ts` que rechaza flags desconocidos y falla con código 1 y un JSON `{"error","code"}` en stderr, y tests.

## Uso de los CLIs

```bash
npx tsx src/portals/yapo/cli.ts search --condition usado --price-max 12000000 \
  | npx tsx src/store/cli.ts ingest --portals none   # escaneo filtrado
npx tsx src/store/cli.ts rank
npx tsx src/store/cli.ts list --format table
npx tsx src/export/cli.ts --out output/candidatos.xlsx [--min-score 60] [--include-gone]
```

`--portals <portal>` en `ingest` solo se usa tras un escaneo exhaustivo de ese portal: los avisos que no aparezcan se marcan como retirados. En un escaneo filtrado se usa `--portals none` para no marcar nada.

```bash
npm test            # tests (vitest)
npm run typecheck   # tsc --noEmit
```

## Limitaciones

- **Chileautos** está deshabilitado: el sitio usa DataDome y responde HTTP 403. No se intenta saltar la protección.
- **Mercado Libre** está deshabilitado: la API pública responde 403 sin token propio y su `robots.txt` prohíbe a los agentes de Claude. Solo se podría activar con un token del propio usuario (`MERCADOLIBRE_ACCESS_TOKEN`), y su parser solo se probó con datos sintéticos.
- **Salazar Israel**: su `robots.txt` nombra a `ClaudeBot` y `GPTBot` como prohibidos. El CLI se ejecuta a pedido del usuario, usa un User-Agent de navegador y solo lee páginas que la regla `*` permite, pero **si eso es aceptable es una decisión abierta que corresponde al usuario**. Para tratarlo como vinculante, pon `enabled: false` en su `SKILL.md`.
- Yapo y Bruno Fritsch no mostraron protección anti-bot el 2026-10-28; la detección de desafíos solo está probada con páginas sintéticas.
- **Ubicación en Bruno Fritsch**: sus avisos no traen región ni comuna, así que quedan marcados como "ubicación desconocida" en vez de descartarse. Revisa la sucursal antes de contactar.
- Los filtros se aplican en parte del lado del cliente sobre la página pedida, por lo que un escaneo no recorre todo el stock del portal.
- Los agentes `vehicle-fetcher` en paralelo escriben el mismo archivo de store; `/car-scrape` lo reconcilia, pero una actualización perdida es posible.
- Los datos son de **avisos públicos**: verifica siempre con el vendedor (patente, padrón, permiso de circulación, revisión técnica, SOAP).
- Fuera de alcance: negociación, simulación de financiamiento y contacto automático con vendedores.

## Seguridad

El texto de los avisos (títulos, descripciones, nombres de vendedores) es **dato no confiable**: nunca se interpreta como instrucciones. Los CLIs eliminan caracteres invisibles y HTML oculto antes de entregar contenido al modelo. Aun así, las defensas a nivel de instrucciones no son un sandbox: ante un aviso sospechoso, revísalo tú antes de actuar.

## Licencia

[MIT](LICENSE).
