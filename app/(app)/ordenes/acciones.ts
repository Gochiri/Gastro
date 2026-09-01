'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { consultar, withTenant } from '@/lib/db'

async function usuario(): Promise<string> {
  const id = await usuarioActual()
  if (!id) redirect('/login')
  return id
}

const numero = (v: FormDataEntryValue | null): number | null => {
  if (v === null) return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export async function crearOrden(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const proveedorId = String(formData.get('proveedorId') ?? '')
  if (!proveedorId) return

  const filas = await withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `insert into ordenes_compra (organizacion_id, sucursal_id, proveedor_id, creada_por)
       select m.organizacion_id,
              (select s.id from sucursales s
                where s.organizacion_id = m.organizacion_id order by s.nombre limit 1),
              $1, auth.uid()
       from miembros m where m.usuario_id = auth.uid() limit 1
       returning id`,
      [proveedorId],
    )
    return rows
  })
  revalidatePath('/ordenes')
  redirect(`/ordenes/${filas[0].id}`)
}

export async function agregarItem(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const ordenId = String(formData.get('ordenId') ?? '')
  const insumoId = String(formData.get('insumoId') ?? '')
  const cantidad = numero(formData.get('cantidad'))
  const precio = numero(formData.get('precio'))
  if (!ordenId || !insumoId || cantidad === null || cantidad <= 0) return

  await consultar(
    usuarioId,
    `insert into orden_items (organizacion_id, orden_id, insumo_id, cantidad, unidad_id, precio_unitario_estimado)
     select i.organizacion_id, $1, i.id, $3, i.unidad_base_id, $4
     from insumos i where i.id = $2
     on conflict (orden_id, insumo_id) do update
       set cantidad = excluded.cantidad,
           precio_unitario_estimado = excluded.precio_unitario_estimado`,
    [ordenId, insumoId, cantidad, precio],
  )
  revalidatePath(`/ordenes/${ordenId}`)
}

export async function enviarOrden(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const ordenId = String(formData.get('ordenId') ?? '')
  await consultar(
    usuarioId,
    `update ordenes_compra set estado = 'enviada'
      where id = $1 and estado = 'borrador'
        and exists (select 1 from orden_items oi where oi.orden_id = $1)`,
    [ordenId],
  )
  revalidatePath(`/ordenes/${ordenId}`)
}

/**
 * Registra y confirma una recepción en un solo paso.
 *
 * `actualizaPrecios` llega desde una casilla que viene DESMARCADA: actualizar
 * la lista de precios recostea el menú entero, y eso tiene que ser una decisión
 * consciente, no el efecto secundario de cargar un remito.
 */
export async function recibir(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const ordenId = String(formData.get('ordenId') ?? '')
  const fecha = String(formData.get('fecha') ?? '')
  const actualizaPrecios = formData.get('actualizaPrecios') === 'on'
  if (!ordenId || !fecha) return

  const lineas: { itemId: string; cantidad: number; costo: number }[] = []
  for (const [clave, valor] of formData.entries()) {
    const m = /^cantidad-(.+)$/.exec(clave)
    if (!m) continue
    const cantidad = numero(valor)
    const costo = numero(formData.get(`costo-${m[1]}`))
    if (cantidad !== null && cantidad > 0 && costo !== null) {
      lineas.push({ itemId: m[1], cantidad, costo })
    }
  }
  if (lineas.length === 0) return

  await withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `insert into recepciones (organizacion_id, orden_id, fecha, actualiza_precios)
       select organizacion_id, id, $2::date, $3 from ordenes_compra where id = $1
       returning id`,
      [ordenId, fecha, actualizaPrecios],
    )
    const recepcionId = rows[0].id

    for (const l of lineas) {
      await cliente.query(
        `insert into recepcion_items (organizacion_id, recepcion_id, orden_item_id, cantidad, unidad_id, costo_total)
         select oi.organizacion_id, $1, oi.id, $3, i.unidad_base_id, $4
         from orden_items oi join insumos i on i.id = oi.insumo_id
         where oi.id = $2`,
        [recepcionId, l.itemId, l.cantidad, l.costo],
      )
    }

    await cliente.query('select confirmar_recepcion($1)', [recepcionId])
  })

  revalidatePath(`/ordenes/${ordenId}`)
  revalidatePath('/compras')
}
