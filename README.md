# Sistema de gestión gastronómica

SaaS multi-negocio para restaurantes pequeños y medianos de LATAM. Responde la
pregunta que ningún Excel les responde: **cuánto cuesta realmente cada plato, y
en qué se va la diferencia entre lo que debería costar y lo que costó.**

Estado: **plan maestro completo** — fases 0 a 6 y los cinco widgets de IA. Se puede costear el menú, importar
el histórico de ventas, ver margen y rentabilidad por canal, cerrar el mes con
EBITDA, punto de equilibrio y posición fiscal, y —lo que ningún Excel da—
comparar lo que las recetas dicen que debió consumirse contra lo que realmente
salió de la heladera.

## Puesta en marcha

Requiere Node >= 20 y PostgreSQL >= 14. No hace falta Supabase para desarrollar
ni para correr los tests: las migraciones son las mismas, y un shim local
reproduce el contrato de `auth.uid()`.

```bash
npm install
./scripts/local.sh      # http://localhost:3000
```

Eso es todo. El script crea un cluster de PostgreSQL **dentro del repo**
(`.postgres/`, en su propio puerto) para no tocar el que ya tengas instalado,
aplica las migraciones, carga el restaurante de ejemplo, genera `.env.local` con
un secreto de sesión nuevo, compila y levanta el servidor de producción.

| Variante | Qué hace |
|---|---|
| `./scripts/local.sh` | Build de producción, que es lo que se despliega |
| `./scripts/local.sh --dev` | `next dev`, con recarga en caliente |
| `./scripts/local.sh --sin-datos` | Solo el seed, sin el escenario de ejemplo |

**Recrea la base en cada corrida.** No lo apuntes a datos que te importen.

Para pararlo: `Ctrl-C` el servidor, y `pg_ctl -D .postgres stop` PostgreSQL.

### Entrar

No hay contraseñas: la pantalla de login lista los usuarios del seed y se entra
con un clic. Están las dos organizaciones y los cinco roles, que es lo que hace
falta para ver el aislamiento entre clientes funcionando de verdad.

**Ese login solo responde a peticiones que salen de tu propia máquina.** No es
una variable de entorno que haya que acordarse de apagar: la app mira el `Host`
y la dirección del par de la conexión, así que el día que quede publicada en un
dominio el login de desarrollo se apaga solo. La contracara: tampoco vas a poder
entrar desde el celular por la IP de la LAN.

### Pasos manuales, si preferís

```bash
./scripts/db.sh reset            # crea la base, migraciones y seed
node scripts/escenario.mjs       # el escenario de ejemplo (opcional)
cp .env.example .env.local       # completar DATABASE_URL y APP_SESSION_SECRET
npm run dev                      # o: npm run build && npm start
```

### Suites

| Comando | Qué prueba |
|---|---|
| `npm test` | Todo lo de abajo, contra `next dev` |
| `npm run test:humo` | Un build de **producción** real: compila, levanta `next start` y recorre la app entrando por la pantalla de login |

`test:humo` va aparte a propósito. Corriendo contra `next dev` pasaría igual —y
esa es la razón para separarlo: pasaría sin haber probado lo que dice probar. Ya
encontró dos cosas que `next dev` no muestra: la pantalla de login quedaba
cacheada como estática con la lista de usuarios vacía, y el login de desarrollo
se apagaba en producción sin dejar ninguna forma de entrar.

### Suites por separado

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
supabase/seed/         Restaurante de ejemplo: 40 insumos, 17 recetas, estructura de costos.
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

## Los widgets de IA

`lib/ia.ts` es la plataforma: un ejecutor genérico y cinco definiciones de
widget en `lib/widgets/`. La auditoría de cifras, el cálculo de costo y el
registro de la ejecución son del ejecutor, no de cada widget — un widget nuevo
no puede olvidarse de auditar.

