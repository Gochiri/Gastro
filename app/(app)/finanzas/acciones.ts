'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { consultar } from '@/lib/db'

async function usuario(): Promise<string> {
  const id = await usuarioActual()
  if (!id) redirect('/login')
  return id
}

const numero = (valor: FormDataEntryValue | null): number | null => {
  if (valor === null) return null
  const n = Number(String(valor).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const texto = (valor: FormDataEntryValue | null): string | null => {
  const t = String(valor ?? '').trim()
  return t === '' ? null : t
}

/** Código de Postgres para "la política RLS rechazó la fila". */
const RLS_DENEGADO = '42501'

/**
 * Un rechazo por permisos no es un error del sistema: es el sistema
 * funcionando. Dejarlo propagar muestra una pantalla de error de framework y
 * el usuario no se entera de que lo que falta es un rol. Se traduce a un aviso
 * en la propia pantalla; cualquier otro error sí se propaga, porque esconderlo
 * sería una falla silenciosa.
 */
async function conAvisoDePermisos(ruta: string, accion: () => Promise<void>): Promise<void> {
  try {
    await accion()
  } catch (error) {
    if ((error as { code?: string }).code === RLS_DENEGADO) {
      redirect(`${ruta}?error=permisos`)
    }
    throw error
  }
}

export async function registrarGastoFijo(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const concepto = texto(formData.get('concepto'))
  const categoria = String(formData.get('categoria') ?? '')
  const importe = numero(formData.get('importeMensual'))
  const desde = texto(formData.get('vigenteDesde'))
  const sucursalId = texto(formData.get('sucursalId'))
  if (!concepto || !categoria || importe === null || importe < 0 || !desde) return

  await conAvisoDePermisos('/finanzas/gastos', async () => {
    await consultar(
      usuarioId,
      `insert into gastos_fijos
         (organizacion_id, sucursal_id, categoria, concepto, importe_mensual, vigente_desde)
       select m.organizacion_id, $1::uuid, $2::categoria_gasto, $3, $4, $5::date
       from miembros m where m.usuario_id = auth.uid() limit 1`,
      [sucursalId, categoria, concepto, importe, desde],
    )
  })
  revalidatePath('/finanzas/gastos')
  revalidatePath('/finanzas')
}

/**
 * Dar de baja un gasto es cerrar su vigencia, nunca borrar la fila.
 *
 * Si se borrara, el resultado de los meses ya cerrados se recalcularía sin ese
 * alquiler y un período que estaba en rojo pasaría a estar en verde por arte
 * de magia. El histórico tiene que quedar quieto.
 */
export async function cerrarGastoFijo(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const id = texto(formData.get('id'))
  const hasta = texto(formData.get('vigenteHasta'))
  if (!id || !hasta) return

  await consultar(
    usuarioId,
    `update gastos_fijos set vigente_hasta = $2::date
     where id = $1::uuid and (vigente_hasta is null or vigente_hasta <> $2::date)`,
    [id, hasta],
  )
  revalidatePath('/finanzas/gastos')
  revalidatePath('/finanzas')
}

export async function registrarRetencion(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const fecha = texto(formData.get('fecha'))
  const tipo = String(formData.get('tipo') ?? '')
  const contraparte = texto(formData.get('contraparte'))
  const importe = numero(formData.get('importe'))
  const base = numero(formData.get('baseImponible'))
  const alicuota = numero(formData.get('alicuotaPct'))
  const comprobante = texto(formData.get('comprobante'))
  if (!fecha || !tipo || !contraparte || importe === null || importe < 0) return

  await conAvisoDePermisos('/finanzas/fiscal', async () => {
    await consultar(
      usuarioId,
      `insert into retenciones
         (organizacion_id, fecha, tipo, sentido, contraparte, comprobante,
          base_imponible, alicuota_pct, importe)
       select m.organizacion_id, $1::date, $2::tipo_retencion, 'sufrida', $3, $4, $5, $6, $7
       from miembros m where m.usuario_id = auth.uid() limit 1`,
      [fecha, tipo, contraparte, comprobante, base, alicuota, importe],
    )
  })
  revalidatePath('/finanzas/fiscal')
}
