-- 0014_gastos_fijos.sql
-- Gastos fijos, EBITDA y punto de equilibrio.
--
-- Hasta acá el sistema sabía lo que cuesta producir y vender un plato. Lo que
-- no sabía es cuánto cuesta tener el local abierto. Sin ese número, "food cost
-- 20%" suena bien y no dice nada: un restaurante con food cost sano puede
-- fundirse igual si el alquiler se come el margen.

-- ---------------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------------

-- La categoría no es decorativa: define si el gasto entra en el EBITDA. El
-- EBITDA es el resultado ANTES de intereses, impuestos a las ganancias,
-- depreciaciones y amortizaciones. Si alguien carga la cuota de un préstamo
-- como gasto fijo y el sistema la resta, el número deja de ser un EBITDA y
-- pasa a ser otra cosa con el rótulo equivocado.
create type categoria_gasto as enum (
  'alquiler',
  'servicios',                -- luz, gas, agua, internet
  'sueldos_administrativos',  -- estructura, no la brigada que ficha
  'marketing',
  'mantenimiento',
  'seguros',
  'licencias',                -- software, habilitaciones, membresías
  'impuestos_municipales',    -- tasas y contribuciones: son operativos
  'otros',
  'financiero',               -- intereses y comisiones bancarias  -> fuera
  'amortizacion',             -- depreciación del equipamiento     -> fuera
  'impuesto_ganancias'        --                                   -> fuera
);

create or replace function app_gasto_en_ebitda(p_categoria categoria_gasto)
returns boolean
language sql
immutable
as $$
  select p_categoria not in ('financiero', 'amortizacion', 'impuesto_ganancias')
$$;

comment on function app_gasto_en_ebitda is
  'Qué categorías forman parte del EBITDA. Intereses, amortizaciones e impuesto a las ganancias quedan afuera por definición de la métrica, no por criterio del usuario.';

-- La amortización es la única que además NO es salida de caja: para el punto
-- de equilibrio de caja hay que descontarla.
create or replace function app_gasto_es_caja(p_categoria categoria_gasto)
returns boolean
language sql
immutable
as $$
  select p_categoria <> 'amortizacion'
$$;

-- ---------------------------------------------------------------------------
-- Gastos fijos
-- ---------------------------------------------------------------------------