| Widget | Qué hace | Qué calcula el SQL |
|---|---|---|
| Explicador de resultados | Responde preguntas sobre las métricas del período | Todas las métricas |
| Analista de menú | Recomienda qué hacer con cada plato | La clasificación Kasavana-Smith |
| Detector de anomalías | Prioriza señales y propone cómo confirmarlas | **La detección entera** |
| Ideas para redes | Plan semanal de contenido | Qué plato conviene empujar |
| Asistente de escandallos | Texto libre a ficha técnica | El emparejado con el catálogo |

El primero responde preguntas en lenguaje natural sobre las métricas del
período.

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

## Cierre financiero

`resumen_ebitda(desde, hasta)` y `punto_equilibrio(desde, hasta)` cierran el mes:
del ingreso al resultado, y cuánto habría que vender para no perder plata.

**El período del cierre es un mes calendario, no los días con ventas cargadas.**
El dashboard de ventas usa el rango exacto de las ventas; el cierre no puede.
El IVA se liquida por mes: una compra del día 3 y una venta del día 6 pertenecen
a la misma posición fiscal, y recortar el rango dejaría ese crédito afuera y
haría pagar de más. Los gastos fijos también son mensuales, y sobre un mes
completo el devengamiento es exacto en vez de arrastrar el redondeo del
prorrateo.

La contracara —un mes entero de alquiler contra tres días de ventas cargadas—
se dice en la pantalla en vez de disimularse recortando el período: *"hay ventas
en 3 de los 28 días del mes, pero la estructura se devenga por el mes completo"*.

**Los gastos fijos son un importe mensual con vigencia, no una fila por mes.**
El alquiler no es un evento de febrero: es $X por mes desde que se firmó el
contrato hasta que cambia. Un aumento se carga cerrando la vigencia y abriendo
una nueva, y por eso dar de baja un gasto **cierra su vigencia y nunca borra la
fila**: borrarla recalcularía meses ya cerrados y un período que estaba en rojo
pasaría a verde solo.

Los períodos parciales se prorratean **mes por mes, cada uno por su propia
cantidad de días**. Del 15 de enero al 14 de febrero son 17/31 más 14/28; el
atajo de "30 días por mes" desajusta febrero y los meses de 31.

**La categoría decide si el gasto entra en el EBITDA.** Intereses, amortizaciones
e impuesto a las ganancias quedan afuera por definición de la métrica, no por
criterio del usuario: si alguien carga la cuota de un préstamo y el sistema la
resta, el número deja de ser un EBITDA y pasa a ser otra cosa con el rótulo
equivocado. Se listan igual, debajo, porque hay que pagarlos.

**El EBITDA es la única métrica que NO usa el denominador de ventas costeadas.**
Es deliberado y se explica solo: el food cost se mide contra ventas costeadas
porque mezclar un costo parcial con ventas completas da un porcentaje falsamente
bajo; el EBITDA es el resultado del negocio, y el negocio incluye las cervezas
sin ficha técnica. La consecuencia se dice en voz alta: con cobertura parcial la
materia prima de esa porción no está descontada, así que **el EBITDA mostrado es
un techo**, no una estimación.

### Punto de equilibrio

```
punto de equilibrio = gastos fijos de caja / margen de contribución %
```

Dos decisiones que cambian el número y por eso se declaran:

- **El trabajo fichado cuenta como variable.** La brigada escala con la demanda;
  los sueldos de estructura van como gasto fijo, en su propia categoría. Meterlo
  todo del lado fijo infla el punto de equilibrio y lo vuelve inalcanzable en el
  papel.
- **La amortización queda afuera**: es un apunte contable, no una factura de este
  mes. Los intereses sí entran, porque al banco hay que pagarle.

Se calcula con el **cociente exacto**, nunca dividiendo por el margen de
contribución ya redondeado a dos decimales: ese redondeo intermedio se convierte
en cientos de miles de diferencia en las ventas necesarias, y hay un test que lo
comprueba. Si el margen de contribución no es positivo la función devuelve NULL
y la pantalla lo dice: cuando cada venta pierde plata no existe un volumen que
salve el mes, y un número inventado ahí es peor que un guion.

## IVA y retenciones

