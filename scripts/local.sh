#!/usr/bin/env bash
# Levanta la aplicación completa en esta máquina: Postgres, esquema, datos de
# ejemplo y el servidor de producción.
#
#   scripts/local.sh            arranca todo y deja el servidor en primer plano
#   scripts/local.sh --dev      igual, pero con `next dev` (recarga en caliente)
#   scripts/local.sh --sin-datos   sin el escenario de ejemplo, solo el seed
#
# Es idempotente: se puede volver a correr. La base se RECREA en cada corrida,
# así que no la uses sobre datos que te importen.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

MODO_DEV=0
CON_DATOS=1
for arg in "$@"; do
  case "$arg" in
    --dev)        MODO_DEV=1 ;;
    --sin-datos)  CON_DATOS=0 ;;
    *) echo "opción desconocida: $arg" >&2; exit 1 ;;
  esac
done

PGPORT="${PGPORT:-5433}"
PGHOST="${PGHOST:-/tmp}"
DB="${DB:-gastro}"
PGBIN="${PGBIN:-}"
PGDATA="${PGDATA:-$RAIZ/.postgres}"

paso() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
fallar() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- 1. Encontrar Postgres --------------------------------------------------
if [ -z "$PGBIN" ]; then
  if command -v pg_ctl >/dev/null 2>&1; then
    PGBIN="$(dirname "$(command -v pg_ctl)")"
  else
    # Ubicaciones habituales en Linux y en macOS con Homebrew.
    for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin \
             /usr/local/opt/postgresql@*/bin /Applications/Postgres.app/Contents/Versions/*/bin; do
      [ -x "$d/pg_ctl" ] && PGBIN="$d" && break
    done
  fi
fi
[ -n "$PGBIN" ] && [ -x "$PGBIN/pg_ctl" ] || fallar \
  "No encontré PostgreSQL. Instalalo (>= 14) o exportá PGBIN=/ruta/a/bin."

paso "PostgreSQL: $PGBIN"

# --- 2. Arrancar una instancia propia del proyecto ---------------------------
# Un cluster dentro del repo, en su propio puerto: no toca el Postgres que ya
# tengas instalado ni sus bases.
if [ ! -d "$PGDATA/base" ]; then
  paso "Creando el cluster en $PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
fi

if ! "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
  paso "Arrancando PostgreSQL en el puerto $PGPORT"
  "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $PGHOST" -l "$PGDATA/server.log" start >/dev/null
  for _ in $(seq 1 30); do
    "$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi
"$PGBIN/pg_isready" -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 \
  || fallar "PostgreSQL no arrancó. Mirá $PGDATA/server.log"

# --- 3. Rol sin privilegios --------------------------------------------------
# La aplicación NUNCA se conecta como superusuario: ese rol ignora RLS y
# convertiría todo el aislamiento entre clientes en decoración.
psql -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user login password 'test';
  end if;
end $$;
SQL

# --- 4. Esquema y datos ------------------------------------------------------
paso "Aplicando migraciones y datos de ejemplo"
PGPORT="$PGPORT" PGHOST="$PGHOST" DB="$DB" ./scripts/db.sh reset

if [ "$CON_DATOS" = "1" ]; then
  DATABASE_URL="postgresql://app_user:test@localhost:$PGPORT/$DB" node scripts/escenario.mjs
fi

# --- 5. Configuración --------------------------------------------------------
if [ ! -f .env.local ]; then
  paso "Creando .env.local"
  SECRETO="$(node -e 'console.log(require("crypto").randomBytes(24).toString("hex"))')"
  cat > .env.local <<ENV
# Generado por scripts/local.sh. Rol SIN privilegios: el superusuario ignora RLS.
DATABASE_URL=postgresql://app_user:test@localhost:$PGPORT/$DB
# Login de desarrollo: solo responde a peticiones de esta misma máquina.
APP_AUTH_DEV=1
APP_SESSION_SECRET=$SECRETO
# Para los widgets de IA. Sin esto, la app lo dice y no consulta al modelo.
# ANTHROPIC_API_KEY=
ENV
fi

# --- 6. Servidor -------------------------------------------------------------
if [ "$MODO_DEV" = "1" ]; then
  paso "Arrancando en modo desarrollo — http://localhost:3000"
  exec npm run dev
fi

paso "Compilando"
npm run build

paso "Servidor listo — http://localhost:3000"
echo "  Entrá con cualquiera de los usuarios del seed; no hay contraseña."
echo "  Para pararlo: Ctrl-C. Para parar PostgreSQL: $PGBIN/pg_ctl -D $PGDATA stop"
exec npm start
