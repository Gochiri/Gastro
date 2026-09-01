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

const numero = (valor: FormDataEntryValue | null): number | null => {
  if (valor === null) return null
  // Los formularios de la app usan punto decimal (input type=number); el
  // parseo de convenciones locales vive en el importador de CSV, no acá.
  const n = Number(String(valor).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export async function crearConteo(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const tipo = String(formData.get('tipo') ?? 'ciclico')
  const filas = await withTenant(usuarioId, async (cliente) => {
    const { rows } = await cliente.query<{ id: string }>(
      `insert into conteos (organizacion_id, sucursal_id, tipo, creado_por)
       select m.organizacion_id,
              (select s.id from sucursales s
                where s.organizacion_id = m.organizacion_id order by s.nombre limit 1),
              $1::tipo_conteo, auth.uid()
       from miembros m where m.usuario_id = auth.uid() limit 1
       returning id`,
      [tipo],
    )
    return rows
  })
  revalidatePath('/inventario')
  redirect(`/inventario/${filas[0].id}`)
}

export async function agregarItem(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const conteoId = String(formData.get('conteoId') ?? '')
  const insumoId = String(formData.get('insumoId') ?? '')
  const cantidad = numero(formData.get('cantidad'))
  if (!conteoId || !insumoId || cantidad === null || cantidad < 0) return

  await consultar(
    usuarioId,
    `insert into conteo_items (organizacion_id, conteo_id, insumo_id, cantidad, unidad_id)
     select i.organizacion_id, $1, i.id, $3, i.unidad_base_id
     from insumos i where i.id = $2
     on conflict (conteo_id, insumo_id) do update set cantidad = excluded.cantidad`,
    [conteoId, insumoId, cantidad],
  )
  revalidatePath(`/inventario/${conteoId}`)
}

export async function quitarItem(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const itemId = String(formData.get('itemId') ?? '')
  const conteoId = String(formData.get('conteoId') ?? '')
  await consultar(usuarioId, 'delete from conteo_items where id = $1', [itemId])
  revalidatePath(`/inventario/${conteoId}`)
}

export async function cerrar(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const conteoId = String(formData.get('conteoId') ?? '')
  await consultar(usuarioId, 'select cerrar_conteo($1)', [conteoId])
  revalidatePath('/inventario')
  redirect('/inventario')
}

export async function registrarCompra(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const insumoId = String(formData.get('insumoId') ?? '')
  const cantidad = numero(formData.get('cantidad'))
  const costo = numero(formData.get('costoTotal'))
  const fecha = String(formData.get('fecha') ?? '')
  if (!insumoId || cantidad === null || cantidad <= 0 || costo === null || !fecha) return

  await consultar(
    usuarioId,
    `insert into compras (organizacion_id, sucursal_id, insumo_id, fecha, cantidad, unidad_id, costo_total)
     select i.organizacion_id,
            (select s.id from sucursales s
              where s.organizacion_id = i.organizacion_id order by s.nombre limit 1),
            i.id, $2::date, $3, i.unidad_base_id, $4
     from insumos i where i.id = $1`,
    [insumoId, fecha, cantidad, costo],
  )
  revalidatePath('/compras')
}

export async function registrarMerma(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const insumoId = String(formData.get('insumoId') ?? '')
  const cantidad = numero(formData.get('cantidad'))
  const motivo = String(formData.get('motivo') ?? 'otro')
  const fecha = String(formData.get('fecha') ?? '')
  const notas = String(formData.get('notas') ?? '') || null
  if (!insumoId || cantidad === null || cantidad <= 0 || !fecha) return

  await consultar(
    usuarioId,
    `insert into mermas (organizacion_id, sucursal_id, insumo_id, fecha, cantidad, unidad_id, motivo, notas, registrada_por)
     select i.organizacion_id,
            (select s.id from sucursales s
              where s.organizacion_id = i.organizacion_id order by s.nombre limit 1),
            i.id, $2::date, $3, i.unidad_base_id, $4::motivo_merma, $5, auth.uid()
     from insumos i where i.id = $1`,
    [insumoId, fecha, cantidad, motivo, notas],
  )
  revalidatePath('/mermas')
}
