#!/usr/bin/env bash
# Magnific Studio — despliegue completo a producción (idempotente).
# Requisitos: `gcloud auth login` y `firebase login` con la cuenta del proyecto.
set -euo pipefail

PROJECT=magnific-studio-nkm
REGION=europe-west1
SERVICE=magnific-studio
APP_ORIGIN="https://${PROJECT}.web.app"
STATE_FILE=".deploy-state"

cd "$(dirname "$0")/.."

echo "== 1/7 Facturación (antes que las APIs de pago) =="
gcloud config set project "$PROJECT" -q
BILLING_ACCOUNT="${BILLING_ACCOUNT:-billingAccounts/01E668-2F66FB-DB8E99}" # My Billing Account
if ! gcloud billing projects describe "$PROJECT" --format="value(billingEnabled)" | grep -q True; then
  gcloud billing projects link "$PROJECT" --billing-account="$BILLING_ACCOUNT"
fi

echo "== 2/7 APIs =="
gcloud services enable firestore.googleapis.com firebasedatabase.googleapis.com \
  identitytoolkit.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com -q

echo "== 3/7 Firestore + Realtime Database =="
gcloud firestore databases describe --database="(default)" >/dev/null 2>&1 ||
  gcloud firestore databases create --database="(default)" --location=eur3 -q
firebase database:instances:create "$PROJECT-default-rtdb" --location "$REGION" --project "$PROJECT" \
  || echo "RTDB: ya existe (o creación no necesaria) — continuando"

echo "== 4/7 Login con Google (Identity Toolkit) =="
TOKEN=$(gcloud auth print-access-token)
# Inicializa Auth y habilita el proveedor de Google (idempotente: ignora 409).
curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/identityPlatform:initializeAuth" -d '{}' >/dev/null || true
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/defaultSupportedIdpConfigs?idpId=google.com" \
  -d '{"enabled": true}' | grep -q '"enabled": true\|ALREADY_EXISTS' ||
  echo "AVISO: habilita Google manualmente en https://console.firebase.google.com/project/${PROJECT}/authentication/providers"

echo "== 5/7 Backend en Cloud Run =="
if [ ! -f "$STATE_FILE" ]; then
  echo "SESSION_ENC_KEY=$(openssl rand -hex 32)" > "$STATE_FILE"
fi
# shellcheck disable=SC1090
source "$STATE_FILE"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --allow-unauthenticated -q \
  --memory 1Gi --cpu 1 --max-instances 3 \
  --set-env-vars "NODE_ENV=production,APP_ORIGIN=${APP_ORIGIN},FIREBASE_PROJECT_ID=${PROJECT},SESSION_ENC_KEY=${SESSION_ENC_KEY}"

echo "== 6/7 Frontend (build + Hosting) + reglas =="
npm run build
firebase deploy --only hosting,database,firestore:rules --project "$PROJECT" --non-interactive

echo "== 7/7 Listo =="
echo "URL de producción: ${APP_ORIGIN}"
echo "Backend directo:    $(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
