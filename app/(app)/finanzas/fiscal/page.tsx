import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import {
  listarRetenciones,
  periodoFinanciero,
  reporteIva,
  resumenFiscal,
} from '@/consultas/finanzas'
import { formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { Tarjeta } from '@/app/componentes/tarjetas'
import { NavFinanzas } from '../nav'
import { registrarRetencion } from '../acciones'

const TIPOS: { valor: string; etiqueta: string }[] = [
  { valor: 'iva', etiqueta: 'IVA' },
  { valor: 'ingresos_brutos', etiqueta: 'Ingresos Brutos' },
  { valor: 'ganancias', etiqueta: 'Ganancias' },
  { valor: 'suss', etiqueta: 'Seguridad social' },
  { valor: 'otros', etiqueta: 'Otros' },
]

const ETIQUETA_TIPO: Readonly<Record<string, string>> = Object.fromEntries(
  TIPOS.map((t) => [t.valor, t.etiqueta]),
)

export default async function Fiscal({
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
  if (!periodo) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
        <NavFinanzas activa="/finanzas/fiscal" />
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Sin ventas ni compras cargadas no hay nada que liquidar.
        </p>
      </>
    )
  }

  const [lineas, r, retenciones] = await Promise.all([
    reporteIva(usuario, periodo),
    resumenFiscal(usuario, periodo),
    listarRetenciones(usuario, periodo),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
      <p className="mt-1 text-sm text-stone-600">
        Del {periodo.desde} al {periodo.hasta}
      </p>
      <NavFinanzas activa="/finanzas/fiscal" />

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

      <p
        className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700"
        data-testid="aviso-alcance"
      >
        Esto es una estimación para preparar la liquidación, no la liquidación.
        No contempla saldos a favor arrastrados de períodos anteriores,
        exenciones ni regímenes especiales, y el sistema no emite ningún
        comprobante fiscal.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tarjeta
          etiqueta="IVA débito"
          valor={importe(r.ivaDebito)}
          nota="Sobre las ventas del período"
          testid="iva-debito"
        />
        <Tarjeta
          etiqueta="IVA crédito"
          valor={importe(r.ivaCredito)}
          nota="Sobre las compras del período"
          testid="iva-credito"
        />
        <Tarjeta
          etiqueta="IVA a pagar"
          valor={importe(r.ivaAPagar)}
          nota={`Posición ${importe(r.ivaPosicion)} menos ${importe(r.retencionesIva)} retenidos`}
          testid="iva-a-pagar"
        />
        <Tarjeta
          etiqueta="Total estimado"
          valor={importe(r.totalEstimado)}
          nota="IVA más Ingresos Brutos, neto de retenciones"
          testid="total-estimado"
        />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          IVA por alícuota
        </h2>
        <table className="mt-3 w-full border-collapse text-sm" data-testid="tabla-iva">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="pb-2 font-medium">Alícuota</th>
              <th className="pb-2 text-right font-medium">Base ventas</th>
              <th className="pb-2 text-right font-medium">Débito</th>
              <th className="pb-2 text-right font-medium">Base compras</th>
              <th className="pb-2 text-right font-medium">Crédito</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.tasa} className="border-b border-stone-200">
                <td className="py-2">{pct(l.tasa)}</td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {importe(l.ventasBase)}
                </td>
                <td className="py-2 text-right tabular-nums">{importe(l.ivaDebito)}</td>
                <td className="py-2 text-right tabular-nums text-stone-600">
                  {importe(l.comprasBase)}
                </td>
                <td className="py-2 text-right tabular-nums">{importe(l.ivaCredito)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-stone-500">
          Los alimentos frescos se compran a la alícuota reducida y el plato
          terminado se vende a la general: por eso el crédito no es proporcional
          al débito.
        </p>
      </section>

      {/* Un dato que el food cost no muestra y cambia la lectura del costo. */}
      {r.ivaCredito > 0 && (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="aviso-credito-en-costo"
        >
          Los precios de los insumos están cargados con IVA incluido, así que
          esos {importe(r.ivaCredito)} de crédito fiscal están hoy dentro de tu
          costo de materia prima. Si estás inscripto en IVA, ese dinero es
          recuperable y tu food cost real es más bajo que el que muestra el
          dashboard.
        </p>
      )}

      {r.ingresosBrutosPct !== null && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Ingresos Brutos
          </h2>
          <table className="mt-3 w-full border-collapse text-sm" data-testid="tabla-ib">
            <tbody>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">
                  Base imponible ({pct(r.ingresosBrutosPct)})
                </td>
                <td className="py-2 text-right tabular-nums">{importe(r.ingresosBrutosBase)}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Impuesto calculado</td>
                <td className="py-2 text-right tabular-nums">{importe(r.ingresosBrutos)}</td>
              </tr>
              <tr className="border-b border-stone-200">
                <td className="py-2 text-stone-600">Retenciones sufridas</td>
                <td className="py-2 text-right tabular-nums">{importe(-r.retencionesIb)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-2">A pagar</td>
                <td className="py-2 text-right tabular-nums" data-testid="ib-a-pagar">
                  {importe(r.ibAPagar)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Retenciones sufridas
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Lo que los canales de delivery y los clientes ya te retuvieron. Si no
          se computa contra la posición del período, se paga dos veces.
        </p>

        <form action={registrarRetencion} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="text-xs text-stone-500">Fecha</span>
            <input
              type="date"
              name="fecha"
              required
              data-testid="ret-fecha"
              className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-stone-500">Tipo</span>
            <select
              name="tipo"
              required
              defaultValue="iva"
              data-testid="ret-tipo"
              className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col">
            <span className="text-xs text-stone-500">Contraparte</span>
            <input
              type="text"
              name="contraparte"
              required
              data-testid="ret-contraparte"
              className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-stone-500">Comprobante</span>
            <input
              type="text"
              name="comprobante"
              className="mt-1 w-36 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-stone-500">Importe</span>
            <input
              type="number"
              name="importe"
              step="any"
              min="0"
              required
              data-testid="ret-importe"
              className="mt-1 w-32 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
          >
            Registrar
          </button>
        </form>

        <p className="mt-3 text-xs text-stone-500">
          El importe se carga tal como figura en el certificado: no se recalcula
          a partir de la base por la alícuota. Si no coinciden, manda el
          certificado.
        </p>

        <table className="mt-4 w-full border-collapse text-sm" data-testid="tabla-retenciones">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="pb-2 font-medium">Fecha</th>
              <th className="pb-2 font-medium">Tipo</th>
              <th className="pb-2 font-medium">Contraparte</th>
              <th className="pb-2 font-medium">Comprobante</th>
              <th className="pb-2 text-right font-medium">Importe</th>
            </tr>
          </thead>
          <tbody>
            {retenciones.map((ret) => (
              <tr key={ret.id} className="border-b border-stone-200">
                <td className="py-2 text-stone-600">{ret.fecha}</td>
                <td className="py-2">{ETIQUETA_TIPO[ret.tipo] ?? ret.tipo}</td>
                <td className="py-2">{ret.contraparte}</td>
                <td className="py-2 text-stone-600">{ret.comprobante ?? '—'}</td>
                <td className="py-2 text-right tabular-nums">{importe(ret.importe)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {r.retencionesGanancias > 0 && (
          <p className="mt-3 text-xs text-stone-500">
            Las retenciones de Ganancias ({importe(r.retencionesGanancias)}) son
            pago a cuenta del impuesto anual: no reducen el IVA ni Ingresos
            Brutos, por eso no se restan del total estimado de arriba.
          </p>
        )}
      </section>
    </>
  )
}
