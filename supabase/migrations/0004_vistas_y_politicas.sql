-- 0004_vistas_y_politicas.sql
--
-- 1. Reescribe las políticas RLS a una forma NO CORRELACIONADA.
-- 2. Agrega la vista de recetas con costo para el listado de la UI.
--
-- Sobre la optimización: la guía de Supabase recomienda envolver las llamadas
-- de las políticas en (select ...) para que se evalúen una vez y no por fila.
-- Eso funciona cuando la expresión es constante, como (select auth.uid()).
-- NO sirve envolver app_es_miembro(organizacion_id): depende de la columna de
-- cada fila, así que sigue siendo correlacionada y se evalúa igual una vez por
-- fila. La forma que sí se hoistea es invertir la condición:
--
--     organizacion_id in (select app_organizaciones_del_usuario())
--
-- El subplan no depende de la fila, Postgres lo ejecuta una sola vez y hashea
-- el resultado.

-- Organizaciones del usuario que además tienen alguno de los roles dados.
create or replace function app_organizaciones_con_rol(roles rol_miembro[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organizacion_id
  from miembros
  where usuario_id = (select auth.uid())
    and rol = any(roles)
$$;

-- auth.uid() envuelto en (select ...): aquí sí aplica, es constante por consulta.
create or replace function app_organizaciones_del_usuario()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organizacion_id from miembros where usuario_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Políticas reescritas
-- ---------------------------------------------------------------------------

drop policy if exists org_lectura   on organizaciones;
drop policy if exists org_escritura on organizaciones;

create policy org_lectura on organizaciones
  for select using (id in (select app_organizaciones_del_usuario()));

create policy org_escritura on organizaciones
  for update
  using      (id in (select app_organizaciones_con_rol(array['propietario']::rol_miembro[])))
  with check (id in (select app_organizaciones_con_rol(array['propietario']::rol_miembro[])));

do $$
declare
  t record;
  pol text;
begin
  for t in
    select * from (values
      ('sucursales',     $r$array['propietario','gerente']$r$),
      ('miembros',       $r$array['propietario']$r$),
      ('proveedores',    $r$array['propietario','gerente','compras']$r$),
      ('insumos',        $r$array['propietario','gerente','compras']$r$),
      ('precios_insumo', $r$array['propietario','gerente','compras']$r$),
      ('recetas',        $r$array['propietario','gerente']$r$),
      ('receta_items',   $r$array['propietario','gerente']$r$)
    ) as v(tabla, roles)
  loop
    -- Borrar las políticas existentes por catálogo, no por nombre: así no
    -- depende de cómo se llamaran en migraciones anteriores.
    for pol in select polname from pg_policy p
               join pg_class c on c.oid = p.polrelid
               where c.relname = t.tabla
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

-- ---------------------------------------------------------------------------
-- Vista de recetas con costo
-- ---------------------------------------------------------------------------

-- security_invoker = true es OBLIGATORIO. Por defecto una vista se ejecuta con
-- los permisos de su DUEÑO, no del usuario que consulta: sin esta opción la
-- vista haría bypass de RLS y expondría las recetas de todos los clientes.
create or replace view vista_recetas_costo
with (security_invoker = true)
as
select r.id,
       r.organizacion_id,
       r.nombre,
       r.tipo,
       r.activa,
       r.rendimiento_cantidad,
       u.codigo as rendimiento_unidad,
       costo_receta(r.id)  as costo_total,
       costo_porcion(r.id) as costo_unitario
from recetas r
join unidades u on u.id = r.rendimiento_unidad_id;

comment on view vista_recetas_costo is
  'Costo de cada receta a la fecha actual. Llama a costo_receta() por fila: correcto para catálogos de cientos de recetas. Si el volumen crece, materializar y refrescar al cambiar precios o recetas.';

grant select on vista_recetas_costo to public;
