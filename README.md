# Magnific Studio — MVP

Una herramienta de la suite de Magnific, hermana de Spaces pero **opuesta en
filosofía**: un **pipeline de producción narrativa por fases**, navegable por
páginas, donde el usuario organiza/controla/visualiza y Claude actúa como
**director invocable** (presente pero no invasivo).

Flujo end-to-end: **idea → guion → storyboard → producción escena a escena →
entrega**.

```
PROYECTO
├─ 📖 Historia      logline, personajes, arcos, tono
├─ 📝 Guion         escena a escena
├─ 🎬 Storyboard    grid de keyframes · gate del plan completo
├─ 🎞️  Producción    Master de escenas + Workspace de escena · gate por escena
├─ 📦 Entrega       ensamblaje final, descargas, export a Spaces
└─ ⚙️  Ajustes       API key de Claude, consumo, modelos, biblioteca
```

## Arrancar

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de producción
npm test           # tests del Router y del orquestador
```

Sin API key, la app funciona en **modo offline** (jobs simulados + director
heurístico). En **Ajustes** puedes conectar tu propia API key de Anthropic: a
partir de ahí el panel de Director llama de verdad a `/v1/messages` con el scope
de la página inyectado en cada request.

## Principios rectores (no negociables)

1. **No es un canvas.** Organización lineal por páginas/fases vía sidebar.
2. **El chat se invoca, no se sufre.** Barra de Director abajo + acciones
   contextuales + panel lateral a demanda. Ninguno roba espacio permanente.
3. **Validación por gates.** Cada fase termina en una aprobación humana
   explícita que desbloquea la siguiente.
4. **Claude es consciente del contexto de página.** El comportamiento central.
5. **Arquitectura modular por bloques.** Cada fase es un bloque desacoplado.
6. **Transparencia de consumo.** API propia + preflight de créditos siempre.

## Arquitectura

### Bloques (`src/blocks`, contrato en `src/types/pipeline.ts`)

Cada fase implementa `PipelineBlock`: `getPageContext()`, `getActions()`,
`consume()`, `produce()`, `getGateState()`, `validate()`, `render()`. Los
bloques se comunican **solo** vía `produce() → consume()`; nunca leen el estado
interno de otro bloque. Un equipo puede potenciar/sustituir un bloque
reimplementando la interfaz, sin tocar el pipeline (`src/blocks/index.ts`
orquesta por lista ordenada + estado de gates).

**Producción** tiene sub-estructura propia (Master de escenas + Workspace de
escena) que vive dentro del bloque y no contamina la interfaz común.

### Conciencia de contexto de página (`src/director`)

`PageContext = { phase, visibleObjects, allowedActions, blockedActions,
implicitReferent }` se inyecta en el system prompt en **cada** request (Claude
no tiene memoria entre llamadas). El orquestador (`orchestrator.ts`):

- resuelve referencias implícitas: estando en *Producción → Escena 3*, “el plano
  2” = el plano 2 **de la Escena 3** (no del corto);
- **redirige con suavidad** lo que está fuera de fase en vez de ejecutarlo.

Verificado en `src/director/orchestrator.test.ts`.

### GenerationBlock dual (`src/generation`)

Un **único bloque** con dos transportes coexistentes tras la interfaz
`GenerationTransport` y un `Router` que decide por capacidades:

- **`CapabilityMap`** configurable **sin tocar código** (`capabilityMap.config.json`).
- **Transportes:** `McpTransport` (conversacional, por defecto) y `ApiTransport`
  (determinista, webhooks + Analytics API con API key Business).
- **4 modos de ejecución:** `mcp_default`, `api_fallback`,
  `mcp_to_api` (handoff decidido por Claude, vía `preparedForApi`) y `parallel`
  (cada transporte produce su parte y el bloque las **ensambla** al final).

> Responsabilidades separadas, nunca re-mezcladas: **Claude = cerebro**
> (orquestación/razonamiento), **Magnific = generación**.

Verificado en `src/generation/Router.test.ts`.

### Settings y consumo (`src/settings`, `src/state/consumption.ts`)

Conexión de API key (solo en memoria, nunca exportada), selector de modelo, test
de conexión, contadores de **tokens/coste de Claude** y **créditos de Magnific**
con **preflight antes de cada generación**, historial por fase/escena/plano y
biblioteca compartida.

### Estado y persistencia (`src/state`)

Estado del proyecto en memoria (React) + **export/import JSON** (sin
almacenamiento de navegador, §5.6). En producción se persistiría en el backend
de Magnific.

## Mapa de archivos

| Área | Ruta |
|------|------|
| Contrato de bloque + PageContext | `src/types/pipeline.ts` |
| Modelo de dominio | `src/types/project.ts` |
| Tipos de generación | `src/types/generation.ts` |
| Bloques de fase | `src/blocks/{story,script,storyboard,production,delivery}` |
| GenerationBlock dual | `src/generation/*` |
| Director (cliente, orquestador, UI) | `src/director/*` |
| Settings + consumo | `src/settings`, `src/state/consumption.ts` |
| Store + seed | `src/state/*` |
