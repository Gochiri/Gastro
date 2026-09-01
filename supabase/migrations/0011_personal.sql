-- 0011_personal.sql
-- Personal, fichajes y costo laboral: la mitad que falta del prime cost.
--
--   prime cost = (costo de materia prima + costo laboral) / ventas
--
-- Es el número que define la supervivencia de un restaurante. Por encima del
-- 65% el negocio no deja margen para alquiler, servicios y ganancia.

-- La zona horaria es del NEGOCIO, no del servidor. Un turno que arranca a las
-- 22:00 en Buenos Aires cae al día siguiente si el servidor corre en UTC, y el
-- costo laboral diario queda mal repartido.
alter table organizaciones
  add column if not exists zona_horaria text not null default 'UTC';

update organizaciones set zona_horaria = 'America/Argentina/Buenos_Aires' where pais = 'AR';
update organizaciones set zona_horaria = 'America/Mexico_City'            where pais = 'MX';
update organizaciones set zona_horaria = 'America/Bogota'                 where pais = 'CO';
update organizaciones set zona_horaria = 'America/Santiago'               where pais = 'CL';

create table empleados (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null references organizaciones(id) on delete cascade,
  sucursal_id          uuid references sucursales(id) on delete set null,
  nombre               text not null check (length(trim(nombre)) > 0),
  puesto               text,
  costo_hora           numeric(12,4) not null check (costo_hora >= 0),
  -- Aportes patronales, ART, seguros: en la región suele rondar el 30-45%.
  -- El costo real de una hora de trabajo NO es el sueldo bruto por hora.
  cargas_sociales_pct  numeric(5,2) not null default 0
                         check (cargas_sociales_pct >= 0 and cargas_sociales_pct < 200),
  activo               boolean not null default true,
  creado_en            timestamptz not null default now(),
  unique (organizacion_id, nombre)
);
create index on empleados (organizacion_id);

comment on column empleados.cargas_sociales_pct is
  'Porcentaje sobre el costo hora que paga el empleador además del sueldo. Omitirlo subestima el costo laboral en un tercio y vuelve inútil el prime cost.';

-- ---------------------------------------------------------------------------
-- Fichajes
-- ---------------------------------------------------------------------------

create table fichajes (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null references organizaciones(id) on delete cascade,
  sucursal_id          uuid references sucursales(id) on delete set null,
  empleado_id          uuid not null references empleados(id) on delete restrict,
  entrada              timestamptz not null,
  salida               timestamptz,
  -- Día al que pertenece el turno, en la zona del negocio. Se guarda resuelto
  -- porque `entrada::date` depende de la zona de la sesión: no es determinista
  -- y por eso tampoco se puede indexar.
  fecha_operativa      date not null,
  -- Congelados al CERRAR el fichaje, igual que el costo de una venta: un
  -- aumento de sueldo no debe reescribir el costo laboral de meses cerrados.
  costo_hora_aplicado  numeric(12,4),
  cargas_pct_aplicado  numeric(5,2),
  notas                text,
  registrado_en        timestamptz not null default now(),

  constraint salida_posterior check (salida is null or salida > entrada),
  -- Un turno de más de 16 horas es casi siempre un fichaje que alguien olvidó
  -- cerrar, no una jornada real.
  constraint turno_razonable check (
    salida is null or salida <= entrada + interval '16 hours'
  )
);
create index on fichajes (organizacion_id);
create index on fichajes (empleado_id, entrada desc);

-- La fecha operativa es la del INGRESO, en la zona del negocio. Un turno que
-- empieza a las 22:00 y termina a las 03:00 pertenece al día que arrancó: es el
-- criterio con el que un encargado lee sus números.
create or replace function app_completar_fecha_operativa()
returns trigger
language plpgsql
as $$
declare v_zona text;
begin
  select zona_horaria into v_zona from organizaciones where id = new.organizacion_id;
  new.fecha_operativa := (new.entrada at time zone coalesce(v_zona, 'UTC'))::date;
  return new;