-- Modelados como un importe mensual con período de vigencia, no como una fila
-- por mes. El alquiler no es un evento de febrero: es $X por mes desde que se
-- firmó el contrato hasta que cambia. Cargarlo mes a mes obliga a doce altas
-- por año y garantiza que en algún momento falte una.
create table gastos_fijos (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  -- NULL = gasto de toda la organización (contadora, seguro corporativo).
  -- Se prorratea entre sucursales solo en el comparativo, y ahí se informa.
  sucursal_id     uuid references sucursales(id) on delete set null,
  categoria       categoria_gasto not null,
  concepto        text not null check (length(trim(concepto)) > 0),
  importe_mensual numeric(14,2) not null check (importe_mensual >= 0),
  vigente_desde   date not null,
  vigente_hasta   date,
  notas           text,
  creado_en       timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create index on gastos_fijos (organizacion_id);
create index on gastos_fijos (organizacion_id, vigente_desde);

comment on table gastos_fijos is
  'Importe mensual con vigencia. Un aumento de alquiler se carga cerrando la fila vigente y abriendo una nueva: así el resultado de marzo no se recalcula con el alquiler de agosto.';

-- ---------------------------------------------------------------------------
-- Devengamiento
-- ---------------------------------------------------------------------------

-- Un período de análisis casi nunca es un mes calendario. Prorratear por días
-- sobre un mes de 30 fijos desajusta febrero y los meses de 31; se prorratea
-- mes por mes, cada uno por su propia cantidad de días.
create or replace function gastos_fijos_devengados(p_desde date, p_hasta date)
returns table (
  gasto_id        uuid,
  sucursal_id     uuid,
  sucursal        text,
  categoria       categoria_gasto,
  concepto        text,
  importe_mensual numeric,
  dias            integer,
  importe         numeric,
  en_ebitda       boolean,
  es_caja         boolean
)
language sql
stable
as $$
  with meses as (
    select m::date                                as inicio,
           (m + interval '1 month - 1 day')::date as fin,
           extract(day from (m + interval '1 month - 1 day'))::numeric as dias_mes
    from generate_series(date_trunc('month', p_desde),
                         date_trunc('month', p_hasta),
                         interval '1 month') as m
  ),
  tramos as (
    select g.id, g.sucursal_id, g.categoria, g.concepto, g.importe_mensual,
           greatest(m.inicio, g.vigente_desde, p_desde)                          as desde,
           least(m.fin, coalesce(g.vigente_hasta, 'infinity'::date), p_hasta)    as hasta,
           m.dias_mes
    from gastos_fijos g cross join meses m
  ),
  contados as (
    select id, sucursal_id, categoria, concepto, importe_mensual,
           (hasta - desde + 1) as dias, dias_mes
    from tramos
    where hasta >= desde
  )
  select c.id,
         c.sucursal_id,
         s.nombre,
         c.categoria,
         c.concepto,
         c.importe_mensual,
         sum(c.dias)::integer,
         round(sum(c.importe_mensual * c.dias / c.dias_mes), 2),
         app_gasto_en_ebitda(c.categoria),
         app_gasto_es_caja(c.categoria)
  from contados c
  left join sucursales s on s.id = c.sucursal_id
  group by c.id, c.sucursal_id, s.nombre, c.categoria, c.concepto, c.importe_mensual
  order by 8 desc
$$;

comment on function gastos_fijos_devengados is
  'Gasto fijo imputado a un rango de fechas, prorrateado día por día sobre la cantidad real de días de cada mes que toca.';

-- Cada concepto se redondea por separado y el resumen suma los redondeados:
-- así el total coincide con la suma de la columna que se ve en pantalla, que es
-- lo que el usuario va a verificar con la calculadora. Sobre un período parcial
-- eso puede quedar a un centavo del importe exacto; sobre un mes completo el
-- prorrateo es 1:1 y no hay diferencia.
create or replace function resumen_gastos_fijos(p_desde date, p_hasta date)
returns table (
  total            numeric,
  en_ebitda        numeric,
  fuera_ebitda     numeric,
  de_caja          numeric,
  asignados        numeric,   -- con sucursal
  sin_asignar      numeric,   -- de toda la organización
  conceptos        bigint
)
language sql
stable
as $$
  select round(coalesce(sum(importe), 0), 2),
         round(coalesce(sum(importe) filter (where en_ebitda), 0), 2),
         round(coalesce(sum(importe) filter (where not en_ebitda), 0), 2),
         round(coalesce(sum(importe) filter (where es_caja), 0), 2),
         round(coalesce(sum(importe) filter (where sucursal_id is not null), 0), 2),
         round(coalesce(sum(importe) filter (where sucursal_id is null), 0), 2),
         count(*)
  from gastos_fijos_devengados(p_desde, p_hasta)
$$;

-- ---------------------------------------------------------------------------
-- EBITDA
-- ---------------------------------------------------------------------------

-- Denominador: ventas TOTALES, no las costeadas.
--
-- Es una excepción deliberada a la regla del food cost, y conviene decir por
-- qué. El food cost se calcula sobre ventas costeadas porque mezclar un costo
-- parcial con ventas completas da un porcentaje falsamente bajo. El EBITDA es
-- otra cosa: es el resultado del negocio, y el negocio incluye las cervezas
-- sin ficha técnica. Calcularlo sobre el 88% de las ventas daría el resultado
-- de un negocio que no existe.
--
-- La consecuencia hay que decirla en voz alta: si hay ventas sin costear, su
-- materia prima no está descontada y el EBITDA informado es un TECHO, no una
-- estimación. Por eso la función devuelve `ventas_sin_costear`: la pantalla lo
-- muestra al lado del número, no en una nota al pie.
create or replace function resumen_ebitda(p_desde date, p_hasta date)
returns table (
  ventas_netas            numeric,
  comisiones              numeric,
  costo_materia_prima     numeric,
  costo_laboral           numeric,
  margen_contribucion     numeric,
  margen_contribucion_pct numeric,
  gastos_fijos            numeric,
  ebitda                  numeric,
  ebitda_pct              numeric,
  gastos_fuera_ebitda     numeric,
  resultado               numeric,
  ventas_sin_costear      numeric,
  cobertura_costeo_pct    numeric,
  fichajes_abiertos       bigint
)
language sql
stable
as $$
  with v as (
    select coalesce(sum(neto), 0)                            as neto,
           coalesce(sum(comision), 0)                        as comision,
           coalesce(sum(costo), 0)                           as costo,
           coalesce(sum(neto) filter (where not costeada), 0) as sin_costear,
           coalesce(sum(neto) filter (where costeada), 0)     as costeadas
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta
  ),
  t as (select * from costo_laboral(p_desde, p_hasta)),
  g as (select * from resumen_gastos_fijos(p_desde, p_hasta)),
  calc as (
    select v.neto, v.comision, v.costo, v.sin_costear, v.costeadas,
           t.costo_total as laboral, t.fichajes_abiertos,
           g.en_ebitda as fijos_ebitda, g.fuera_ebitda,
           v.neto - v.comision - v.costo - t.costo_total as mc
    from v, t, g
  )
  select round(neto, 2),
         round(comision, 2),
         round(costo, 2),
         round(laboral, 2),
         round(mc, 2),
         round(100 * mc / nullif(neto, 0), 2),
         round(fijos_ebitda, 2),
         round(mc - fijos_ebitda, 2),
         round(100 * (mc - fijos_ebitda) / nullif(neto, 0), 2),
         round(fuera_ebitda, 2),
         round(mc - fijos_ebitda - fuera_ebitda, 2),
         round(sin_costear, 2),
         round(100 * costeadas / nullif(neto, 0), 2),
         fichajes_abiertos
  from calc
$$;

comment on function resumen_ebitda is
  'EBITDA del período. El costo laboral es el de los fichajes cerrados: los abiertos se informan aparte porque un turno sin cerrar abarata el resultado sin que se note.';

-- ---------------------------------------------------------------------------
-- Punto de equilibrio
-- ---------------------------------------------------------------------------

-- Cuánto hay que vender para no perder plata.
--
--   punto de equilibrio = gastos fijos de caja / margen de contribución %
--
-- Dos decisiones que cambian el número y por lo tanto hay que declarar:
--
-- 1. El trabajo fichado cuenta como VARIABLE. En un restaurante la brigada
--    escala con la demanda: un sábado lleno tiene más gente que un lunes. Los
--    sueldos de estructura (administración) van como gasto fijo, en su propia
--    categoría. Meter todo el trabajo del lado fijo infla el punto de
--    equilibrio y lo vuelve inalcanzable en el papel.
--
-- 2. Se usan los gastos fijos DE CAJA: la amortización queda afuera. Es un
--    apunte contable, no una factura que haya que pagar este mes. Los
--    intereses SÍ entran: al banco hay que pagarle.
create or replace function punto_equilibrio(p_desde date, p_hasta date)
returns table (
  gastos_fijos_caja       numeric,
  margen_contribucion     numeric,
  margen_contribucion_pct numeric,
  ventas_equilibrio       numeric,
  ventas_reales           numeric,
  brecha                  numeric,
  alcanzado               boolean,
  dias                    integer,
  venta_diaria_equilibrio numeric,
  venta_diaria_real       numeric
)
language sql
stable
as $$
  with e as (select * from resumen_ebitda(p_desde, p_hasta)),
       g as (select * from resumen_gastos_fijos(p_desde, p_hasta)),
       d as (select (p_hasta - p_desde + 1) as dias),
       calc as (
         select g.de_caja,
                e.margen_contribucion as mc,
                e.ventas_netas        as ventas,
                d.dias,
                -- El punto de equilibrio se calcula con el COCIENTE exacto, no
                -- con el margen de contribución ya redondeado a dos decimales:
                -- ese redondeo, dividido, se convierte en cientos de miles de
                -- diferencia en las ventas necesarias.
                case when e.margen_contribucion > 0
                     then g.de_caja * e.ventas_netas / e.margen_contribucion
                end as equilibrio
         from e, g, d
       )
  select round(de_caja, 2),
         round(mc, 2),
         round(100 * mc / nullif(ventas, 0), 2),
         round(equilibrio, 2),
         round(ventas, 2),
         round(ventas - equilibrio, 2),
         ventas >= equilibrio,
         dias,
         round(equilibrio / nullif(dias, 0), 2),
         round(ventas / nullif(dias, 0), 2)
  from calc
$$;

comment on function punto_equilibrio is
  'Ventas necesarias para EBITDA cero en el mismo largo de período. Si el margen de contribución no es positivo devuelve NULL: cuando cada venta pierde plata no existe un volumen que salve el mes, y un número inventado ahí es peor que un guion.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('gastos_fijos', $r$array['propietario','gerente','contador']$r$)
    ) as v(tabla, roles)
  loop
    execute format('alter table %I enable row level security', t.tabla);
    execute format('alter table %I force row level security', t.tabla);
    for pol in select polname from pg_policy p
               join pg_class c on c.oid = p.polrelid where c.relname = t.tabla
    loop
      execute format('drop policy if exists %I on %I', pol, t.tabla);
    end loop;
    execute format(
      'create policy %I on %I for select using (organizacion_id in (select app_organizaciones_del_usuario()))',
      t.tabla || '_lectura', t.tabla);
    execute format(
      'create policy %I on %I for all
         using      (organizacion_id in (select app_organizaciones_con_rol(%s::rol_miembro[])))
         with check (organizacion_id in (select app_organizaciones_con_rol(%s::rol_miembro[])))',
      t.tabla || '_escritura', t.tabla, t.roles, t.roles);
  end loop;
end $$;
