# Sistema de gestión gastronómica

SaaS multi-negocio para restaurantes pequeños y medianos de LATAM. Responde la
pregunta que ningún Excel les responde: **cuánto cuesta realmente cada plato, y
en qué se va la diferencia entre lo que debería costar y lo que costó.**

Estado: **fases 0 y 1 completas** (fundación multi-tenant y costeo de recetas).
Ver el plan completo para el resto del roadmap.

## Puesta en marcha

Requiere PostgreSQL 16. No hace falta Supabase para desarrollar ni para correr
los tests: las migraciones son las mismas, y un shim local reproduce el contrato
de `auth.uid()`.

```bash
# arrancar un Postgres local (una vez por sesión)
PGDATA=/var/lib/postgresql/gastro
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l /tmp/pg.log start"

./scripts/db.sh reset   # aplica migraciones + seed
./scripts/test.sh       # ejecuta toda la suite
```

## Estructura

```
supabase/migrations/   Esquema. Se aplican en orden y valen tal cual en Supabase.
supabase/seed/         Restaurante de ejemplo: 40 insumos, 17 recetas.
supabase/tests/        Suites SQL. Los shims 00_/01_ son SOLO locales.
scripts/               db.sh (recrear base) y test.sh (suite completa).
```

## Decisiones de diseño

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
