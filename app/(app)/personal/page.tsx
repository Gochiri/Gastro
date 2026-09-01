import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { listarEmpleados, listarFichajes } from '@/consultas/personal'
import { formatearCantidad, formatearImporte } from '@/lib/formato'
import { altaEmpleado, ficharEntrada, ficharSalida } from './acciones'

const hora = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export default async function Personal() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const [organizacion, empleados, fichajes] = await Promise.all([
    organizacionActiva(usuario),
    listarEmpleados(usuario),
    listarFichajes(usuario, 30),
  ])
  if (!organizacion) redirect('/login')

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const enTurno = empleados.filter((e) => e.fichajeAbiertoId)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Personal</h1>
      <p className="mt-1 text-sm text-stone-600">
        El costo de una hora incluye las cargas sociales. Sin ellas, el costo
        laboral sale casi un tercio más bajo de lo que realmente es.{' '}
        <Link href="/personal/turnos" className="font-medium text-stone-900 underline">
          Planificar turnos y ver el desvío
        </Link>
      </p>

      {/* --- Fichaje: la pantalla de uso diario ------------------------- */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Fichaje
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="fichaje">
        {empleados
          .filter((e) => e.activo)
          .map((e) => (
            <li
              key={e.id}
              className={`flex items-center justify-between rounded-lg border p-3 ${
                e.fichajeAbiertoId ? 'border-stone-400 bg-stone-100' : 'border-stone-200 bg-white'
              }`}
            >
              <div>
                <div className="font-medium">{e.nombre}</div>
                <div className="text-xs text-stone-500">
                  {e.fichajeAbiertoId && e.entradaAbierta
                    ? `En turno desde las ${hora(e.entradaAbierta)}`
                    : (e.puesto ?? 'Sin puesto')}
                </div>
              </div>
              {e.fichajeAbiertoId ? (
                <form action={ficharSalida}>
                  <input type="hidden" name="fichajeId" value={e.fichajeAbiertoId} />
                  <button
                    type="submit"
                    data-testid={`salida-${e.nombre}`}
                    className="rounded-lg border border-stone-400 bg-white px-3 py-1.5 text-sm font-medium"
                  >
                    Fichar salida
                  </button>
                </form>
              ) : (
                <form action={ficharEntrada}>
                  <input type="hidden" name="empleadoId" value={e.id} />
                  <button
                    type="submit"
                    data-testid={`entrada-${e.nombre}`}
                    className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Fichar entrada
                  </button>
                </form>
              )}
            </li>
          ))}
      </ul>
      {enTurno.length > 0 && (
        <p className="mt-2 text-xs text-stone-500" data-testid="en-turno">
          {enTurno.length} en turno ahora mismo.
        </p>
      )}

      {/* --- Alta ------------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Agregar o actualizar empleado
      </h2>
      <form action={altaEmpleado} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Nombre</span>
          <input
            name="nombre"
            required
            data-testid="emp-nombre"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Puesto</span>
          <input
            name="puesto"
            data-testid="emp-puesto"
            className="mt-1 w-36 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Costo por hora</span>
          <input
            type="number"
            name="costoHora"
            step="any"
            min="0"
            required
            data-testid="emp-costo"
            className="mt-1 w-32 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Cargas %</span>
          <input
            type="number"
            name="cargas"
            step="any"
            min="0"
            defaultValue="35"
            data-testid="emp-cargas"
            className="mt-1 w-24 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Guardar
        </button>
      </form>

      <table className="mt-6 w-full border-collapse text-sm" data-testid="tabla-empleados">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Empleado</th>
            <th className="pb-2 font-medium">Puesto</th>
            <th className="pb-2 text-right font-medium">Costo hora</th>
            <th className="pb-2 text-right font-medium">Con cargas</th>
          </tr>
        </thead>
        <tbody>
          {empleados.map((e) => (
            <tr key={e.id} className="border-b border-stone-200">
              <td className="py-2 font-medium">{e.nombre}</td>
              <td className="py-2 text-stone-600">{e.puesto ?? '—'}</td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {importe(e.costoHora)}
              </td>
              <td className="py-2 text-right tabular-nums font-medium">
                {importe(e.costoHoraTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* --- Historial --------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Últimos turnos
      </h2>
      <table className="mt-3 w-full border-collapse text-sm" data-testid="tabla-fichajes">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Día</th>
            <th className="pb-2 font-medium">Empleado</th>
            <th className="pb-2 font-medium">Turno</th>
            <th className="pb-2 text-right font-medium">Horas</th>
            <th className="pb-2 text-right font-medium">Costo</th>
          </tr>
        </thead>
        <tbody>
          {fichajes.map((f) => (
            <tr key={f.id} className="border-b border-stone-200">
              <td className="py-2 text-stone-600">{f.fecha}</td>
              <td className="py-2">{f.empleado}</td>
              <td className="py-2 text-stone-600">
                {hora(f.entrada)} – {f.salida ? hora(f.salida) : <span className="text-amber-700">sin cerrar</span>}
              </td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {f.horas === null ? '—' : formatearCantidad(f.horas, organizacion.pais)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {f.costo === null ? '—' : importe(f.costo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
