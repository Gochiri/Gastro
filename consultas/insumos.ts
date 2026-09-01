import { consultar } from '../lib/db.ts'

export interface InsumoListado {
  id: string
  nombre: string
  categoria: string | null
  unidadBase: string
  mermaPct: number
  precioUnitario: number | null
}

/**
 * Catálogo con el precio unitario vigente hoy.
 *
 * `app_precio_unitario` lanza excepción si un insumo no tiene precio, así que
 * se filtra por existencia previa en lugar de dejar que reviente la consulta:
 * un insumo recién creado sin precio es una situación normal, no un error.
 */
export async function listarInsumos(usuarioId: string): Promise<InsumoListado[]> {
  const filas = await consultar<Record<string, string | null>>(
    usuarioId,
    `select i.id,
            i.nombre,
            i.categoria,
            u.codigo as unidad_base,
            i.merma_limpieza_pct,
            case when exists (
                   select 1 from precios_insumo p
                   where p.insumo_id = i.id and p.vigente_desde <= current_date)
                 then app_precio_unitario(i.id)
            end as precio_unitario
     from insumos i
     join unidades u on u.id = i.unidad_base_id
     where i.activo
     order by i.categoria nulls last, i.nombre`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    nombre: String(f.nombre),
    categoria: f.categoria,
    unidadBase: String(f.unidad_base),
    mermaPct: Number(f.merma_limpieza_pct ?? 0),
    precioUnitario: f.precio_unitario === null ? null : Number(f.precio_unitario),
  }))
}
