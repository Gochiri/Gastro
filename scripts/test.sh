#!/usr/bin/env bash
# Recrea la base y ejecuta toda la suite. Falla al primer error.
set -euo pipefail

PGPORT="${PGPORT:-5433}"; PGHOST="${PGHOST:-/tmp}"; DB="${DB:-gastro}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fallos=0

"$ROOT/scripts/db.sh" reset >/dev/null
echo "base recreada"

correr() { # correr <descripcion> <usuario_pg> <archivo>
  local desc="$1" usuario="$2" archivo="$3"
  echo ""
  echo "── $desc"
  if PGPASSWORD=test psql -h "$PGHOST" -p "$PGPORT" -U "$usuario" -d "$DB" \
       -q -v ON_ERROR_STOP=1 -f "$archivo" 2>&1 \
       | sed -e 's/^psql:[^ ]*: //' -e '/^SET$/d' -e '/^$/d'; then
    :
  else
    fallos=$((fallos+1))
  fi
}

correr "Estructura RLS (superusuario)" postgres  "$ROOT/supabase/tests/test_rls_estructura.sql"
correr "Acceso RLS (rol sin privilegios)" app_user "$ROOT/supabase/tests/test_rls_acceso.sql"
correr "Costeo recursivo" postgres "$ROOT/supabase/tests/test_costeo.sql"

echo ""
if [ "$fallos" -gt 0 ]; then
  echo "FALLARON $fallos suites"; exit 1
fi
echo "TODAS LAS SUITES PASARON"