Alcance declarado desde el principio: **solo cálculo y reportes**. No hay
conexión con ARCA, SAT ni DIAN, y el sistema no emite comprobantes. Lo que
entrega es el papel que el contador necesita, con la trazabilidad de dónde sale
cada número.

**La alícuota es una propiedad del bien, no del comprobante.** Vive en el
producto y en el insumo; `config_fiscal` de la organización solo aporta el valor
por defecto, y no se copia al alta: si mañana cambia la alícuota general, las
fichas que nunca la definieron deben seguirla. En el ejemplo argentino los
alimentos frescos se compran al 10,5% y el plato terminado se vende al 21%, que
es por qué el crédito fiscal no es proporcional al débito.

**Los precios de gastronomía son finales al público, así que la base se despeja
hacia atrás** (`neto / (1 + tasa)`). Tratar un precio con IVA incluido como si
fuera neto sobredeclara el débito en un 21% del 21%.

**El importe de una retención se carga del certificado, no se deriva de base ×
alícuota.** Si no coinciden, manda el certificado. Y una retención mayor a la
posición **no produce un saldo negativo a pagar**: un saldo a favor no es "pagar
menos que cero", es crédito que se arrastra.

La pantalla informa además algo que el food cost no muestra: si los precios de
los insumos están cargados con IVA incluido y el negocio está inscripto, ese
crédito fiscal está hoy dentro del costo de materia prima y el food cost real es
más bajo que el del dashboard.

## Comparativo entre sucursales

Con una sola sucursal, el resultado del negocio es el del local. Con dos, el
promedio esconde el reparto: una sucursal sana puede estar financiando a otra
que pierde plata.

**Los gastos de organización se prorratean por participación en las ventas, y se
informan en columna aparte de los asignados.** Es una convención, no una verdad:
quien mire el número tiene que poder distinguir cuánto de la pérdida de una
sucursal es suya y cuánto le llegó repartido. Una sucursal sin ventas no recibe
prorrateo, pero sigue cargando con sus gastos propios — y aparece igual en el
comparativo, porque una sucursal que solo genera gastos es exactamente lo que
hay que ver.

**Invariante verificado por test: la suma de los EBITDA por sucursal es el EBITDA
de la organización.** Un comparativo que no cierra contra el total no sirve para
decidir nada.

## Menu engineering

`matriz_menu(desde, hasta)` clasifica cada plato cruzando popularidad y margen
(Kasavana-Smith): estrella, vaca lechera, rompecabezas o perro. Cada cuadrante
pide una acción distinta, y confundir un perro con una vaca lechera lleva a
retirar el plato que sostiene el volumen.

**El margen se compara por UNIDAD, no por porcentaje.** Un plato con 70% de
margen sobre $2.000 deja menos que uno con 30% sobre $12.000, y la carta se
diseña con pesos. La vara es el margen unitario *ponderado* del conjunto: un
plato que se vendió una vez no puede pesar lo mismo que uno que se vendió cien
veces al fijar el umbral de todos.

**Un producto sin ficha técnica no entra ni al numerador ni al denominador.**
Con margen cero quedaría clasificado como perro y llevaría a retirar un plato
que quizás sea el más rentable; y sus unidades, si contaran, bajarían la
participación de todos los demás y moverían el umbral. Lo que queda afuera se
informa al lado de la matriz.

**Una clasificación al borde del umbral no es un veredicto.** La matriz devuelve
la distancia a cada umbral, y la pantalla marca «en el borde» a los platos que
están a menos del 10%: en el escenario de ejemplo la hamburguesa queda a $67 de
ser estrella en vez de vaca, y presentar eso como una categoría cerrada sería
mentir con un dato cierto.

## Detección de anomalías

**La detección es SQL, no es el modelo.** Un detector donde el modelo mira una
tabla de números y opina cuál le llama la atención no es reproducible, no es
auditable, y un día deja de avisar sin que nadie se entere. `deteccion_anomalias()`
aplica siete reglas con umbrales explícitos —expuestos en pantalla, porque un
aviso que no dice contra qué vara se midió no se puede discutir— y calcula el
impacto en dinero de cada señal.

