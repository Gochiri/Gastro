# CLAUDE.md

Sistema de gestión gastronómica: SaaS multi-negocio para restaurantes de LATAM.

@AGENTS.md

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind
- PostgreSQL 16, en producción sobre Supabase
- Acceso a datos: `pg` directo desde Server Components. **No** se usa
  `@supabase/supabase-js` para datos (ver README, sección Decisiones).

## Reglas siempre activas

Ver `.claude/rules/`: convenciones de `common/`, `typescript/` y `react/`
(origen: proyecto ECC). En resumen, lo que más se incumple:

- Tipos explícitos en funciones exportadas. Nada de `any`; `unknown` + estrechado
  para entrada externa.
- Derivar en el render, no guardar estado derivado en `useEffect`.
- Server Components por defecto; `'use client'` solo donde hace falta
  interactividad.
- E2E con Playwright para los flujos críticos.

## Reglas propias, no negociables

1. **Toda tabla con `organizacion_id` lleva RLS activado y forzado.**
   `supabase/tests/test_rls_estructura.sql` falla si alguna no lo tiene.
2. **Las vistas se crean con `security_invoker = true`.** Por defecto una vista
   corre con permisos de su dueño y hace bypass de RLS.
3. **El acceso a la base pasa siempre por `withTenant()` de `lib/db.ts`.**
   Ningún otro archivo abre conexiones. El contexto de tenant es transaccional:
   un `set_config` de sesión filtraría la identidad entre peticiones del pool.
4. **La app nunca se conecta como superusuario ni con `service_role`:** esos
   roles ignoran RLS.
5. **Los importes son `numeric`, nunca `float`.**
6. **Ningún cálculo de costos o KPIs se hace en JavaScript.** Vive en SQL, donde
   está probado contra cálculo manual.

## Comandos

```bash
./scripts/db.sh reset   # recrear base local con migraciones y seed
./scripts/test.sh       # suite SQL (RLS + costeo)
npm run dev             # app en desarrollo
npx playwright test     # E2E
```

## Next.js 16: diferencias que rompen

- El middleware es `proxy.ts`, **no** `middleware.ts`.
- `params` y `searchParams` son promesas: hay que `await`.
- `cookies()` de `next/headers` es asíncrono.
- Ante la duda, la fuente es `node_modules/next/dist/docs/`, no la memoria.

## Reglas propias de la fase de ventas

7. **El costo de una venta se congela al importar**, junto con la comisión del
   canal. Nada recalcula el histórico de forma implícita: para eso está
   `recalcular_costos_ventas()`.
8. **Ningún emparejado automático de productos.** `proponer_productos()` sugiere;
   confirma una persona. Cada confirmación se guarda como alias.
9. **Un producto sin receta no muestra margen ni food cost**, muestra un guion.
   La cobertura de costeo va siempre junto al food cost.
10. **Los importes de CSV pasan por `lib/numeros.ts`.** El formato se detecta por
    columna, nunca valor por valor.

## Reglas de la fase de inventario

11. **El consumo teórico se calcula en cantidades brutas**, con la merma de
    limpieza aplicada: de la cámara sale el producto sin limpiar.
12. **Teórico y real se valúan al mismo precio.** Mezclar precios convierte la
    varianza de uso en una mezcla inútil de dos problemas distintos.
13. **Un insumo contado en un solo conteo no entra al informe.**
14. **Registrar una compra no toca `precios_insumo`.**

## Tests: concurrencia

Los tests comparten UN Postgres. `node --test` paraleliza archivos y Playwright
paraleliza suites: ambos están forzados a serializar (`workers: 1`, invocaciones
separadas por archivo). Cada archivo que escribe en la base la recrea en su
`before`, así ninguno depende del orden.

## Reglas del módulo de IA

15. **El modelo nunca hace aritmética.** Toda cifra, incluidas las derivadas,
    se calcula en SQL y viaja resuelta en el contexto.
16. **Toda respuesta se audita** contra los valores del contexto. Las cifras sin
    respaldo se registran y se muestran como advertencia, nunca se ocultan.
