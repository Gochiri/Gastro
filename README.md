# Sistema de gestión gastronómica

SaaS multi-negocio para restaurantes pequeños y medianos de LATAM. Responde la
pregunta que ningún Excel les responde: **cuánto cuesta realmente cada plato, y
en qué se va la diferencia entre lo que debería costar y lo que costó.**

Estado: **fases 0 a 4** completas, más el primer widget de IA. Se puede costear el menú, importar el
histórico de ventas, ver margen y rentabilidad por canal, y —lo que ningún Excel
da— comparar lo que las recetas dicen que debió consumirse contra lo que
realmente salió de la heladera.

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
| `npm run test:unit` | Parseo de importes LATAM y lectura del CSV, sin base de datos |
| `npm run test:datos` | Importación completa y KPIs contra cálculo manual |
| `npm run test:e2e` | Que la UI muestre los importes verificados y respete el aislamiento |

Los archivos de test que tocan la base **recrean la base en su propio `before`** y
corren en invocaciones separadas: `node --test` paraleliza archivos por defecto,
y todos comparten un único Postgres. Por el mismo motivo `playwright.config.ts`
fija `workers: 1`.

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

**El costo de una venta se congela al importar.** Cada fila de `ventas` guarda el
costo unitario y el porcentaje de comisión vigentes en ese momento, no
referencias que se recalculen al consultar. Un mes ya reportado no debe cambiar
de números porque hoy subió el tomate. Para las correcciones legítimas —una
receta mal cargada— está `recalcular_costos_ventas(desde, hasta)`.

Se congelan **dos** valores, no uno: la comisión de un agregador cambia con el
tiempo igual que un precio, y renegociar con Rappi no debe reescribir el margen
de los meses cerrados.

**El emparejado de productos propone, no decide.** Cuando el texto del POS no
coincide con ningún alias conocido, `pg_trgm` sugiere candidatos pero es una
persona quien confirma. Un emparejado automático equivocado mete ventas en el
plato erróneo y corrompe el food cost sin que nada falle de forma visible. Cada
confirmación se guarda como alias: la próxima importación resuelve sola esa
variante de escritura.

**Un producto sin ficha técnica no muestra margen.** Calcularlo suponiendo costo
cero lo pondría a la cabeza de la tabla como el más rentable del negocio. Se
muestra un guion, y la **cobertura de costeo** —qué porcentaje de las ventas
tiene costo conocido— aparece siempre junto al food cost. Un food cost calculado
sobre el 88% de las ventas no es el food cost del negocio.

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

## Cómo se verifican los KPIs

Igual que el costeo: los valores esperados se calculan de forma independiente al
SQL y se contrastan. Sobre el CSV de ejemplo (`supabase/seed/ventas-ejemplo.csv`,
deliberadamente sucio: separadores de miles, acentos inconsistentes, una fila
vacía, un producto desconocido y un descuento ilegible):

| Métrica | Valor | De dónde sale |
|---|---|---|
| Ventas | $ 484.800,00 | suma de importes menos descuentos |
| Comisiones | $ 37.139,00 | 28% de Rappi y 25% de PedidosYa sobre sus ventas |
| Materia prima | $ 88.467,71 | unidades × costo por porción a la fecha de venta |
| Margen | $ 359.193,29 | ventas − comisiones − materia prima |
| Food cost | 20,72 % | sobre las ventas **costeadas**, no sobre el total |
| Cobertura | 88,08 % | el resto son cervezas sin receta cargada |

El hallazgo que justifica la fase, también verificado a mano: una porción de
lasaña deja $ 11.757,80 en salón y $ 7.965,07 por Rappi. La comisión se lleva
$ 3.792,73 de cada porción.

## La varianza de food cost

El diferenciador. `varianza_periodo(conteo_inicial, conteo_final)` responde:

```
consumo real          = inventario inicial + compras − inventario final
varianza              = consumo real − consumo teórico
varianza sin explicar = varianza − mermas registradas
```

La última línea es la que importa: *"consumiste 2 kg de carne más de lo que dicen
las recetas; 0,5 kg están anotados como merma; el resto no tiene explicación"*.

**Decisiones que hacen que el número sirva:**

- **Teórico y real se valúan al mismo precio unitario.** Valuando cada lado a su
  propio precio, la varianza mezclaría *usar de más* con *pagar de más*, que son
  problemas distintos con responsables distintos. Esto mide varianza de **uso**.
- **El consumo teórico se calcula en cantidades brutas.** De la cámara sale el
  kilo entero de papa, no los 800 g que quedan después de pelarla.
- **Un insumo contado en un solo conteo queda fuera del informe.** Asumir cero en
  el conteo que falta inventaría un faltante inexistente.
- **Se permiten conteos parciales**, y la cobertura viaja siempre junto al
  número: con el 74% del costo cubierto, el food cost real es una estimación y la
  pantalla lo dice.
- **El food cost teórico usa el mismo denominador que el dashboard de ventas.**
  Dos pantallas con el mismo rótulo y distinto número destruyen la confianza en
  ambas; hay un test que lo impide.

### Cómo se verifica

`scripts/escenario.mjs` monta un caso con un **faltante plantado**: importa las
ventas con el importador real, crea los conteos, y hace desaparecer 2 kg de carne
picada de los cuales 0,5 kg quedan registrados como merma.

