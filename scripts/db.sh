#!/usr/bin/env bash
# Arranca un Postgres local efímero y aplica migraciones, shim y seed.
# Uso: scripts/db.sh reset | psql [args...]
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/gastro}"
PGPORT="${PGPORT:-5433}"
PGHOST="${PGHOST:-/tmp}"
DB="${DB:-gastro}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

psql_root() { psql -h "$PGHOST" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 "$@"; }

case "${1:-reset}" in
  reset)
    # WITH (FORCE) termina las conexiones y borra en una sola operación
    # atómica. Hacerlo en dos pasos (terminar y después borrar) deja una
    # ventana en la que el servidor de desarrollo reconecta y el DROP falla
    # con "is being accessed by other users".
    psql_root -d postgres -q \
      -c "drop database if exists $DB with (force);" \
      -c "create database $DB;"
    # El shim de auth va ANTES: las migraciones referencian auth.uid(), que en
    # Supabase existe de fábrica pero en un Postgres limpio hay que crear.
    echo "  shim auth (local)"
    psql_root -d "$DB" -q -f "$ROOT/supabase/tests/00_shim_auth.sql"
    for f in "$ROOT"/supabase/migrations/*.sql; do
      echo "  migración $(basename "$f")"
      psql_root -d "$DB" -q -f "$f"
    done
    echo "  permisos (local)"
    psql_root -d "$DB" -q -f "$ROOT/supabase/tests/01_shim_grants.sql"
    if [ -f "$ROOT/supabase/seed/seed.sql" ]; then
      echo "  seed"
      psql_root -d "$DB" -q -f "$ROOT/supabase/seed/seed.sql"
    fi
    echo "base $DB lista"
    ;;
  psql)
    shift
    psql_root -d "$DB" "$@"
    ;;
  *)
    echo "uso: db.sh [reset|psql]" >&2; exit 1 ;;
esac
