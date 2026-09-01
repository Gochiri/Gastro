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

const numero = (v: FormDataEntryValue | null): number | null => {
  if (v === null) return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export async function altaEmpleado(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const nombre = String(formData.get('nombre') ?? '').trim()
  const puesto = String(formData.get('puesto') ?? '').trim() || null
  const costoHora = numero(formData.get('costoHora'))
  const cargas = numero(formData.get('cargas')) ?? 0
  if (!nombre || costoHora === null || costoHora < 0) return

  await consultar(
    usuarioId,
    `insert into empleados (organizacion_id, sucursal_id, nombre, puesto, costo_hora, cargas_sociales_pct)
     select m.organizacion_id,
            (select s.id from sucursales s
              where s.organizacion_id = m.organizacion_id order by s.nombre limit 1),
            $1, $2, $3, $4
     from miembros m where m.usuario_id = auth.uid() limit 1
     on conflict (organizacion_id, nombre) do update
       set puesto = excluded.puesto,
           costo_hora = excluded.costo_hora,
           cargas_sociales_pct = excluded.cargas_sociales_pct`,
    [nombre, puesto, costoHora, cargas],
  )
  revalidatePath('/personal')
}

/** Ficha la entrada. El índice único impide dos fichajes abiertos por empleado. */
export async function ficharEntrada(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const empleadoId = String(formData.get('empleadoId') ?? '')
  if (!empleadoId) return

  await consultar(
    usuarioId,
    `insert into fichajes (organizacion_id, sucursal_id, empleado_id, entrada, fecha_operativa)
     select e.organizacion_id, e.sucursal_id, e.id, now(), current_date
     from empleados e where e.id = $1`,
    [empleadoId],
  )
  revalidatePath('/personal')
}

export async function ficharSalida(formData: FormData): Promise<void> {
  const usuarioId = await usuario()
  const fichajeId = String(formData.get('fichajeId') ?? '')
  if (!fichajeId) return
  await consultar(usuarioId, 'select cerrar_fichaje($1)', [fichajeId])
  revalidatePath('/personal')
}
