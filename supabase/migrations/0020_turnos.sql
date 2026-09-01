-- 0020_turnos.sql
-- Turnos planificados, y su comparación contra lo realmente fichado.
--
-- El fichaje dice lo que pasó. El turno planificado dice lo que se esperaba que
-- pasara, y la diferencia entre los dos es lo único que se puede corregir: un
-- costo laboral alto sin plan contra el cual medirlo es un dato, no una
-- decisión. Con plan, es "el sábado se fue 6 horas por encima de lo previsto".

create table turnos_planificados (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references organizaciones(id) on delete cascade,
  sucursal_id     uuid references sucursales(id) on delete set null,
  empleado_id     uuid not null references empleados(id) on delete cascade,
  fecha           date not null,
  hora_inicio     time not null,
  hora_fin        time not null,
  notas           text,
  creado_en       timestamptz not null default now(),

  -- Un turno que termina antes de empezar es un turno que cruza la medianoche,
  -- y eso se carga como dos turnos. Permitirlo acá obligaría a adivinar.
  constraint turno_coherente check (hora_fin > hora_inicio),
  -- Un empleado no puede estar planificado dos veces el mismo día en el mismo
  -- horario de inicio: casi siempre es una carga duplicada.
  unique (empleado_id, fecha, hora_inicio)
);
create index on turnos_planificados (organizacion_id);
create index on turnos_planificados (organizacion_id, fecha);

comment on table turnos_planificados is
  'Lo que se esperaba trabajar. Se compara contra fichajes, que es lo que se trabajó. La diferencia es lo accionable.';

-- Horas planificadas y su costo a la tarifa VIGENTE del empleado.
--
-- Ojo con la asimetría: el fichaje congela la tarifa al cerrarse, el turno
-- planificado no puede hacerlo porque todavía no ocurrió. Por eso el costo
-- planificado se calcula al vuelo y el fichado sale congelado: comparar un
-- presupuesto contra un hecho.
create or replace view vista_turnos
with (security_invoker = true)
as
select t.id,
       t.organizacion_id,
       t.sucursal_id,
       t.empleado_id,
       e.nombre  as empleado,
       e.puesto,
       t.fecha,
       t.hora_inicio,
       t.hora_fin,
       round(extract(epoch from (t.hora_fin - t.hora_inicio)) / 3600.0, 4) as horas,
       round(
         (extract(epoch from (t.hora_fin - t.hora_inicio)) / 3600.0)
           * e.costo_hora
           * (1 + coalesce(e.cargas_sociales_pct, 0) / 100),
         2
       ) as costo_estimado
from turnos_planificados t
join empleados e on e.id = t.empleado_id;

grant select on vista_turnos to public;

-- ---------------------------------------------------------------------------
-- Planificado contra fichado
-- ---------------------------------------------------------------------------

-- Por empleado y día. Se usa FULL JOIN a propósito: importan las tres
-- situaciones, y dos de ellas desaparecerían con un join común.
--   - planificado y fichado: la desviación de horas
--   - planificado sin fichar: alguien que no vino
--   - fichado sin planificar: alguien que trabajó fuera del plan
create or replace function plan_vs_real(p_desde date, p_hasta date)
returns table (
  empleado_id       uuid,
  empleado          text,
  fecha             date,
  horas_plan        numeric,
  horas_reales      numeric,
  desvio_horas      numeric,
  costo_plan        numeric,
  costo_real        numeric,
  desvio_dinero     numeric,
  situacion         text,
  fichajes_abiertos bigint
)
language sql
stable
as $$
  with plan as (
    select empleado_id, empleado, fecha,
           sum(horas)          as horas,
           sum(costo_estimado) as costo
    from vista_turnos
    where fecha between p_desde and p_hasta
    group by empleado_id, empleado, fecha
  ),
  real as (
    select empleado_id, empleado, fecha,
           sum(horas) filter (where not abierto) as horas,
           sum(costo) filter (where not abierto) as costo,
           count(*)   filter (where abierto)     as abiertos
    from vista_fichajes
    where fecha between p_desde and p_hasta
    group by empleado_id, empleado, fecha
  )
  select coalesce(p.empleado_id, r.empleado_id),
         coalesce(p.empleado, r.empleado),
         coalesce(p.fecha, r.fecha),
         round(coalesce(p.horas, 0), 2),
         round(coalesce(r.horas, 0), 2),
         round(coalesce(r.horas, 0) - coalesce(p.horas, 0), 2),
         round(coalesce(p.costo, 0), 2),
         round(coalesce(r.costo, 0), 2),
         round(coalesce(r.costo, 0) - coalesce(p.costo, 0), 2),
         case
           when p.empleado_id is null then 'sin_planificar'
           when r.empleado_id is null then 'ausente'
           when abs(coalesce(r.horas, 0) - coalesce(p.horas, 0)) < 0.25 then 'en_plan'
           when coalesce(r.horas, 0) > coalesce(p.horas, 0) then 'excedido'
           else 'por_debajo'
         end,
         coalesce(r.abiertos, 0)
  from plan p
  full join real r
    on r.empleado_id = p.empleado_id and r.fecha = p.fecha
  order by abs(coalesce(r.costo, 0) - coalesce(p.costo, 0)) desc, 3, 2
$$;

comment on function plan_vs_real is
  'Desvío entre lo planificado y lo fichado, por empleado y día, ordenado por impacto en dinero. Un turno fichado sin plan y un turno planificado sin fichar son tan informativos como una diferencia de horas.';

create or replace function resumen_plan_vs_real(p_desde date, p_hasta date)
returns table (
  horas_plan       numeric,
  horas_reales     numeric,
  desvio_horas     numeric,
  costo_plan       numeric,
  costo_real       numeric,
  desvio_dinero    numeric,
  desvio_pct       numeric,
  dias_en_plan     bigint,
  dias_excedidos   bigint,
  dias_por_debajo  bigint,
  ausencias        bigint,
  sin_planificar   bigint
)
language sql
stable
as $$
  select round(coalesce(sum(horas_plan), 0), 2),
         round(coalesce(sum(horas_reales), 0), 2),
         round(coalesce(sum(horas_reales) - sum(horas_plan), 0), 2),
         round(coalesce(sum(costo_plan), 0), 2),
         round(coalesce(sum(costo_real), 0), 2),
         round(coalesce(sum(costo_real) - sum(costo_plan), 0), 2),
         round(100 * (sum(costo_real) - sum(costo_plan))
               / nullif(sum(costo_plan), 0), 2),
         count(*) filter (where situacion = 'en_plan'),
         count(*) filter (where situacion = 'excedido'),
         count(*) filter (where situacion = 'por_debajo'),
         count(*) filter (where situacion = 'ausente'),
         count(*) filter (where situacion = 'sin_planificar')
  from plan_vs_real(p_desde, p_hasta)
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('turnos_planificados', $r$array['propietario','gerente']$r$)
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
