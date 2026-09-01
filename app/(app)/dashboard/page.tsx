import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { margenPorCanal, margenPorProducto, periodoConDatos, resumen } from '@/consultas/kpis'
import { primeCost } from '@/consultas/personal'
import { formatearCantidad, formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { BarrasHorizontales, CifraPrincipal, Tarjeta } from '@/app/componentes/tarjetas'
import { Explicador } from '@/app/componentes/explicador'

export default async function Dashboard() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoConDatos(usuario)
  if (!periodo) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Resultados</h1>
        <p className="mt-4 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Todavía no hay ventas cargadas.{' '}
          <Link href="/ventas/importar" className="font-medium text-stone-900 underline">
            Importá un archivo de ventas
          </Link>{' '}
          para ver food cost, margen y rentabilidad por canal.
        </p>
      </>
    )
  }

  const [datos, canales, productos, prime] = await Promise.all([
    resumen(usuario, periodo),
    margenPorCanal(usuario, periodo),
    margenPorProducto(usuario, periodo),
    primeCost(usuario, periodo),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)

  const coberturaParcial = datos.coberturaPct !== null && datos.coberturaPct < 99.5

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Resultados</h1>
      <p className="mt-1 text-sm text-stone-600">
        Del {periodo.desde} al {periodo.hasta} · {formatearCantidad(datos.tickets, organizacion.pais)} ventas
      </p>

      <div className="mt-6">
        <CifraPrincipal
          etiqueta="Margen de contribución"
          valor={importe(datos.margen)}
          nota={
            coberturaParcial
              ? `${pct(datos.margenPct)} de las ventas. Incluye productos sin ficha técnica, cuyo costo todavía no se descuenta.`
              : `${pct(datos.margenPct)} de las ventas, después de comisiones y materia prima`
          }
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tarjeta
          etiqueta="Ventas"
          valor={importe(datos.ventasBrutas)}
          nota={`Ticket promedio ${datos.ticketPromedio === null ? '—' : importe(datos.ticketPromedio)}`}
          testid="kpi-ventas"
        />
        <Tarjeta
          etiqueta="Food cost"
          valor={pct(datos.foodCostPct)}
          // La cobertura va pegada al food cost, no escondida: un food cost
          // calculado sobre parte del negocio no es el food cost del negocio.
          nota={
            coberturaParcial
              ? `Solo sobre el ${pct(datos.coberturaPct)} de las ventas con receta cargada`
              : 'Sobre la totalidad de las ventas'
          }
          testid="kpi-food-cost"
        />
        <Tarjeta
          etiqueta="Comisiones"
          valor={importe(datos.comisiones)}
          nota="Retenido por los canales de delivery"
          testid="kpi-comisiones"
        />
        <Tarjeta
          etiqueta="Materia prima"
          valor={importe(datos.costoTeorico)}
          nota={`${formatearCantidad(datos.unidades, organizacion.pais)} unidades vendidas`}
          testid="kpi-costo"
        />
      </div>

      {coberturaParcial && (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="aviso-cobertura"
        >
          El {pct(100 - (datos.coberturaPct ?? 0))} de las ventas corresponde a productos sin
          ficha técnica. Su costo no entra en el food cost de arriba.
        </p>
      )}

      {prime && prime.costoLaboral > 0 && (
        <section className="mt-10" data-testid="prime-cost">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
            Prime cost
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Materia prima más trabajo, sobre las ventas costeadas. Por encima del
            65% no queda margen para alquiler, servicios y ganancia.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-4">
            <Tarjeta
              etiqueta="Materia prima"
              valor={pct(prime.foodCostPct)}
              nota={importe(prime.costoComida)}
              testid="prime-comida"
            />
            <Tarjeta
              etiqueta="Trabajo"
              valor={pct(prime.laborCostPct)}
              nota={`${importe(prime.costoLaboral)} en ${formatearCantidad(prime.horas, organizacion.pais)} horas`}
              testid="prime-trabajo"
            />
            <Tarjeta
              etiqueta="Prime cost"
              valor={pct(prime.primeCostPct)}
              nota={
                prime.primeCostPct !== null && prime.primeCostPct > 65
                  ? 'Por encima del umbral sano'
                  : 'Dentro del umbral sano'
              }
              testid="prime-total"
            />
          </div>
          {prime.fichajesAbiertos > 0 && (
            <p
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="aviso-fichajes"
            >
              Hay {prime.fichajesAbiertos} fichaje(s) sin cerrar en el período. Esas
              horas no están contadas, así que el costo laboral real es mayor que
              el que se muestra.
            </p>
          )}
        </section>
      )}

      <div className="mt-10">
        <BarrasHorizontales
          titulo="Margen por unidad, según canal"
          descripcion="Lo que queda de cada unidad vendida después de la comisión del canal y la materia prima."
          datos={canales.map((c) => ({
            etiqueta: c.canal,
            valor: c.margenUnitario,
            texto: importe(c.margenUnitario),
          }))}
        />
      </div>

      <Explicador />

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Margen por producto
      </h2>
      <table className="mt-4 w-full border-collapse text-sm" data-testid="tabla-productos">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Producto</th>
            <th className="pb-2 text-right font-medium">Unidades</th>
            <th className="pb-2 text-right font-medium">Ventas</th>
            <th className="pb-2 text-right font-medium">Margen</th>
            <th className="pb-2 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.producto} className="border-b border-stone-200">
              <td className="py-2">
                {p.producto}
                {!p.costeadoCompleto && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                    sin costear
                  </span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums text-stone-600">
                {formatearCantidad(p.unidades, organizacion.pais)}
              </td>
              <td className="py-2 text-right tabular-nums text-stone-600">{importe(p.ventas)}</td>
              {/*
                Un producto sin ficha técnica no tiene margen conocido: mostrar
                el que sale de suponer costo cero lo pondría a la cabeza de la
                tabla como si fuese el más rentable del negocio. Se muestra un
                guion, no un número inventado.
              */}
              <td className="py-2 text-right tabular-nums font-medium">
                {p.costeadoCompleto ? importe(p.margen) : <span className="text-stone-400">—</span>}
              </td>
              <td className="py-2 text-right tabular-nums text-stone-500">
                {p.costeadoCompleto ? pct(p.margenPct) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* El margen de contribución no es el resultado: falta descontar la
          estructura. Sin este puente, el dashboard se lee como si el negocio
          ganara plata. */}
      <p className="mt-10 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
        Este margen todavía no descuenta el alquiler, los servicios ni la
        administración.{' '}
        <Link href="/finanzas" className="font-medium text-stone-900 underline">
          Cerrá el mes en Finanzas
        </Link>{' '}
        para ver el EBITDA y cuánto falta vender para el punto de equilibrio.
      </p>
    </>
  )
}