17. **El auditor considera las lecturas ambiguas de un número** y solo marca si
    ninguna coincide: una advertencia con falsos positivos se ignora.
18. **La llamada al modelo es inyectable** (`Invocador`), para poder probar todo
    lo demás sin credenciales.
19. **Cada ejecución se registra** con tokens y costo, incluidos los fallos.

## Reglas de la fase de personal y compras

20. **El costo de una hora incluye las cargas patronales.** Nunca usar
    `costo_hora` suelto para calcular costo laboral.
21. **La fecha de un turno se guarda resuelta en la zona del negocio.**
    `entrada::date` depende de la zona de la sesión y no es indexable.
22. **Los fichajes sin cerrar se informan, no se estiman.**
23. **Confirmar una recepción genera compras**, y solo toca `precios_insumo` si
    se pidió explícitamente.
24. **Todo denominador de food cost son las ventas costeadas**, calculadas
    directo y nunca reconstruidas desde un porcentaje redondeado.

## Reglas del cierre financiero

25. **El período del cierre es un mes calendario**, no el rango de días con
    ventas. El IVA se liquida por mes y los gastos fijos son mensuales. Si el
    mes tiene menos días de ventas cargadas, se avisa; no se recorta el período.
26. **El EBITDA es la única métrica que usa ventas TOTALES como denominador.**
    Con cobertura de costeo parcial es un techo, y hay que decirlo junto al
    número. La regla 24 sigue valiendo para todo lo demás.
27. **La categoría del gasto decide si entra en el EBITDA**
    (`app_gasto_en_ebitda`), no el usuario. Intereses, amortizaciones e impuesto
    a las ganancias quedan afuera por definición de la métrica.
28. **Dar de baja un gasto fijo cierra su vigencia; nunca se borra la fila.**
    Borrarla recalcularía meses ya cerrados.
29. **El punto de equilibrio se calcula con el cociente exacto**, nunca
    dividiendo por el margen de contribución ya redondeado. Sin margen de
    contribución positivo devuelve NULL, no un número.
30. **El importe de una retención se carga del certificado**, no se deriva de
    base × alícuota, y un saldo a favor nunca se informa como "a pagar"
    negativo.
31. **En el comparativo de sucursales, los gastos prorrateados van en columna
    aparte de los asignados**, y la suma de los EBITDA por sucursal tiene que dar
    el EBITDA de la organización.

## Reglas de los widgets de IA

32. **Todo widget se ejecuta por `ejecutarWidget()`**, nunca llamando al SDK
    directo. Ahí viven la auditoría de cifras, el costo y el registro.
33. **La clasificación y la detección se hacen en SQL.** El modelo interpreta,
    prioriza y recomienda; no clasifica un plato ni encuentra una anomalía.
34. **Cada señal informa su umbral.** Un aviso que no dice contra qué vara se
    midió no se puede discutir.
35. **El widget de redes no inventa precios ni anuncia promociones.** Una
    promoción va en su campo aparte, con el margen que se resigna.
36. **El asistente de escandallos no estima cantidades ni elige insumos**, y
    nada se guarda sin confirmación humana. Se preselecciona un insumo solo con
    similitud ≥ 0,6.
37. **Un producto sin ficha técnica no entra a la matriz de menu engineering**,
    ni al numerador ni al denominador.

## Reglas de turnos, movimientos y gráficos

38. **La varianza se calcula sobre la sucursal de sus conteos.** Compras, mermas
    y movimientos se filtran por esa sucursal; sin el filtro, una transferencia
    interna se anula sola.
39. **Todo movimiento manual entra en la ecuación de consumo real.** Mover
    mercadería entre locales no es consumirla.
40. **El stock teórico informa siempre su conteo base y los días transcurridos.**
41. **El costo de un turno planificado usa la tarifa vigente; el de un fichaje,
    la congelada.** Es un presupuesto contra un hecho, y se dice en pantalla.
42. **Antes de escribir cualquier gráfico se carga la skill `dataviz`**, y la
    paleta se valida con su script en vez de estimarla a ojo.
43. **No se codifica con color lo que la posición ya codifica.**
