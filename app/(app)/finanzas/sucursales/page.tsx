import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { comparativoSucursales, ebitda, periodoFinanciero } from '@/consultas/finanzas'
import { formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { NavFinanzas } from '../nav'

export default async function Sucursales() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoFinanciero(usuario)
  if (!periodo) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
        <NavFinanzas activa="/finanzas/sucursales" />
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Sin datos cargados no hay nada que comparar.
        </p>
      </>
    )
  }

  const [filas, total] = await Promise.all([
    comparativoSucursales(usuario, periodo),
    ebitda(usuario, periodo),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)

  const hayProrrateo = filas.some((f) => f.gastosProrrateados !== 0)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
      <p className="mt-1 text-sm text-stone-600">
        Del {periodo.desde} al {periodo.hasta}
      </p>
      <NavFinanzas activa="/finanzas/sucursales" />

      {filas.length <= 1 ? (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Hay una sola sucursal con actividad en el período: el resultado del
          local es el resultado del negocio, y está en la solapa Resultado.
        </p>
      ) : (
        <p className="mt-6 text-sm text-stone-600">
          El promedio del negocio esconde el reparto: una sucursal sana puede
          estar financiando a otra que pierde plata.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm" data-testid="tabla-sucursales">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="pb-2 font-medium">Sucursal</th>
              <th className="pb-2 text-right font-medium">Ventas</th>
              <th className="pb-2 text-right font-medium">Food cost</th>
              <th className="pb-2 text-right font-medium">Trabajo</th>
              <th className="pb-2 text-right font-medium">Prime cost</th>
              <th className="pb-2 text-right font-medium">Gastos propios</th>
              <th className="pb-2 text-right font-medium">Prorrateados</th>
              <th className="pb-2 text-right font-medium">EBITDA</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr
                key={f.sucursalId ?? 'sin-asignar'}
                className="border-b border-stone-200"
                data-testid={`fila-${f.sucursal}`}
              >
                <td className="py-2">
                  {f.sucursal}
                  {f.ventas === 0 && (
                    <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                      sin ventas cargadas
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{importe(f.ventas)}</td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {pct(f.foodCostPct)}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {pct(f.laborCostPct)}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {pct(f.primeCostPct)}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {importe(f.gastosAsignados)}
                </td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {importe(f.gastosProrrateados)}
                </td>
                <td
                  className={
                    f.ebitda < 0
                      ? 'py-2 text-right font-medium tabular-nums text-red-700'
                      : 'py-2 text-right font-medium tabular-nums'
                  }
                >
                  {importe(f.ebitda)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-300 font-medium">
              <td className="py-2">Organización</td>
              <td className="py-2 text-right tabular-nums">{importe(total.ventasNetas)}</td>
              <td colSpan={4} />
              <td className="py-2 text-right tabular-nums text-stone-600">
                {importe(total.gastosFijos)}
              </td>
              <td className="py-2 text-right tabular-nums" data-testid="ebitda-total">
                {importe(total.ebitda)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {hayProrrateo && (
        <p className="mt-4 text-xs text-stone-500" data-testid="nota-prorrateo">
          Los gastos de organización (administración, seguros, software) se
          reparten por participación en las ventas del período, y por eso van en
          columna aparte: parte de la pérdida de una sucursal puede no ser suya.
          Una sucursal sin ventas no recibe prorrateo, pero sigue cargando con
          sus gastos propios.
        </p>
      )}

      <p className="mt-2 text-xs text-stone-500">
        El food cost y el prime cost de cada fila se miden contra las ventas
        costeadas de esa sucursal, el mismo criterio que en el resto del
        sistema. Una fila con cobertura parcial tiene su porcentaje calculado
        sobre menos ventas de las que hizo.
      </p>
    </>
  )
}
