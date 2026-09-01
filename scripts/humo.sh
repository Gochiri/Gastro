#!/usr/bin/env bash
# Prueba de humo contra un build de PRODUCCIÓN.
#
# El resto de la suite corre contra `next dev`, que no prerrenderiza, no fija
# NODE_ENV=production y deja activas las ayudas de desarrollo. Este script
# compila, levanta `next start` y recorre la aplicación entrando por la pantalla
# de login, que es lo que hace una persona.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

PUERTO="${PUERTO:-3100}"
SERVIDOR=""

limpiar() {
  [ -n "$SERVIDOR" ] && kill "$SERVIDOR" 2>/dev/null || true
}
trap limpiar EXIT

echo "▸ Compilando"
npm run build >/dev/null

echo "▸ Levantando el servidor de producción en el puerto $PUERTO"
npx next start -p "$PUERTO" > /tmp/gastro-humo.log 2>&1 &
SERVIDOR=$!

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$PUERTO/login" && break
  sleep 0.5
done
curl -sf -o /dev/null "http://localhost:$PUERTO/login" || {
  echo "el servidor no arrancó; mirá /tmp/gastro-humo.log" >&2
  tail -20 /tmp/gastro-humo.log >&2
  exit 1
}

echo "▸ Recorriendo la aplicación"
E2E_BASE_URL="http://localhost:$PUERTO" \
  npx playwright test e2e/humo-produccion.spec.ts --config playwright.humo.config.ts