end
$$;

create trigger fichajes_fecha_operativa
  before insert or update of entrada on fichajes
  for each row execute function app_completar_fecha_operativa();

create index on fichajes (organizacion_id, fecha_operativa);

-- Un empleado no puede tener dos fichajes abiertos a la vez.
create unique index fichaje_abierto_unico
  on fichajes (empleado_id)
  where salida is null;

-- Horas trabajadas de un fichaje cerrado.
create or replace function app_horas_fichaje(p_entrada timestamptz, p_salida timestamptz)
returns numeric
language sql
immutable
as $$
  select case
           when p_salida is null then null
           else round(extract(epoch from (p_salida - p_entrada)) / 3600.0, 4)
         end
$$;

-- ---------------------------------------------------------------------------
-- Cerrar un fichaje
-- ---------------------------------------------------------------------------

create or replace function cerrar_fichaje(
  p_fichaje_id uuid,
  p_salida     timestamptz default now()
) returns numeric
language plpgsql
as $$
declare
  f fichajes%rowtype;
  e empleados%rowtype;
begin
  select * into f from fichajes where id = p_fichaje_id;
  if not found then
    raise exception 'fichaje % inexistente o sin acceso', p_fichaje_id;
  end if;
  if f.salida is not null then
    raise exception 'el fichaje ya estaba cerrado a las %', f.salida;
  end if;
  if p_salida <= f.entrada then
    raise exception 'la salida (%) no puede ser anterior a la entrada (%)',
      p_salida, f.entrada;
  end if;

  select * into e from empleados where id = f.empleado_id;

  update fichajes
     set salida = p_salida,
         costo_hora_aplicado = e.costo_hora,
         cargas_pct_aplicado = e.cargas_sociales_pct
   where id = p_fichaje_id;

  return app_horas_fichaje(f.entrada, p_salida);
end
$$;

-- ---------------------------------------------------------------------------
-- Vista analítica
-- ---------------------------------------------------------------------------

create or replace view vista_fichajes
with (security_invoker = true)
as
select f.id,
       f.organizacion_id,
       f.empleado_id,
       e.nombre  as empleado,
       e.puesto,
       f.entrada,
       f.salida,
       f.fecha_operativa                            as fecha,
       app_horas_fichaje(f.entrada, f.salida)       as horas,
       f.costo_hora_aplicado,
       f.cargas_pct_aplicado,
       -- El costo de una hora incluye las cargas patronales.
       round(
         app_horas_fichaje(f.entrada, f.salida)
           * f.costo_hora_aplicado
           * (1 + coalesce(f.cargas_pct_aplicado, 0) / 100),
         2
       )                                            as costo,
       (f.salida is null)                           as abierto
from fichajes f
join empleados e on e.id = f.empleado_id;

grant select on vista_fichajes to public;

-- ---------------------------------------------------------------------------
-- Costo laboral del período
-- ---------------------------------------------------------------------------

create or replace function costo_laboral(p_desde date, p_hasta date)
returns table (
  costo_total       numeric,
  horas             numeric,
  empleados         bigint,
  fichajes_cerrados bigint,
  fichajes_abiertos bigint
)
language sql
stable
as $$
  select round(coalesce(sum(costo) filter (where not abierto), 0), 2),
         round(coalesce(sum(horas) filter (where not abierto), 0), 2),
         count(distinct empleado_id),
         count(*) filter (where not abierto),
         -- Los fichajes sin cerrar NO se cuestan (no se sabe cuánto duraron)
         -- pero se informan: un costo laboral calculado sobre la mitad de los
         -- turnos es un número que engaña.
         count(*) filter (where abierto)
  from vista_fichajes
  where fecha between p_desde and p_hasta
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t record; pol text;
begin
  for t in
    select * from (values
      ('empleados', $r$array['propietario','gerente']$r$),
      ('fichajes',  $r$array['propietario','gerente']$r$)
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
