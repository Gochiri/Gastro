# Sistema de gestión gastronómica

SaaS multi-negocio para restaurantes pequeños y medianos de LATAM. Responde la
pregunta que ningún Excel les responde: **cuánto cuesta realmente cada plato, y
en qué se va la diferencia entre lo que debería costar y lo que costó.**

Estado: **fases 0, 1 y la interfaz web** completas. Ya se puede entrar, ver el
catálogo de recetas costeado y abrir la ficha técnica de cualquier plato con el
desglose por insumo.

## Puesta en marcha

Requiere PostgreSQL 16. No hace falta Supabase para desarrollar ni para correr
los tests: las migraciones son las mismas, y un shim local reproduce el contrato
de `auth.uid()`.

```bash
npm install

# arrancar un Postgres local (una vez por sesión)
PGDATA=/var/lib/postgresql/gastro
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l /tmp/pg.log start"

./scripts/db.sh reset   # aplica migraciones + seed
cp .env.example .env.local && $EDITOR .env.local
npm run dev             # http://localhost:3000
npm test                # SQL + contexto de tenant + E2E
```

### Suites

| Comando | Qué prueba |
|---|---|
| `npm run test:db` | RLS estructural y de acceso, y el costeo contra cálculo manual |
| `npm run test:contexto` | Que el contexto de tenant sea transaccional y no de sesión |
| `npm run test:e2e` | Que la UI muestre los importes verificados y respete el aislamiento |

## Estructura

```
app/                   Next.js App Router. Server Components; no hay estado cliente.
consultas/             SQL tipado. Ningún cálculo vive aquí.
lib/db.ts              Pool y withTenant: ÚNICO punto que abre conexiones.
lib/sesion.ts          Sesión. Login de dev; Supabase Auth en producción.
supabase/migrations/   Esquema. Se aplican en orden y valen tal cual en Supabase.
supabase/seed/         Restaurante de ejemplo: 40 insumos, 17 recetas.
supabase/tests/        Suites SQL. Los shims 00_/01_ son SOLO locales.
tests/                 Test del contexto de tenant (node --test).
e2e/                   Playwright.
scripts/               db.sh (recrear base) y test.sh (suite SQL).
.claude/rules/         Convenciones de código, copiadas del proyecto ECC.
```

## Decisiones de diseño

**Los datos se leen con `pg`, no con el SDK de Supabase.** El valor del sistema
está en funciones SQL como `costo_receta()` y en vistas agregadas; PostgREST
estorba más de lo que ayuda para eso, y la conexión directa permite ejecutar y
probar todo contra un Postgres normal sin depender del stack de Supabase.
Supabase Auth se mantiene para producción, y su cadena de conexión es Postgres
estándar: el mismo código sirve allí sin cambios.

**El contexto de tenant es transaccional.** El pool reutiliza conexiones entre
peticiones. Un `set_config` de ámbito de sesión dejaría la identidad pegada a la
conexión, y la heredaría cualquier consulta posterior que no declare la suya.
`withTenant()` lo fija con ámbito de transacción y `tests/contexto-tenant.test.mjs`
falla si alguien lo cambia.

**La app se conecta con un rol sin privilegios.** El superusuario y
`service_role` ignoran RLS: usarlos convertiría todo el aislamiento en
decoración.

**El aislamiento entre clientes vive en la base de datos.** Toda tabla con
`organizacion_id` lleva RLS activado y forzado. En un SaaS, una consulta a la
que se le olvida el filtro de tenant es una fuga de datos entre clientes; con
RLS la política está en la tabla y no depende de la memoria de nadie.
`test_rls_estructura.sql` recorre el esquema y falla si aparece una tabla
multi-tenant sin protección — atrapa la tabla que alguien agregue dentro de seis
meses sin necesidad de mantener una lista.

**Los tests de RLS corren como un rol sin privilegios.** Un superusuario ignora
las políticas: probar el aislamiento como superusuario da verde siempre y no
prueba nada.

**El costeo es recursivo y vive en SQL.** Una salsa base entra en ocho platos;
al cambiar el precio del tomate los ocho deben recostearse solos.
`costo_receta()` recorre el árbol de subrecetas con una CTE recursiva, aplica
conversiones de unidad y mermas, y **aborta con error explícito si detecta un
ciclo** en vez de colgarse o devolver un número inventado.

**Los precios son un histórico append-only.** Cambiar un precio agrega una fila
con `vigente_desde`, nunca sobrescribe. Permite costear a cualquier fecha pasada
y medir la inflación real del menú.

**Las cantidades de receta son netas.** La merma de limpieza se aplica al
costear: 800 g netos de papa con 20% de merma cuestan lo que cuesta 1 kg
comprado. Es la diferencia entre un costo teórico bonito y uno real.

## Cómo se verifica el costeo

Los valores esperados de `test_costeo.sql` **no salen del propio SQL**: se
calcularon de forma independiente a partir de las definiciones del dominio. El
caso principal es un anidamiento de tres niveles con números redondos a
propósito, comprobable con calculadora:

```
Salsa Pomodoro (rinde 2000 ml)
  Tomate perita  2 kg netos, merma 10%  -> 2222.2222 g brutos x $0.80/g = 1777.7778
  Aceite oliva   100 ml x $12/ml                                        = 1200.0000
  Sal fina       20 g x $0.50/g                                         =   10.0000
                                                                 total  = 2987.7778

Ragú de carne (rinde 3000 ml)
  Salsa Pomodoro 1000 ml -> factor 1000/2000 = 0.5 -> 0.5 x 2987.7778   = 1493.8889
  Carne picada   1.5 kg netos, merma 5% -> 1578.9474 g x $9/g           = 14210.5263
  Cebolla        500 g netos, merma 15% -> 588.2353 g x $1.20/g         =  705.8824
                                                                 total  = 16410.2976

Lasaña (rinde 8 porciones)
  Ragú           1500 ml -> factor 0.5 -> 0.5 x 16410.2976              = 8205.1488
  Pasta láminas  600 g x $5/g                                           = 3000.0000
  Mozzarella     800 g netos, merma 2% -> 816.3265 g x $7/g             = 5714.2857
                                                                 total  = 16919.4345
                                                       por porción (/8) = 2114.9293
```

También se verifica la conversión entre dimensiones: el aceite de girasol se
compra por litro y se mide en gramos, lo que exige densidad (0.92 g/ml); sin
ella la función falla de forma explícita en vez de devolver un número mal.
