import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import {
  gastosDevengados,
  listarGastosFijos,
  periodoFinanciero,
  sucursalesParaSelector,
} from '@/consultas/finanzas'
import { formatearImporte } from '@/lib/formato'
import { NavFinanzas } from '../nav'
import { cerrarGastoFijo, registrarGastoFijo } from '../acciones'

const CATEGORIAS: { valor: string; etiqueta: string }[] = [
  { valor: 'alquiler', etiqueta: 'Alquiler' },
  { valor: 'servicios', etiqueta: 'Servicios' },
  { valor: 'sueldos_administrativos', etiqueta: 'Sueldos administrativos' },
  { valor: 'marketing', etiqueta: 'Marketing' },
  { valor: 'mantenimiento', etiqueta: 'Mantenimiento' },
  { valor: 'seguros', etiqueta: 'Seguros' },
  { valor: 'licencias', etiqueta: 'Licencias y software' },
  { valor: 'impuestos_municipales', etiqueta: 'Impuestos municipales' },
  { valor: 'otros', etiqueta: 'Otros' },
  { valor: 'financiero', etiqueta: 'Financiero (fuera del EBITDA)' },
  { valor: 'amortizacion', etiqueta: 'Amortización (fuera del EBITDA)' },
  { valor: 'impuesto_ganancias', etiqueta: 'Impuesto a las ganancias (fuera del EBITDA)' },
]

const ETIQUETA: Readonly<Record<string, string>> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.valor, c.etiqueta.replace(' (fuera del EBITDA)', '')]),
)

export default async function GastosFijos({
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
  const [gastos, sucursales, devengados] = await Promise.all([
    listarGastosFijos(usuario),
    sucursalesParaSelector(usuario),
    periodo ? gastosDevengados(usuario, periodo) : Promise.resolve([]),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const devengadoPorGasto = new Map(devengados.map((d) => [d.gastoId, d]))
  const totalMensual = gastos
    .filter((g) => g.vigenteHasta === null)
    .reduce((suma, g) => suma + g.importeMensual, 0)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
      <p className="mt-1 text-sm text-stone-600">
        Lo que hay que pagar aunque no entre nadie.
      </p>
      <NavFinanzas activa="/finanzas/gastos" />

      {error === 'permisos' && (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          data-testid="aviso-permisos"
        >
          Tu rol no tiene permiso para cargar datos financieros. La política de
          la base rechazó el alta, así que no quedó nada a medio guardar. Pedí a
          quien administra el negocio el rol de gerente o contador.
        </p>
      )}

      <form action={registrarGastoFijo} className="mt-6 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Concepto</span>
          <input
            type="text"
            name="concepto"
            required
            data-testid="gasto-concepto"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Categoría</span>
          <select
            name="categoria"
            required
            defaultValue="alquiler"
            data-testid="gasto-categoria"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Sucursal</span>
          <select
            name="sucursalId"
            defaultValue=""
            data-testid="gasto-sucursal"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Toda la organización</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Importe mensual</span>
          <input
            type="number"
            name="importeMensual"
            step="any"
            min="0"
            required
            data-testid="gasto-importe"
            className="mt-1 w-36 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Vigente desde</span>
          <input
            type="date"
            name="vigenteDesde"
            required
            data-testid="gasto-desde"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Agregar
        </button>
      </form>

      <p className="mt-3 text-xs text-stone-500">
        El importe es mensual y vale mientras esté vigente. Cuando cambia —un
        aumento de alquiler— se cierra la vigencia de la fila actual y se carga
        una nueva: así el resultado de los meses ya cerrados no se recalcula con
        el precio de hoy.
      </p>

      <table className="mt-6 w-full border-collapse text-sm" data-testid="tabla-gastos">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Concepto</th>
            <th className="pb-2 font-medium">Categoría</th>
            <th className="pb-2 font-medium">Alcance</th>
            <th className="pb-2 text-right font-medium">Mensual</th>
            <th className="pb-2 text-right font-medium">Del período</th>
            <th className="pb-2 font-medium">Vigencia</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {gastos.map((g) => {
            const d = devengadoPorGasto.get(g.id)
            return (
              <tr key={g.id} className="border-b border-stone-200">
                <td className="py-2">
                  {g.concepto}
                  {!g.enEbitda && (
                    <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                      fuera del EBITDA
                    </span>
                  )}
                </td>
                <td className="py-2 text-stone-600">{ETIQUETA[g.categoria] ?? g.categoria}</td>
                <td className="py-2 text-stone-600">{g.sucursal ?? 'Organización'}</td>
                <td className="py-2 text-right tabular-nums">{importe(g.importeMensual)}</td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {d ? `${importe(d.importe)} (${d.dias} d)` : '—'}
                </td>
                <td className="py-2 text-stone-600">
                  {g.vigenteDesde} → {g.vigenteHasta ?? 'vigente'}
                </td>
                <td className="py-2 text-right">
                  {g.vigenteHasta === null && (
                    <form action={cerrarGastoFijo} className="flex items-center justify-end gap-1">
                      <input type="hidden" name="id" value={g.id} />
                      <input
                        type="date"
                        name="vigenteHasta"
                        required
                        aria-label={`Fecha de baja de ${g.concepto}`}
                        className="rounded border border-stone-300 bg-white px-2 py-1 text-xs"
                      />
                      <button type="submit" className="text-xs text-stone-500 hover:text-stone-900">
                        Dar de baja
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-stone-300 font-medium">
            <td className="py-2" colSpan={3}>
              Estructura vigente
            </td>
            <td className="py-2 text-right tabular-nums" data-testid="total-mensual">
              {importe(totalMensual)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </>
  )
}
