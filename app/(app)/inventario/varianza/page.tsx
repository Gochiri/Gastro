import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { ultimoParCerrado, varianza } from '@/consultas/inventario'
import { formatearCantidad, formatearImporte, formatearPorcentaje } from '@/lib/formato'
import { CifraPrincipal, Tarjeta } from '@/app/componentes/tarjetas'

export default async function Varianza() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const par = await ultimoParCerrado(usuario)
  if (!par) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Varianza de food cost</h1>
        <p className="mt-4 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Hacen falta dos conteos cerrados para comparar.{' '}
          <Link href="/inventario" className="font-medium text-stone-900 underline">
            Hacé un conteo
          </Link>
          .
        </p>
      </>
    )
  }

  const { lineas, resumen } = await varianza(usuario, par.inicial, par.final)

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const pct = (v: number | null): string =>
    v === null ? '—' : formatearPorcentaje(v, organizacion.pais)
  const cant = (v: number): string => formatearCantidad(v, organizacion.pais)

  const brecha =
    resumen.foodCostRealPct !== null && resumen.foodCostTeoricoPct !== null
      ? resumen.foodCostRealPct - resumen.foodCostTeoricoPct
      : null

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Varianza de food cost</h1>
      <p className="mt-1 text-sm text-stone-600">
        Lo que las recetas dicen que debió consumirse, contra lo que el inventario
        dice que se consumió.
      </p>

      <div className="mt-6">
        <CifraPrincipal
          etiqueta="Consumo sin explicación"
          valor={importe(resumen.noExplicadaDinero)}
          nota={
            resumen.mermasDinero > 0
              ? `Del total de ${importe(resumen.varianzaDinero)} de desvío, ${importe(resumen.mermasDinero)} están registrados como merma. El resto no tiene explicación.`
              : `Desvío total de ${importe(resumen.varianzaDinero)}, sin ninguna merma registrada que lo justifique.`
          }
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tarjeta
          etiqueta="Food cost teórico"
          valor={pct(resumen.foodCostTeoricoPct)}
          nota="Lo que dicen las recetas"
          testid="fc-teorico"
        />
        <Tarjeta
          etiqueta="Food cost real"
          valor={pct(resumen.foodCostRealPct)}
          nota="Lo que salió de la heladera"
          testid="fc-real"
        />
        <Tarjeta
          etiqueta="Brecha"
          valor={brecha === null ? '—' : `${brecha > 0 ? '+' : ''}${pct(brecha)}`}
          nota="Puntos de margen que se pierden"
          testid="fc-brecha"
        />
        <Tarjeta
          etiqueta="Cobertura"
          valor={pct(resumen.coberturaPct)}
          nota={`${resumen.insumosComparados} insumos contados en ambos conteos`}
          testid="cobertura"
        />
      </div>

      {resumen.coberturaPct !== null && resumen.coberturaPct < 99.5 && (
        <p
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="aviso-cobertura-varianza"
        >
          El conteo cubre el {pct(resumen.coberturaPct)} del costo teórico del
          período. Los insumos no contados se asumen sin desvío, así que el food
          cost real es una estimación: cuanto más baja la cobertura, menos
          confiable.
        </p>
      )}

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Detalle por insumo
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Ordenado por dinero sin explicar. Un faltante chico de algo caro pesa más
        que uno grande de algo barato.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-testid="detalle-varianza">
          <thead>
            <tr className="border-b border-stone-300 text-left text-stone-500">
              <th className="pb-2 font-medium">Insumo</th>
              <th className="pb-2 text-right font-medium">Consumo real</th>
              <th className="pb-2 text-right font-medium">Debió ser</th>
              <th className="pb-2 text-right font-medium">Desvío</th>
              <th className="pb-2 text-right font-medium">Merma</th>
              <th className="pb-2 text-right font-medium">Sin explicar</th>
              <th className="pb-2 text-right font-medium">En dinero</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const problema = Math.abs(l.noExplicadaDinero) > 0.005
              return (
                <tr key={l.insumo} className="border-b border-stone-200">
                  <td className="py-2 font-medium">{l.insumo}</td>
                  <td className="py-2 text-right tabular-nums text-stone-600">
                    {cant(l.consumoReal)} {l.unidad}
                  </td>
                  <td className="py-2 text-right tabular-nums text-stone-600">
                    {cant(l.consumoTeorico)} {l.unidad}
                  </td>
                  <td className="py-2 text-right tabular-nums text-stone-600">
                    {cant(l.varianzaCantidad)} {l.unidad}
                  </td>
                  <td className="py-2 text-right tabular-nums text-stone-600">
                    {l.mermasRegistradas > 0 ? `${cant(l.mermasRegistradas)} ${l.unidad}` : '—'}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${problema ? 'font-medium text-stone-900' : 'text-stone-400'}`}
                  >
                    {problema ? `${cant(l.varianzaNoExplicada)} ${l.unidad}` : '—'}
                  </td>
                  <td
                    className={`py-2 text-right tabular-nums ${problema ? 'font-medium text-stone-900' : 'text-stone-400'}`}
                  >
                    {problema ? importe(l.noExplicadaDinero) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-8 text-sm">
        <Link href="/inventario" className="text-stone-500 hover:text-stone-900">
          ← Conteos
        </Link>
      </p>
    </>
  )
}
