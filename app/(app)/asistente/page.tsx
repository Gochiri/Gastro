import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { periodoFinanciero } from '@/consultas/finanzas'
import { coberturaMatriz, matrizMenu } from '@/consultas/widgets'
import { formatearCantidad, formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { COLOR_CUADRANTE, ETIQUETA_CUADRANTE } from '@/app/componentes/cuadrantes'
import { NavAsistente } from './nav'
import { PanelMenu } from './panel-menu'

/** Un plato a menos del 10% de un umbral está en el borde, no clasificado. */
const MARGEN_DE_BORDE = 0.1

export default async function Asistente() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoFinanciero(usuario)
  if (!periodo) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
        <NavAsistente activa="/asistente" />
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Todavía no hay ventas cargadas.{' '}
          <Link href="/ventas/importar" className="font-medium text-stone-900 underline">
            Importá un archivo de ventas
          </Link>{' '}
          para armar la matriz de la carta.
        </p>
      </>
    )
  }

  const [matriz, cobertura] = await Promise.all([
    matrizMenu(usuario, periodo),
    coberturaMatriz(usuario, periodo),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)

  const parcial = cobertura.coberturaPct !== null && cobertura.coberturaPct < 99.5

  const enElBorde = (f: (typeof matriz)[number]): boolean =>
    Math.abs(f.distanciaMargen) < f.margenReferencia * MARGEN_DE_BORDE ||
    Math.abs(f.distanciaPopularidad) < (f.umbralPopularidadPct ?? 0) * MARGEN_DE_BORDE

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
      <p className="mt-1 text-sm text-stone-600">
        Del {periodo.desde} al {periodo.hasta}
      </p>
      <NavAsistente activa="/asistente" />

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Matriz de la carta
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Cada plato cruzado por cuánto se vende y cuánto deja. El margen se
        compara <strong>por unidad</strong>: un plato con 70% de margen sobre
        $2.000 deja menos que uno con 30% sobre $12.000.
      </p>

      {matriz.length === 0 ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Ninguna venta del período tiene ficha técnica cargada, así que no hay
          margen con el que clasificar.
        </p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm" data-testid="tabla-matriz">
              <thead>
                <tr className="border-b border-stone-300 text-left text-stone-500">
                  <th className="pb-2 font-medium">Plato</th>
                  <th className="pb-2 text-right font-medium">Unidades</th>
                  <th className="pb-2 text-right font-medium">Popularidad</th>
                  <th className="pb-2 text-right font-medium">Margen unitario</th>
                  <th className="pb-2 text-right font-medium">Margen total</th>
                  <th className="pb-2 font-medium">Cuadrante</th>
                </tr>
              </thead>
              <tbody>
                {matriz.map((f) => (
                  <tr
                    key={f.productoId}
                    className="border-b border-stone-200"
                    data-testid={`matriz-${f.producto}`}
                  >
                    <td className="py-2">{f.producto}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatearCantidad(f.unidades, organizacion.pais, 0)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {pct(f.popularidadPct)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{importe(f.margenUnitario)}</td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {importe(f.margen)}
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${COLOR_CUADRANTE[f.clasificacion]}`}
                      >
                        {ETIQUETA_CUADRANTE[f.clasificacion]}
                      </span>
                      {/* Una clasificación que se da vuelta con una venta más
                          no es un veredicto, y hay que decirlo. */}
                      {enElBorde(f) && (
                        <span className="ml-2 text-xs text-stone-500" data-testid={`borde-${f.producto}`}>
                          en el borde
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-stone-500">
            Umbral de popularidad: {pct(matriz[0].umbralPopularidadPct)} (el 70%
            del reparto parejo entre {matriz.length} platos). Margen de
            referencia: {importe(matriz[0].margenReferencia)} por unidad.
          </p>

          {parcial && (
            <p
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="aviso-cobertura-matriz"
            >
              {importe(cobertura.ventasSinFicha)} de ventas ({pct(100 - (cobertura.coberturaPct ?? 0))}{' '}
              del total, en {cobertura.productosSinFicha} producto
              {cobertura.productosSinFicha === 1 ? '' : 's'}) quedan fuera de la
              matriz por no tener ficha técnica. La carta que ves acá no es toda
              tu carta.
            </p>
          )}

          <PanelMenu />
        </>
      )}
    </>
  )
}
