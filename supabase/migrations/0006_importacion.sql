-- 0006_importacion.sql
-- Paso de ventas_staging a ventas: es el momento en que se congela el costo.

-- ---------------------------------------------------------------------------
-- Confirmar una importación
-- ---------------------------------------------------------------------------

-- Mueve a `ventas` las filas en estado 'ok' y les fija:
--   costo_unitario_teorico = costo por unidad de la receta A LA FECHA DE VENTA
--   comision_pct_aplicada  = comisión del canal en este momento
--
-- El costo se resuelve con costo_porcion(receta, fecha_venta), así que una venta
-- de enero se cuesta con los precios de enero aunque se importe en septiembre.
-- Después queda congelado.
--
-- Un producto sin receta entra con costo NULL, no con cero: fingir costo cero
-- inflaría el margen y ocultaría el problema. La cobertura de costeo lo expone.
create or replace function confirmar_importacion(p_importacion_id uuid)
returns table (insertadas integer, sin_costo integer)
language plpgsql
as $$
declare
  v_imp        importaciones%rowtype;
  v_insertadas integer;
  v_sin_costo  integer;
begin
  select * into v_imp from importaciones where id = p_importacion_id;
  if not found then
    raise exception 'importación % inexistente o sin acceso', p_importacion_id;
  end if;
  if v_imp.estado <> 'borrador' then
    raise exception 'la importación ya está %', v_imp.estado
      using hint = 'Solo se puede confirmar una importación en borrador.';
  end if;

  if exists (
    select 1 from ventas_staging
    where importacion_id = p_importacion_id and estado = 'sin_producto'
  ) then
    raise exception 'quedan filas sin producto asignado'
      using hint = 'Resolvé los productos desconocidos antes de confirmar: importarlos sin resolver perdería esas ventas.';
  end if;

  with filas as (
    select s.*,
           p.receta_id,
           c.comision_pct
    from ventas_staging s
    join productos p on p.id = s.producto_id
    join canales   c on c.id = s.canal_id
    where s.importacion_id = p_importacion_id
      and s.estado = 'ok'
  ),
  insertadas as (
    insert into ventas (
      organizacion_id, sucursal_id, importacion_id, fecha, canal_id, producto_id,
      cantidad, importe_bruto, descuento,
      costo_unitario_teorico, comision_pct_aplicada, costeada_en
    )
    select f.organizacion_id, v_imp.sucursal_id, p_importacion_id, f.fecha,
           f.canal_id, f.producto_id, f.cantidad, f.importe_bruto, f.descuento,
           case when f.receta_id is not null
                then costo_porcion(f.receta_id, f.fecha)
           end,
           f.comision_pct,
           now()
    from filas f
    returning costo_unitario_teorico
  )
  select count(*)::int, count(*) filter (where costo_unitario_teorico is null)::int
    into v_insertadas, v_sin_costo
  from insertadas;

  update importaciones
     set estado = 'confirmada', confirmada_en = now()
   where id = p_importacion_id;

  return query select v_insertadas, v_sin_costo;
end
$$;

-- ---------------------------------------------------------------------------
-- Recalcular
-- ---------------------------------------------------------------------------

-- Para cuando se corrige una receta mal cargada. La congelación protege el
-- histórico de cambios accidentales; esto lo actualiza a propósito.
create or replace function recalcular_costos_ventas(
  p_desde date,
  p_hasta date
) returns integer
language plpgsql
as $$
declare v_afectadas integer;
begin
  if p_hasta < p_desde then
    raise exception 'rango invertido: % a %', p_desde, p_hasta;
  end if;

  with recalculadas as (
    update ventas v
       set costo_unitario_teorico =
             case when p.receta_id is not null
                  then costo_porcion(p.receta_id, v.fecha)
             end,
           costeada_en = now()
      from productos p
     where p.id = v.producto_id
       and v.fecha between p_desde and p_hasta
    returning v.id
  )
  select count(*)::int into v_afectadas from recalculadas;

  return v_afectadas;
end
$$;

-- ---------------------------------------------------------------------------
-- Descartar
-- ---------------------------------------------------------------------------

create or replace function descartar_importacion(p_importacion_id uuid)
returns void
language plpgsql
as $$
begin
  -- El índice único de hash excluye las descartadas, así que tras descartar se
  -- puede volver a subir el mismo archivo corregido.
  update importaciones
     set estado = 'descartada'
   where id = p_importacion_id and estado = 'borrador';

  if not found then
    raise exception 'no hay importación en borrador con id %', p_importacion_id;
  end if;

  delete from ventas_staging where importacion_id = p_importacion_id;
end
$$;
