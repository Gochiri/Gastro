'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { consultar } from '@/lib/db'

export async function registrarMovimiento(formData: FormData): Promise<void> {
  const usuarioId = await usuarioActual()
  if (!usuarioId) redirect('/login')

  const tipo = String(formData.get('tipo') ?? 'ajuste')
  const insumoId = String(formData.get('insumoId') ?? '').trim()
  const fecha = String(formData.get('fecha') ?? '').trim()
  const motivo = String(formData.get('motivo') ?? '').trim()
  const cantidad = Number(String(formData.get('cantidad') ?? '').replace(',', '.'))
  const origen = String(formData.get('origen') ?? '').trim() || null
  const destino = String(formData.get('destino') ?? '').trim() || null

  if (!insumoId || !fecha || !motivo) return
  if (!Number.isFinite(cantidad) || cantidad === 0) return
  // La base también lo exige; cortarlo acá evita mostrar un error de constraint.
  if (tipo === 'transferencia' && (!origen || !destino || origen === destino || cantidad <= 0)) {
    return
  }

  try {
    await consultar(
      usuarioId,
      `insert into movimientos_manuales
         (organizacion_id, tipo, insumo_id, fecha, cantidad, unidad_id,
          sucursal_origen_id, sucursal_destino_id, motivo, registrado_por)
       select i.organizacion_id, $1::tipo_movimiento_manual, i.id, $3::date, $4,
              i.unidad_base_id, $5::uuid, $6::uuid, $7, auth.uid()
       from insumos i where i.id = $2::uuid`,
      [tipo, insumoId, fecha, cantidad, origen, destino, motivo],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '42501') {
      redirect('/inventario/stock?error=permisos')
    }
    throw error
  }
  revalidatePath('/inventario/stock')
}
