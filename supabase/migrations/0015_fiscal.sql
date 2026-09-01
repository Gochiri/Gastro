-- 0015_fiscal.sql
-- Reportes de IVA y retenciones.
--
-- Alcance declarado desde el principio del proyecto: SOLO CÁLCULO Y REPORTES.
-- El sistema no emite comprobantes ni se conecta con ARCA, SAT ni DIAN. Lo que
-- entrega es el papel que el contador necesita para liquidar, con la
-- trazabilidad de dónde salió cada número.

-- ---------------------------------------------------------------------------
-- Alícuotas
-- ---------------------------------------------------------------------------

-- La alícuota es una propiedad del bien, no del comprobante: la carne va a
-- 10,5% en Argentina y la cerveza a 21% aunque estén en la misma factura.
-- Por eso vive en el producto y en el insumo, y la config de la organización
-- solo aporta el valor por defecto.
alter table productos add column if not exists iva_pct numeric(5,2)
  check (iva_pct is null or (iva_pct >= 0 and iva_pct <= 100));
alter table insumos   add column if not exists iva_pct numeric(5,2)
  check (iva_pct is null or (iva_pct >= 0 and iva_pct <= 100));
-- En la compra puntual puede haber una alícuota distinta a la del insumo
-- (un proveedor monotributista, un producto importado). Si va NULL se hereda.
alter table compras   add column if not exists iva_pct numeric(5,2)
  check (iva_pct is null or (iva_pct >= 0 and iva_pct <= 100));

comment on column productos.iva_pct is
  'NULL hereda config_fiscal->iva_general de la organización. No se copia el valor al alta: si mañana cambia la alícuota general, las fichas que nunca la definieron deben seguirla.';

-- Claves reconocidas en organizaciones.config_fiscal:
--   iva_general          numeric  alícuota por defecto
--   iva_alimentos        numeric  informativa, para cargar en productos e insumos
--   precios_con_iva      boolean  (default true) los precios de venta ya lo incluyen
--   compras_con_iva      boolean  (default true) el costo de compra ya lo incluye
--   ingresos_brutos_pct  numeric  alícuota provincial sobre ventas (AR)
create or replace function app_config_num(p_org uuid, p_clave text)
returns numeric
language sql
stable
as $$
  select nullif(config_fiscal ->> p_clave, '')::numeric
  from organizaciones where id = p_org
$$;

create or replace function app_config_bool(p_org uuid, p_clave text, p_default boolean)
returns boolean
language sql
stable
as $$
  select coalesce((select nullif(config_fiscal ->> p_clave, '')::boolean
                   from organizaciones where id = p_org), p_default)
$$;

-- ---------------------------------------------------------------------------
-- Retenciones y percepciones
-- ---------------------------------------------------------------------------

create type tipo_retencion    as enum ('iva', 'ganancias', 'ingresos_brutos', 'suss', 'otros');
create type sentido_retencion as enum ('sufrida', 'practicada');

-- En LATAM los agregadores de delivery retienen IVA e Ingresos Brutos sobre
-- cada liquidación. Ese dinero YA se pagó: si no se computa, el negocio lo
-- paga dos veces. Es la razón principal por la que esta tabla existe.
create table retenciones (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  fecha           date not null,
  tipo            tipo_retencion not null,
  sentido         sentido_retencion not null default 'sufrida',
  contraparte     text not null check (length(trim(contraparte)) > 0),
  comprobante     text,
  base_imponible  numeric(14,2) check (base_imponible >= 0),
  alicuota_pct    numeric(6,3)  check (alicuota_pct >= 0),
  -- El importe es el dato duro: es lo que dice el certificado. Base y alícuota
  -- son de referencia y pueden faltar; el importe nunca se recalcula a partir
  -- de ellas, porque el certificado manda.
  importe         numeric(14,2) not null check (importe >= 0),
  notas           text,
  creada_en       timestamptz not null default now()
);
create index on retenciones (organizacion_id);
create index on retenciones (organizacion_id, fecha);

comment on table retenciones is
  'Retenciones y percepciones sufridas (y practicadas, si el negocio es agente). El importe se carga del certificado y no se deriva de base x alícuota: si no coinciden, manda el certificado.';

-- ---------------------------------------------------------------------------
-- IVA por alícuota
-- ---------------------------------------------------------------------------