El modelo hace lo que la regla no puede: priorizar entre cosas de naturaleza
distinta, proponer causas y decir cómo confirmarlas.

**Las señales se ordenan por dinero, no por porcentaje.** Sobre el escenario de
ejemplo eso pone la suba del 37,5% del tomate ($793) por debajo del faltante del
40,95% de carne ($13.500) y de la hamburguesa que por Rappi retiene apenas el
52% de su margen ($13.520).

**Una señal no es un diagnóstico.** Un faltante de inventario puede ser robo,
porciones grandes, merma sin registrar o un conteo mal hecho. El widget devuelve
causas posibles y cómo distinguirlas; nunca acusa. Y devuelve también sus
propios falsos positivos: un detector que grita por todo se apaga a la semana.

Hay una señal que vale la pena señalar aparte: **`precio_futuro`**, una suba ya
cargada que rige después del período. Todavía no dolió, y por eso mismo es el
único aviso que llega a tiempo para renegociar o ajustar la carta.

## Ideas para redes

Sigue las convenciones de las skills `calendario-contenido` y
`copywriting-latam`: hooks de menos de quince palabras, títulos de hasta 60
caracteres, variedad obligatoria de pilar y formato, CTAs con fórmula verbo +
beneficio, WhatsApp como canal, y autenticidad antes que hype.

**El aporte propio es cuál plato promocionar.** Se alimenta de la matriz: la
prioridad son los *rompecabezas* —margen alto y poca venta, donde el contenido
rinde más— y explícitamente **no** las vacas lecheras, porque vender más de algo
que deja poco empeora el resultado.

**No inventa precios y no anuncia promociones.** Un precio que aparezca en una
pieza tiene que ser el del contexto. Una promoción es una decisión del dueño, no
de copy: si el widget quiere proponer una, va en un campo aparte, con el margen
que se resigna dicho de frente, y ninguna de las piezas la menciona.

El aviso de cifras sin respaldo cambia de texto en esta pantalla, y no es un
detalle: en un widget analítico una cifra sin respaldo es un error de cálculo;
acá es algo que el negocio va a publicar bajo su propio nombre. Que el sistema
no pueda respaldar «48 horas de fermentación» no la vuelve falsa, la vuelve
verificable.

## Asistente de escandallos

Convierte una receta escrita en texto libre en un borrador de ficha técnica.
Es el único widget que produce algo guardable, y por eso el más restringido:

**El modelo solo estructura.** No agrega ingredientes que el texto no menciona
por más que la receta clásica los lleve, y **no estima cantidades**: si dice
«sal a gusto», la cantidad queda en null y el motivo en la nota. Un gramaje
inventado se convierte en un costo inventado y de ahí en un precio de venta mal
calculado.

**El emparejado con el catálogo lo hace el trigrama de Postgres**, igual que en
el importador de ventas. Y solo se preselecciona con similitud ≥ 0,6:
preseleccionar mal es peor que no preseleccionar, porque la persona confirma sin
mirar y el costo equivocado entra sin que nada avise. Por debajo de ese umbral la
línea queda sin elegir y el botón de guardar no se habilita.

**La auditoría de cifras es contra el texto de entrada**, no contra la base:
acá «inventar» es agregar un gramaje que la persona nunca escribió, y hay un test
que planta exactamente ese caso.

**Nada se guarda sin confirmación humana.** Y si el rendimiento no estaba escrito
en el texto, la pantalla lo dice: ese número divide el costo de toda la ficha.

## Menu engineering, en gráfico

La matriz se dibuja como scatter siguiendo la skill `dataviz`, y la decisión que
más importa es la de color: **una sola serie, un solo tono**. Pintar cada
cuadrante de un color distinto sería codificar con color lo que la *posición* ya
codifica — el cuadrante de un plato es dónde cae respecto de las dos líneas de
referencia, no un atributo aparte.

Esa decisión además esquiva un problema real: en un scatter la validación de
paleta corre sobre *todos* los pares, y ahí solo los tres primeros tonos de la
paleta pasan los pisos de separación; el cuarto pone amarillo junto a naranja y
no pasa. Con una serie no hay pares que validar. `validate_palette.js "#2a78d6"`
da PASS en las cinco comprobaciones.

