'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { consultar } from '@/lib/db'

export async function planificarTurno(formData: FormData): Promise<void> {
  const usuarioId = await usuarioActual()
  if (!usuarioId) redirect('/login')

  const empleadoId = String(formData.get('empleadoId') ?? '').trim()
  const fecha = String(formData.get('fecha') ?? '').trim()
  const inicio = String(formData.get('horaInicio') ?? '').trim()
  const fin = String(formData.get('horaFin') ?? '').trim()
  if (!empleadoId || !fecha || !inicio || !fin) return
  // La base también lo rechaza; acá se corta antes para no depender de un
  // error de constraint como mecanismo de validación.
  if (fin <= inicio) return

  try {
    // Un turno repetido es casi siempre una carga duplicada: se ignora sin
    // ruido. Un rechazo por permisos NO se ignora, se cuenta.
    await consultar(
      usuarioId,
      `insert into turnos_planificados
         (organizacion_id, sucursal_id, empleado_id, fecha, hora_inicio, hora_fin)
       select e.organizacion_id, e.sucursal_id, e.id, $2::date, $3::time, $4::time
       from empleados e where e.id = $1::uuid
       on conflict (empleado_id, fecha, hora_inicio) do nothing`,
      [empleadoId, fecha, inicio, fin],
    )
  } catch (error) {
    if ((error as { code?: string }).code === '42501') {
      redirect('/personal/turnos?error=permisos')
    }
    throw error
  }
  revalidatePath('/personal/turnos')
}
