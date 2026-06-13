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

## Arrancar (incluido tras clonar en otra máquina/IDE)

```bash
git clone <repo> && cd Magnific-studio
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de producción
npm test           # tests del Router y del orquestador
```

Recién clonado y **sin configurar nada**, la app arranca y es navegable de
principio a fin: director en **modo offline** (heurístico) y generación
**simulada** (jobs mockeados con preview). Nada que instalar aparte de
`npm install`.

## Clonar y conectar las APIs (Claude + Magnific)

Las claves se introducen en **Ajustes** (solo en memoria de sesión, nunca se
exportan) o se precargan desde un `.env.local` (copia `.env.example`). No hay
nada hardcodeado.

### Claude (Anthropic) — funciona ya

1. `npm run dev` y abre Ajustes.
2. Pega tu API key de Anthropic y pulsa **Probar conexión**.
3. El panel de Director llama de verdad a `/v1/messages` con el scope de página
   inyectado en cada request.

El servidor de desarrollo de Vite **proxia** `/api/anthropic` →
`https://api.anthropic.com` (ver `vite.config.ts`), así que la llamada es
*same-origin* y no hay problemas de CORS ni necesidad del header
`anthropic-dangerous-direct-browser-access`. Para llamar directo a la API
pública, pon `VITE_ANTHROPIC_BASE=https://api.anthropic.com` (entonces el header
se envía solo). En producción, sustituye el proxy por tu backend.

### Magnific (generación) — listo para conectar

- **MCP (OAuth)** es la capa conversacional por defecto; el proxy `/api/mcp` la
  reenvía a `https://mcp.magnific.com`. La sesión MCP real (OAuth) se resuelve
  en el backend en producción.
- **API REST Business** (`ApiTransport`) habilita ejecución determinista,
  webhooks y la Analytics API para medición real.

Para activar **generación real** (en vez de simulada):

```bash
cp .env.example .env.local
# en .env.local:
VITE_MAGNIFIC_LIVE=true
VITE_MAGNIFIC_API_KEY=mag-...           # o ponla en Ajustes
VITE_MAGNIFIC_API_TARGET=https://api.magnific.ai   # tu host real
VITE_MAGNIFIC_GENERATE_PATH=/v1/generations         # tu endpoint real
```

Con esto, `ApiTransport.execute()` hace `POST → task_id → poll` real contra la
base configurada (vía el proxy `/api/magnific`). Si la llamada falla por
configuración, **cae con gracia a simulación** y lo indica, para no romper el
flujo. Las rutas y el host son configurables sin tocar código: ajusta el
`CapabilityMap` (`src/generation/capabilityMap.config.json`) y el `.env`.

> Variables disponibles y sus valores por defecto: ver `.env.example`.

### Backend del Director — Claude orquesta el MCP (server-side)

La vía MCP de verdad (Claude como cerebro llamando a las herramientas del MCP de
Magnific) corre en un **backend** sin dependencias (`server/index.mjs`), porque
la sesión OAuth/MCP y las claves no deben vivir en el navegador.

```bash
# terminal 1 — backend del Director
ANTHROPIC_API_KEY=sk-ant-... \
MAGNIFIC_MCP_URL=https://mcp.magnific.com \
MAGNIFIC_MCP_TOKEN=... \
npm run server                 # escucha en :8787

# terminal 2 — frontend
VITE_MAGNIFIC_LIVE=true npm run dev
```

Flujo: `McpTransport` (navegador) → `POST /api/director/mcp-generate` (proxy →
backend) → Claude con el **MCP connector** de Anthropic
(`mcp_servers`, beta `mcp-client-2025-04-04`) ejecuta la herramienta de Magnific
adecuada (`images_generate`, `video_generate`, `video_concatenate`…) y devuelve
la URL del asset. Sin `ANTHROPIC_API_KEY`/`MAGNIFIC_MCP_URL` o ante un error, el
backend devuelve un mock y el frontend sigue funcionando.

`GET /api/director/health` reporta qué está configurado.

## Diseño

La UI sigue el **sistema de diseño de Magnific**: capas de panel oscuras
(`#101010 → #161616 → #1a1a1a → #1f1f1f`), paneles flotantes con radio 16px,
hovers *ghost* (blancos translúcidos), acento **rosa** reservado solo para crear,
**azul primario** para los CTAs (gates), color por categoría en cada fase
(Historia lila, Guion coral, Storyboard azul, Producción verde, Entrega cian) y
tipografía **Geist** (`@fontsource-variable/geist`). El sidebar es más ancho que
el rail de 72px de Magnific porque Studio navega fases con nombre.

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