create or replace function reporte_iva(p_desde date, p_hasta date)
returns table (
  tasa           numeric,
  ventas_base    numeric,
  iva_debito     numeric,
  compras_base   numeric,
  iva_credito    numeric
)
language sql
stable
as $$
  with v_ventas as (
    select coalesce(p.iva_pct, app_config_num(v.organizacion_id, 'iva_general'), 0) as tasa,
           v.neto,
           app_config_bool(v.organizacion_id, 'precios_con_iva', true) as incluido
    from vista_ventas_analitica v
    join productos p on p.id = v.producto_id
    where v.fecha between p_desde and p_hasta
  ),
  ventas_calc as (
    select tasa,
           -- Precio final al público: la base gravada se despeja hacia atrás.
           -- Tratar un precio con IVA como si fuera neto sobredeclara el
           -- débito en un 21% del 21%.
           case when incluido then neto / (1 + tasa / 100) else neto end as base
    from v_ventas
  ),
  v_compras as (
    select coalesce(c.iva_pct, i.iva_pct, app_config_num(c.organizacion_id, 'iva_general'), 0) as tasa,
           c.costo_total,
           app_config_bool(c.organizacion_id, 'compras_con_iva', true) as incluido
    from compras c
    join insumos i on i.id = c.insumo_id
    where c.fecha between p_desde and p_hasta
  ),
  compras_calc as (
    select tasa,
           case when incluido then costo_total / (1 + tasa / 100) else costo_total end as base
    from v_compras
  ),
  tasas as (
    select tasa from ventas_calc union select tasa from compras_calc
  )
  select t.tasa,
         round(coalesce(v.base, 0), 2),
         round(coalesce(v.base, 0) * t.tasa / 100, 2),
         round(coalesce(c.base, 0), 2),
         round(coalesce(c.base, 0) * t.tasa / 100, 2)
  from tasas t
  left join (select tasa, sum(base) as base from ventas_calc  group by tasa) v on v.tasa = t.tasa
  left join (select tasa, sum(base) as base from compras_calc group by tasa) c on c.tasa = t.tasa
  order by t.tasa desc
$$;

comment on function reporte_iva is
  'Base imponible y IVA por alícuota, separando débito (ventas) de crédito (compras). Los importes se despejan del precio final cuando la organización trabaja con precios con IVA incluido, que es lo normal en gastronomía.';

-- ---------------------------------------------------------------------------
-- Posición fiscal del período
-- ---------------------------------------------------------------------------

create or replace function resumen_fiscal(p_desde date, p_hasta date)
returns table (
  iva_debito              numeric,
  iva_credito             numeric,
  iva_posicion            numeric,   -- positivo = a pagar; negativo = saldo a favor
  retenciones_iva         numeric,
  iva_a_pagar             numeric,
  ingresos_brutos_pct     numeric,
  ingresos_brutos_base    numeric,
  ingresos_brutos         numeric,
  retenciones_ib          numeric,
  ib_a_pagar              numeric,
  retenciones_ganancias   numeric,
  retenciones_otras       numeric,
  total_estimado          numeric,
  ventas_del_periodo      numeric
)
language sql
stable
as $$
  with iva as (
    select coalesce(sum(iva_debito), 0) as debito,
           coalesce(sum(iva_credito), 0) as credito
    from reporte_iva(p_desde, p_hasta)
  ),
  ret as (
    select coalesce(sum(importe) filter (where tipo = 'iva'), 0)             as iva,
           coalesce(sum(importe) filter (where tipo = 'ingresos_brutos'), 0) as ib,
           coalesce(sum(importe) filter (where tipo = 'ganancias'), 0)       as ganancias,
           coalesce(sum(importe) filter (where tipo in ('suss','otros')), 0) as otras
    from retenciones
    where fecha between p_desde and p_hasta and sentido = 'sufrida'
  ),
  ventas as (
    select coalesce(sum(neto), 0) as neto,
           -- Ingresos Brutos grava la facturación, y la alícuota es la de la
           -- organización porque el impuesto se liquida por contribuyente.
           max(app_config_num(organizacion_id, 'ingresos_brutos_pct')) as ib_pct,
           coalesce(sum(neto / (1 + coalesce(app_config_num(organizacion_id, 'iva_general'), 0) / 100))
                    filter (where app_config_bool(organizacion_id, 'precios_con_iva', true)), 0)
             + coalesce(sum(neto) filter (where not app_config_bool(organizacion_id, 'precios_con_iva', true)), 0)
             as base_ib
    from vista_ventas_analitica
    where fecha between p_desde and p_hasta
  ),
  calc as (
    select iva.debito, iva.credito, iva.debito - iva.credito as posicion,
           ret.iva, ret.ib, ret.ganancias, ret.otras,
           ventas.neto, ventas.ib_pct, ventas.base_ib,
           coalesce(ventas.base_ib * ventas.ib_pct / 100, 0) as ib_calculado
    from iva, ret, ventas
  )
  select round(debito, 2),
         round(credito, 2),
         round(posicion, 2),
         round(iva, 2),
         -- Nunca se informa negativo por retenciones: un saldo a favor no es
         -- "pagar menos que cero", es crédito que se arrastra al mes siguiente.
         round(greatest(posicion - iva, 0), 2),
         ib_pct,
         round(base_ib, 2),
         round(ib_calculado, 2),
         round(ib, 2),
         round(greatest(ib_calculado - ib, 0), 2),
         round(ganancias, 2),
         round(otras, 2),
         round(greatest(posicion - iva, 0) + greatest(ib_calculado - ib, 0), 2),
         round(neto, 2)
  from calc
$$;

comment on function resumen_fiscal is
  'Estimación de la posición fiscal del período. No reemplaza la liquidación del contador: no contempla saldos arrastrados de meses anteriores, exenciones ni regímenes especiales.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('retenciones', $r$array['propietario','gerente','contador']$r$)
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
