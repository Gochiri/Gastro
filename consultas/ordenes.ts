import { consultar, withTenant } from '../lib/db.ts'

export interface OrdenListada {
  id: string
  fecha: string
  proveedor: string
  estado: 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'cancelada'
  items: number
  pendientes: number
}

export interface LineaAvance {
  ordenItemId: string
  insumo: string
  unidadBase: string
  pedido: number
  recibido: number
}

export interface OrdenDetalle extends OrdenListada {
  avance: LineaAvance[]
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function listarOrdenes(usuarioId: string): Promise<OrdenListada[]> {
  const filas = await consultar<Record<string, unknown>>(
    usuarioId,
    `select o.id, o.fecha::text, p.nombre as proveedor, o.estado,
            (select count(*) from orden_items oi where oi.orden_id = o.id) as items,
            (select count(*) from vista_orden_avance a
              where a.orden_id = o.id and a.recibido < a.pedido - 0.0001) as pendientes
     from ordenes_compra o
     join proveedores p on p.id = o.proveedor_id
     order by o.fecha desc, o.creada_en desc`,
  )
  return filas.map((f) => ({
    id: String(f.id),
    fecha: String(f.fecha),
    proveedor: String(f.proveedor),
    estado: f.estado as OrdenListada['estado'],
    items: num(f.items),
    pendientes: num(f.pendientes),
  }))
}

export async function obtenerOrden(
  usuarioId: string,
  ordenId: string,
): Promise<OrdenDetalle | null> {
  return withTenant(usuarioId, async (cliente) => {
    const cab = await cliente.query<Record<string, unknown>>(
      `select o.id, o.fecha::text, p.nombre as proveedor, o.estado
       from ordenes_compra o join proveedores p on p.id = o.proveedor_id
       where o.id = $1`,
      [ordenId],
    )
    const c = cab.rows[0]
    if (!c) return null

    const av = await cliente.query<Record<string, unknown>>(
      `select orden_item_id, insumo, unidad_base, pedido, recibido
       from vista_orden_avance where orden_id = $1 order by insumo`,
      [ordenId],
    )
    const avance = av.rows.map((f) => ({
      ordenItemId: String(f.orden_item_id),
      insumo: String(f.insumo),
      unidadBase: String(f.unidad_base),
      pedido: num(f.pedido),
      recibido: num(f.recibido),
    }))

    return {
      id: String(c.id),
      fecha: String(c.fecha),
      proveedor: String(c.proveedor),
      estado: c.estado as OrdenListada['estado'],
      items: avance.length,
      pendientes: avance.filter((a) => a.recibido < a.pedido - 0.0001).length,
      avance,
    }
  })
}

export interface ProveedorOpcion {
  id: string
  nombre: string
}

export async function listarProveedores(usuarioId: string): Promise<ProveedorOpcion[]> {
  const filas = await consultar<Record<string, string>>(
    usuarioId,
    'select id, nombre from proveedores where activo order by nombre',
  )
  return filas.map((f) => ({ id: f.id, nombre: f.nombre }))
}
