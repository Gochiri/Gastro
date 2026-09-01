import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { periodoFinanciero } from '@/consultas/finanzas'
import { anomalias, parametrosAnomalias } from '@/consultas/widgets'
import { formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { COLOR_SEVERIDAD } from '@/app/componentes/cuadrantes'
import { NavAsistente } from '../nav'
import { PanelAlertas } from './panel-alertas'

export default async function Alertas() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoFinanciero(usuario)
  if (!periodo) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
        <NavAsistente activa="/asistente/alertas" />
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Sin datos cargados no hay nada que vigilar.
        </p>
      </>
    )
  }

  const [senales, parametros] = await Promise.all([
    anomalias(usuario, periodo),
    parametrosAnomalias(usuario),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number): string => formatearPorcentaje(v, organizacion.pais)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
      <p className="mt-1 text-sm text-stone-600">
        Del {periodo.desde} al {periodo.hasta}
      </p>
      <NavAsistente activa="/asistente/alertas" />

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Señales detectadas
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Cada una salió de una regla con un umbral escrito, no del ojo de nadie.
        Ordenadas por lo que cuestan, no por cuánto se desvían: un 40% sobre un
        insumo barato importa menos que un 5% sobre la carne.
      </p>

      {senales.length === 0 ? (
        <p
          className="mt-4 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600"
          data-testid="sin-senales"
        >
          Ninguna regla se disparó en este período. No es un certificado de que
          todo esté bien: es que nada superó los umbrales de abajo.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3" data-testid="lista-senales">
            {senales.map((s) => (
              <li
                key={`${s.tipo}-${s.entidad}`}
                className={`rounded-lg border p-3 ${COLOR_SEVERIDAD[s.severidad]}`}
                data-testid={`senal-${s.tipo}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-stone-900">{s.entidad}</span>
                  {s.impactoDinero !== null && (
                    <span className="text-sm font-medium tabular-nums text-stone-900">
                      {importe(s.impactoDinero)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-stone-700">{s.detalle}</p>
                {s.umbral !== null && s.desvioPct !== null && (
                  <p className="mt-1 text-xs text-stone-500">
                    Umbral de la regla: {pct(s.umbral)} · medido: {pct(s.desvioPct)}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <PanelAlertas />
        </>
      )}

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Umbrales
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Un aviso que no dice contra qué vara se midió no se puede discutir.
      </p>
      <table className="mt-3 w-full border-collapse text-sm" data-testid="tabla-umbrales">
        <tbody>
          {parametros.map((p) => (
            <tr key={p.parametro} className="border-b border-stone-200">
              <td className="py-2 text-stone-600">{p.descripcion}</td>
              <td className="py-2 text-right tabular-nums">{p.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