El resto sale del mismo manual: punto de 9px con anillo del color de la
superficie, área de acierto de 24px (un punto de 8px es un blanco imposible),
grilla recesiva, etiquetas directas mientras los platos sean pocos, y la tabla
que sigue al gráfico como vista accesible del mismo dato.

## Turnos planificados

El fichaje dice lo que pasó; el turno planificado, lo que se esperaba. La
diferencia es lo único accionable: un costo laboral alto sin plan contra el cual
medirlo es un dato, no una decisión.

`plan_vs_real()` usa **FULL JOIN** a propósito, porque hay tres casos y un join
común se comería dos: el desvío de horas, el turno planificado que nadie fichó
(*ausente*) y el turno fichado sin plan (*sin planificar*) — que suele ser el más
caro, porque son horas que nadie presupuestó.

**El costo previsto usa la tarifa vigente y el real sale congelado del fichaje.**
Es una asimetría deliberada: un turno que todavía no ocurrió no puede congelar
nada. Se compara un presupuesto contra un hecho.

Un fichaje sin cerrar aparece con cero horas reales, así que la fila informa
aparte cuántos hay: sin eso, un turno abierto se lee como una ausencia.

## Movimientos y stock teórico

El plan pedía una tabla `movimientos_inventario`. Se implementó como **vista**:
una compra ya existe en `compras` y una merma en `mermas`, y duplicarlas en un
libro paralelo crea dos fuentes de verdad que se desincronizan el día que
alguien corrige una fila de un solo lado. Lo único que necesitaba tabla propia
son los ajustes y las transferencias, que no se derivan de nada.

`stock_teorico(fecha)` responde qué *debería* haber: último conteo + entradas −
salidas − consumo teórico. **Devuelve siempre la fecha del conteo base y los días
transcurridos**, porque un stock calculado sobre un conteo de hace tres meses
arrastra tres meses de error y presentarlo sin esa fecha le da una precisión que
no tiene.

### El riesgo que trajo la funcionalidad, y cómo se cerró

Agregar transferencias sin tocar nada más habría metido un error silencioso en
la métrica insignia del producto: mover carne de un local a otro habría aparecido
como consumo sin explicar en el que la entregó. `varianza_periodo()` se
redefinió para incluir el término:

```
consumo real = inventario inicial + compras + movimientos netos − inventario final
```

Y al escribir el test apareció un segundo problema, este preexistente: **la
varianza no filtraba por sucursal**. Un conteo de Casa Central se comparaba
contra las compras de toda la organización, y una transferencia interna se
anulaba sola (la salida de un local y la entrada del otro suman cero). Ahora
compras, mermas y movimientos se filtran por la sucursal de los conteos.

## Mermas

El KPI que faltaba del tablero. Se mide contra las **ventas costeadas**, el mismo
denominador que el food cost: contra las ventas totales daría sistemáticamente
más bajo y dejaría de ser comparable con el resto del tablero.

Cuando no hay ninguna merma registrada el tablero no muestra un cero
tranquilizador: dice que eso rara vez significa que no hubo desperdicio, y que
sin registro todo termina apareciendo después como varianza sin explicar.

## Dos cosas del plan que no se implementaron, y por qué

**Vistas materializadas para los KPIs.** El plan las pedía por rendimiento. Con
los volúmenes actuales las vistas normales resuelven en milisegundos y tienen
una propiedad que las materializadas pierden: están siempre frescas. Materializar
introduce una ventana en la que el tablero muestra números viejos y nadie se
entera — exactamente el tipo de error que este proyecto viene evitando. El
disparador para revisarlo es medible: cuando una consulta del tablero pase de
~200 ms con datos reales de un cliente.

**Una tabla `configuracion_fiscal` aparte.** Quedó como `organizaciones.config_fiscal`
(jsonb) más `iva_pct` en producto e insumo. Es la misma información con menos
piezas, y pone la alícuota donde de verdad vive: en el bien, no en una tabla de
parámetros.