El consumo teórico se contrasta contra un cálculo hecho a mano desde las recetas:

```
Carne picada (merma 5%), ventas del período: 16 lasañas + 11 hamburguesas
  Lasaña (rinde 8) -> Ragú 1500 ml de un lote de 3000 (factor 0,5)
    1500 g netos x 0,5 / 0,95 = 789,4737 g por lote = 98,6842 por porción
    x 16 porciones                                  = 1578,9474 g
  Hamburguesa: 180 / 0,95 = 189,4737 x 11           = 2084,2105 g
                                             TOTAL  = 3663,1579 g
```

El informe debe reportar exactamente: desvío 2.000 g, explicado 500 g, **sin
explicar 1.500 g = $13.500**. Y lo hace.

## El widget de IA

`lib/ia.ts` implementa el *explicador de resultados*: responde preguntas en
lenguaje natural sobre las métricas del período.

**El modelo no hace aritmética.** `consultas/contexto-ia.ts` arma el panorama
con todo ya calculado en SQL —incluidas las cifras derivadas, como la brecha
entre food cost teórico y real o el margen por unidad de cada canal— y el
prompt prohíbe explícitamente operar con ellas. Un dashboard que informa un
food cost inventado porque el modelo sumó mal destruye la confianza de forma
irreversible.

**Toda respuesta se audita.** `auditarCifras()` extrae los números de la
respuesta y verifica que cada uno exista en el contexto. Los que no aparezcan se
guardan en `ejecuciones_ia.cifras_no_respaldadas` y la interfaz muestra la
respuesta **con una advertencia visible**, no la oculta.

El auditor considera las dos lecturas posibles de un número ambiguo: `"1.500"`
puede ser mil quinientos o uno coma cinco, y solo se marca si **ninguna**
coincide con el contexto. La asimetría es deliberada — acusar de inventada una
cifra correcta enseña a la gente a ignorar la advertencia, y entonces deja de
servir para el caso que importa.

**Configuración.** Requiere `ANTHROPIC_API_KEY` en el servidor. Sin ella el
widget lo dice con claridad en vez de fallar de forma opaca. Usa
`claude-opus-5` con pensamiento adaptativo, esfuerzo `medium`, salida
estructurada validada con Zod y *prompt caching* sobre el bloque de
instrucciones, que se repite en cada pregunta.

**Costos.** Cada ejecución registra tokens de entrada, salida y lectura de
caché, más el costo estimado en dólares. `vista_gasto_ia` los agrega por mes y
organización, y cuenta cuántas respuestas citaron cifras sin respaldo.

### Qué está verificado y qué no

Este repositorio se desarrolló sin credenciales de API, así que **no hay una
llamada real al modelo verificada**. Lo que sí está probado, con un invocador
simulado (`tests/ia.test.mjs`): el constructor de contexto, la auditoría de
cifras —incluidos los casos ambiguos—, el cálculo de costos y el registro. La
llamada al modelo es un adaptador fino y aislado justamente para que el resto
fuese testeable.

## Prime cost

`resumen_prime_cost(desde, hasta)` responde la pregunta de supervivencia:
materia prima más trabajo sobre las ventas. Por encima del 65% no queda margen
para alquiler, servicios y ganancia, por bien que se vea la facturación.

**El costo de una hora incluye las cargas patronales.** `empleados` guarda
`costo_hora` y `cargas_sociales_pct` por separado, y el costo real es el
producto de los dos. Omitir las cargas subestima el costo laboral en torno a un
tercio y vuelve inútil la métrica.

**El día de un turno es el de su entrada, en la zona horaria del negocio.** Un
turno que arranca a las 22:00 en Buenos Aires pertenece a ese día, no al
siguiente. `fichajes.fecha_operativa` se guarda resuelto porque `entrada::date`
depende de la zona de la sesión: no es determinista, y con el servidor en UTC el
costo laboral diario queda mal repartido. Por eso `organizaciones` tiene
`zona_horaria`.

**Los fichajes sin cerrar no se cuestan, pero se informan.** No se sabe cuánto
duraron; inventar una duración sería peor. El dashboard avisa cuántos hay y
aclara que el costo laboral real es mayor que el mostrado.

**La tarifa se congela al cerrar el fichaje**, igual que el costo de una venta o
la valuación de un conteo: un aumento de sueldo no reescribe meses cerrados.

**El denominador es el mismo que en todo el sistema** —ventas costeadas— y se
calcula directo, no reconstruyéndolo desde el porcentaje de cobertura, que viene
redondeado. Hay un test que verifica que el food cost del prime cost coincide
exactamente con el del dashboard de ventas.

## Órdenes de compra

Orden al proveedor, recepciones parciales y avance por insumo comparado siempre
en la unidad base (se puede pedir en cajas y recibir en kilos).

**Confirmar una recepción genera las compras** que el cálculo de consumo real ya
consume: cierra el ciclo que en la fase 3 obligaba a cargar cada entrada de
mercadería dos veces. Cada compra queda trazada a la recepción que la originó.

**Actualizar la lista de precios es una casilla que viene desmarcada.** Recostea
todas las recetas que usen ese insumo, así que tiene que ser una decisión
consciente y no el efecto secundario de cargar un remito: una compra de urgencia
a precio atípico no es el precio del insumo.
