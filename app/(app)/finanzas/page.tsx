import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import {
  coberturaCalendario,
  ebitda,
  equilibrio,
  periodoFinanciero,
} from '@/consultas/finanzas'
import { formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { CifraPrincipal, Tarjeta } from '@/app/componentes/tarjetas'
import { NavFinanzas } from './nav'

export default async function Finanzas() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoFinanciero(usuario)
  if (!periodo) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
        <NavFinanzas activa="/finanzas" />
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Todavía no hay ni ventas ni gastos fijos cargados.{' '}
          <Link href="/finanzas/gastos" className="font-medium text-stone-900 underline">
            Cargá la estructura de costos
          </Link>{' '}
          para ver el EBITDA y el punto de equilibrio.
        </p>
      </>
    )
  }

  const [r, pe, calendario] = await Promise.all([
    ebitda(usuario, periodo),
    equilibrio(usuario, periodo),
    coberturaCalendario(usuario, periodo),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)

  const coberturaParcial = r.coberturaCosteoPct !== null && r.coberturaCosteoPct < 99.5

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Finanzas</h1>
      <p className="mt-1 text-sm text-stone-600">
        Cierre del mes: del {periodo.desde} al {periodo.hasta}
      </p>
      <NavFinanzas activa="/finanzas" />

      <div className="mt-6">
        <CifraPrincipal
          etiqueta="EBITDA del período"
          valor={importe(r.ebitda)}
          nota={
            r.ebitda < 0
              ? `${pct(r.ebitdaPct)} de las ventas. El negocio no cubre su estructura: faltan ${importe(Math.abs(r.ebitda))}.`
              : `${pct(r.ebitdaPct)} de las ventas, después de cubrir toda la estructura de costos`
          }
        />
      </div>

      {/* Un mes entero de estructura contra unos pocos días de ventas da un
          EBITDA que describe los datos cargados, no al negocio. El período no
          se recorta para disimularlo —el IVA y el alquiler son mensuales— pero
          el desfase se dice antes que cualquier otra cosa. */}
      {calendario.diasConVentas > 0 && calendario.diasConVentas < calendario.dias && (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="aviso-calendario"
        >
          Hay ventas cargadas en {calendario.diasConVentas} de los {calendario.dias} días
          del mes ({calendario.primeraVenta} a {calendario.ultimaVenta}), pero la
          estructura de costos se devenga por el mes completo. Mientras falten
          días, este resultado no es el del mes.
        </p>
      )}

      {/* La cobertura de costeo cambia el significado del número, no es una
          nota al pie: sin el costo de una parte de las ventas, el EBITDA que
          se muestra es el mejor caso posible. */}
      {coberturaParcial && (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="aviso-techo-ebitda"
        >
          {importe(r.ventasSinCostear)} de ventas ({pct(100 - (r.coberturaCosteoPct ?? 0))}{' '}
          del total) corresponden a productos sin ficha técnica. Su materia prima
          no está descontada, así que este EBITDA es un <strong>techo</strong>:
          el real es menor.
        </p>
      )}

      {r.fichajesAbiertos > 0 && (
        <p
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="aviso-fichajes"
        >
          Hay {r.fichajesAbiertos} fichaje{r.fichajesAbiertos === 1 ? '' : 's'} sin
          cerrar. Esas horas no están costeadas y abaratan el resultado.
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Del ingreso al resultado
        </h2>
        <table className="mt-3 w-full border-collapse text-sm" data-testid="cascada">
          <tbody>
            {[
              ['Ventas netas', r.ventasNetas, false],
              ['Comisiones de canales', -r.comisiones, true],
              ['Materia prima', -r.costoMateriaPrima, true],
              ['Trabajo fichado', -r.costoLaboral, true],
            ].map(([etiqueta, valor]) => (
              <tr key={etiqueta as string} className="border-b border-stone-200">
                <td className="py-2 text-stone-600">{etiqueta as string}</td>
                <td className="py-2 text-right tabular-nums">{importe(valor as number)}</td>
              </tr>
            ))}
            <tr className="border-b-2 border-stone-300 font-medium">
              <td className="py-2">Margen de contribución</td>
              <td className="py-2 text-right tabular-nums" data-testid="margen-contribucion">
                {importe(r.margenContribucion)}
              </td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2 text-stone-600">Gastos fijos operativos</td>
              <td className="py-2 text-right tabular-nums">{importe(-r.gastosFijos)}</td>
            </tr>
            <tr className="border-b-2 border-stone-300 font-medium">
              <td className="py-2">EBITDA</td>
              <td className="py-2 text-right tabular-nums" data-testid="ebitda">
                {importe(r.ebitda)}
              </td>
            </tr>
            <tr className="border-b border-stone-200">
              <td className="py-2 text-stone-600">
                Intereses y amortizaciones
                <span className="ml-2 text-xs text-stone-400">fuera del EBITDA</span>
              </td>
              <td className="py-2 text-right tabular-nums">{importe(-r.gastosFueraEbitda)}</td>
            </tr>
            <tr className="font-medium">
              <td className="py-2">Resultado</td>
              <td className="py-2 text-right tabular-nums" data-testid="resultado">
                {importe(r.resultado)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-stone-500">
          El EBITDA excluye intereses, amortizaciones e impuesto a las ganancias
          por definición de la métrica. Se listan igual, abajo, porque hay que
          pagarlos.
        </p>
      </section>

      <section className="mt-10" data-testid="punto-equilibrio">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
          Punto de equilibrio
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Cuánto hay que vender, en un período de este mismo largo, para no
          perder plata. El trabajo fichado cuenta como costo variable: escala
          con la demanda.
        </p>

        {pe.ventasEquilibrio === null ? (
          <p
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            data-testid="sin-equilibrio"
          >
            No hay punto de equilibrio: el margen de contribución es{' '}
            {importe(pe.margenContribucion)}. Cada venta adicional aumenta la
            pérdida, así que ningún volumen salva el período. Lo que hay que
            revisar son los precios y el costo de los platos, no las ventas.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Tarjeta
                etiqueta="Ventas necesarias"
                valor={importe(pe.ventasEquilibrio)}
                nota={`${importe(pe.ventaDiariaEquilibrio ?? 0)} por día`}
                testid="ventas-equilibrio"
              />
              <Tarjeta
                etiqueta="Ventas reales"
                valor={importe(pe.ventasReales)}
                nota={`${importe(pe.ventaDiariaReal ?? 0)} por día`}
                testid="ventas-reales"
              />
              <Tarjeta
                etiqueta="Margen de contribución"
                valor={pct(pe.margenContribucionPct)}
                nota="De cada peso vendido, lo que queda para la estructura"
                testid="mc-pct"
              />
              <Tarjeta
                etiqueta="Gastos fijos de caja"
                valor={importe(pe.gastosFijosCaja)}
                nota="Sin amortizaciones: no son salida de caja"
                testid="gastos-caja"
              />
            </div>
            <p
              className={
                pe.alcanzado
                  ? 'mt-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-700'
                  : 'mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900'
              }
              data-testid="brecha"
            >
              {pe.alcanzado
                ? `Se superó el punto de equilibrio por ${importe(pe.brecha ?? 0)}.`
                : `Faltan ${importe(Math.abs(pe.brecha ?? 0))} de ventas para llegar al equilibrio, ` +
                  `o bajar la estructura en ${importe(Math.abs(r.ebitda))}.`}
            </p>
          </>
        )}
      </section>
    </>
  )
}
