# Despliegue (Fase 0 — validación, todo en Firebase/GCP, contenido en local)

Arquitectura: los **proyectos y assets generados viven en la máquina de cada
usuario** (carpeta de trabajo vía File System Access API en Chrome/Edge;
localStorage + export ZIP en Safari/Firefox). El servidor no almacena contenido:
streamea los assets de Magnific al navegador y renderiza en `/tmp` efímero.
Cada usuario usa su login de Google, su OAuth de Magnific y su API key de
Anthropic (directa navegador → Anthropic, nunca pasa por el servidor).

## 1. Proyecto Firebase (una vez)

1. Crea un proyecto en https://console.firebase.google.com
2. **Authentication** → Sign-in method → habilita **Google**.
3. Registra una app web y copia la config (apiKey, authDomain, projectId, appId).
4. Para el **Share en tiempo real** (Fase 0.5): crea una **Realtime Database**
   (copia su URL) y una base **Firestore**, y despliega las reglas del repo:
   `firebase deploy --only database,firestore:rules`.

## 2. Backend en Cloud Run

```sh
gcloud run deploy magnific-studio \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars "APP_ORIGIN=https://<TU-DOMINIO>,FIREBASE_PROJECT_ID=<projectId>" \
  --set-secrets "SESSION_ENC_KEY=session-enc-key:latest"
```

- `SESSION_ENC_KEY`: secreto aleatorio (`openssl rand -hex 32`) — cifra los
  tokens OAuth de Magnific en reposo.
- Sin volumen: un reinicio del contenedor pide reconectar Magnific (1 clic).
- El contenedor sirve también la SPA (`dist/`), así que puedes usar
  directamente la URL de Cloud Run como dominio (same-origin, sin CORS).

## 3. (Opcional) Firebase Hosting delante

`firebase.json` ya trae el rewrite `/api/** → Cloud Run` (ajusta `region`
y `serviceId`). Entonces `APP_ORIGIN` = el dominio de Hosting.

```sh
npm run build && firebase deploy --only hosting
```

## 4. Variables del frontend (build)

En el entorno de build (o `.env.production`):

```
VITE_MAGNIFIC_LIVE=true
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<proj>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<proj>
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_DATABASE_URL=https://<proj>-default-rtdb.<region>.firebasedatabase.app
```

Sin las `VITE_FIREBASE_*` la app corre en modo dev (sin login) — igual que
en local con `npm run dev`.

## Checklist de seguridad activa

- Assets y jobs scoped por usuario (`uid:` o cookie de sesión).
- Tokens Magnific cifrados (AES-256-GCM) si `SESSION_ENC_KEY` está definido.
- Cookie `Secure` con `NODE_ENV=production`; check de `Origin` en POSTs.
- Rate limits por usuario en generate/render; 1 render ffmpeg concurrente;
  inputs de render capados a 300MB y borrados tras cada render.
- `.dockerignore` excluye `storage/` (contenido y tokens locales del owner).

## Cómo funciona el Share (Fase 0.5)

- «Compartir» (icono de personas en la cabecera) → invitas por email; el
  invitado ve la notificación al entrar con su Google y al aceptar recibe el
  proyecto completo, que se guarda en SU carpeta local.
- Mientras estáis conectados a la vez: cambios en <1s, avatares de presencia,
  y bloqueo de campo mientras otro edita (prompts de plano). Lo generado por
  cualquiera se replica a la carpeta local de todos (relay por RTDB, chunks
  transitorios que se borran — la sala nunca almacena contenido de forma
  duradera).
- Sin co-presencia, el que vuelve se pone al día con el snapshot de la sala.
- El id de sala es un token no adivinable (modelo de acceso de la fase de
  validación; ver `database.rules.json`).

## Pendiente para después de la validación

- Sesiones Magnific en Firestore (sobrevivir reinicios de Cloud Run sin
  reconectar) — hoy: archivo cifrado en `/tmp`.
- Storage en la nube (Cloud Storage) para colaboración asíncrona y acceso
  multi-dispositivo sin co-presencia.
- Transferencia de assets grandes por WebRTC (hoy: chunks RTDB, cap 100MB).
