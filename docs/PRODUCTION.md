# Magnific Production — concepto y prototipo

Plataforma hermana de Magnific Studio para **producciones largas** (series de
45 min, películas). Elimina las fases Idea → Guion → Storyboard: la pantalla
principal **es** la producción, una estructura de carpetas donde se genera,
corta, revisa y aprueba directamente sobre las cards.

Prototipo: `npm run dev` → <http://localhost:5173/production.html>
(código en `src/production/`, Studio no se toca).

## Principios

1. **Estructura = carpetas, igual en la app y en el disco.** Niveles
   configurables por producción (por defecto `Secuencia › Escena › Plano`,
   códigos `SQ010/SC010/SH0010`). Se renombran, se cambia prefijo, salto de
   numeración y dígitos, y se añaden niveles arriba (p. ej. `Episodio`).
2. **El último nivel es la unidad de trabajo** (las cards de plano).
3. **La escena también es punto de producción.** Se genera un vídeo largo
   (hasta 30 s), se corta y cada tramo se coloca en la carpeta de su plano,
   o se mantiene entero en la escena. La secuencia, por defecto, no genera:
   agrupa y conserva montajes. Qué niveles generan y su duración máxima es
   configurable (`Niveles` → «Genera», «Máx. vídeo»).
4. **Media ≠ Toma.** *Media* es el archivo generado (inmutable, vive en la
   carpeta del nodo que lo produjo, versionado `v001…`). *Toma* es un corte
   no destructivo (entrada/salida) de un media, colocado en un nodo. Un mismo
   clip de escena alimenta varios planos; el corte se puede rehacer sin
   regenerar.
5. **Revisión en la propia card:** estado (Pendiente → En curso → En revisión
   → Aprobado), responsable, toma elegida, comentarios por versión.

## Qué hace ya el prototipo

- Árbol de estructura editable (añadir hijo, insertar entre medias usando el
  hueco de numeración 010→015, mover, borrar) y editor de niveles.
- Tablero por calles: una calle por escena con su card de producción y las
  cards de sus planos (estado, duración, versiones, tomas, comentarios).
- Generación de imagen/vídeo en escena o plano reutilizando el
  `GenerationBlock` de Studio (MCP/API; simulado si no hay conexión), vídeo
  desde imagen de partida, y keyframes en lote para los planos vacíos.
- Cortador: marcas de corte en el timeline → tramos → destino por tramo
  (plano existente, nuevo plano o mantener en la escena).
- Espejo en carpeta del escritorio (Chrome/Edge) con la misma jerarquía:

```
<carpeta>/<Producción>/production.json
<carpeta>/<Producción>/SQ010/SC010/node.json            estado, tomas (EDL), comentarios
<carpeta>/<Producción>/SQ010/SC010/media/SC010_vid_v001.mp4
<carpeta>/<Producción>/SQ010/SC010/SH0010/node.json
```

## Siguientes pasos (no incluidos aún)

| Bloque | Qué falta |
| --- | --- |
| Sync de equipo | Nube como fuente de verdad (un documento por nodo/media/toma/comentario + almacenamiento de objetos); el espejo local pasa a ser una réplica. Hoy el estado vive en `localStorage`. |
| App de escritorio | Tauri/Electron: escritura en carpeta sin permisos del navegador y generación en segundo plano. |
| Render de cortes | Exportar el recorte físico de cada toma aprobada (ffmpeg en backend, ya existe `server/render.mjs`). Hoy los cortes son metadatos. |
| 30 s reales | Si el modelo no da 30 s de una vez, encadenar `video_extend`/`video_concatenate`. |
| Biblioteca / desglose | Actores, props y localizaciones enlazados a nodos como referencias de generación (reutilizar la Biblioteca de Studio). |
| Roles | Admin / Supervisor (aprueba) / Artista / Cliente (solo ve y comenta). |
| Montaje | Timeline de escena/secuencia a partir de las tomas elegidas (reutilizar el editor de Entrega). |
