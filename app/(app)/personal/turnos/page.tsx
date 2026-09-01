import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { listarEmpleados, planVsReal, resumenPlan } from '@/consultas/personal'
import { periodoFinanciero } from '@/consultas/finanzas'
import { formatearCantidad, formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { Tarjeta } from '@/app/componentes/tarjetas'
import { planificarTurno } from './acciones'

const ETIQUETA: Readonly<Record<string, string>> = {
  en_plan: 'En plan',
  excedido: 'Excedido',
  por_debajo: 'Por debajo',
  ausente: 'Ausente',
  sin_planificar: 'Sin planificar',
}

const COLOR: Readonly<Record<string, string>> = {
  en_plan: 'bg-stone-100 text-stone-600',
  excedido: 'bg-red-100 text-red-900',
  por_debajo: 'bg-amber-100 text-amber-900',
  ausente: 'bg-amber-100 text-amber-900',
  sin_planificar: 'bg-sky-100 text-sky-900',
}

export default async function Turnos({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoFinanciero(usuario)
  const [empleados, filas, resumen] = await Promise.all([
    listarEmpleados(usuario),
    periodo ? planVsReal(usuario, periodo) : Promise.resolve([]),
    periodo ? resumenPlan(usuario, periodo) : Promise.resolve(null),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const horas = (v: number): string => `${formatearCantidad(v, organizacion.pais)} h`
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Turnos</h1>
      <p className="mt-1 text-sm text-stone-600">
        El fichaje dice lo que pasó. El turno planificado dice lo que se
        esperaba, y la diferencia es lo único que se puede corregir.{' '}
        <Link href="/personal" className="font-medium text-stone-900 underline">
          Ir a fichajes
        </Link>
      </p>

      {error === 'permisos' && (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          data-testid="aviso-permisos"
        >
          Tu rol no tiene permiso para planificar turnos. La política de la base
          rechazó el alta, así que no quedó nada a medio guardar.
        </p>
      )}

      <form action={planificarTurno} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Empleado</span>
          <select
            name="empleadoId"
            required
            data-testid="turno-empleado"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {empleados
              .filter((e) => e.activo)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Fecha</span>
          <input
            type="date"
            name="fecha"
            required
            data-testid="turno-fecha"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Desde</span>
          <input
            type="time"
            name="horaInicio"
            required
            data-testid="turno-inicio"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Hasta</span>
          <input
            type="time"
            name="horaFin"
            required
            data-testid="turno-fin"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Planificar
        </button>
      </form>
      <p className="mt-2 text-xs text-stone-500">
        Un turno que cruza la medianoche se carga como dos: permitir uno solo
        obligaría al sistema a adivinar a qué día pertenece cada mitad.
      </p>

      {resumen && filas.length > 0 && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Tarjeta
              etiqueta="Horas planificadas"
              valor={horas(resumen.horasPlan)}
              nota={`Costo previsto ${importe(resumen.costoPlan)}`}
              testid="horas-plan"
            />
            <Tarjeta
              etiqueta="Horas fichadas"
              valor={horas(resumen.horasReales)}
              nota={`Costo real ${importe(resumen.costoReal)}`}
              testid="horas-reales"
            />
            <Tarjeta
              etiqueta="Desvío"
              valor={importe(resumen.desvioDinero)}
              nota={`${pct(resumen.desvioPct)} sobre lo previsto`}
              testid="desvio-dinero"
            />
            <Tarjeta
              etiqueta="Días fuera de plan"
              valor={String(
                resumen.diasExcedidos +
                  resumen.diasPorDebajo +
                  resumen.ausencias +
                  resumen.sinPlanificar,
              )}
              nota={`${resumen.diasEnPlan} en plan · ${resumen.ausencias} ausencias`}
              testid="dias-fuera"
            />
          </div>

          {/* El costo planificado se calcula a la tarifa VIGENTE y el real sale
              congelado del fichaje. Es una asimetría deliberada —un turno que
              todavía no ocurrió no puede congelar nada— y conviene decirla. */}
          <p className="mt-3 text-xs text-stone-500">
            El costo previsto usa la tarifa de hoy de cada empleado; el real, la
            que quedó congelada al cerrar cada fichaje. Comparar un presupuesto
            contra un hecho.
          </p>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm" data-testid="tabla-plan">
              <thead>
                <tr className="border-b border-stone-300 text-left text-stone-500">
                  <th className="pb-2 font-medium">Empleado</th>
                  <th className="pb-2 font-medium">Día</th>
                  <th className="pb-2 text-right font-medium">Plan</th>
                  <th className="pb-2 text-right font-medium">Fichado</th>
                  <th className="pb-2 text-right font-medium">Desvío</th>
                  <th className="pb-2 text-right font-medium">En dinero</th>
                  <th className="pb-2 font-medium">Situación</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr
                    key={`${f.empleado}-${f.fecha}`}
                    className="border-b border-stone-200"
                    data-testid={`plan-${f.empleado}-${f.fecha}`}
                  >
                    <td className="py-2">{f.empleado}</td>
                    <td className="py-2 text-stone-600">{f.fecha}</td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {horas(f.horasPlan)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{horas(f.horasReales)}</td>
                    <td className="py-2 text-right tabular-nums">{horas(f.desvioHoras)}</td>
                    <td className="py-2 text-right tabular-nums">{importe(f.desvioDinero)}</td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${COLOR[f.situacion]}`}>
                        {ETIQUETA[f.situacion]}
                      </span>
                      {/* Un fichaje sin cerrar se ve como cero horas: sin este
                          aviso, un turno abierto se lee como una ausencia. */}
                      {f.fichajesAbiertos > 0 && (
                        <span
                          className="ml-2 text-xs text-stone-500"
                          data-testid={`abierto-${f.empleado}-${f.fecha}`}
                        >
                          fichaje sin cerrar
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {filas.length === 0 && (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Todavía no hay turnos planificados ni fichajes en el período.
        </p>
      )}
    </>
  )
}
