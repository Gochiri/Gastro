import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { movimientos, stockTeorico } from '@/consultas/inventario'
import { periodoFinanciero } from '@/consultas/finanzas'
import { listarInsumos } from '@/consultas/insumos'
import { sucursalesParaSelector } from '@/consultas/finanzas'
import { formatearCantidad, formatearImporte } from '@/lib/formato'
import { registrarMovimiento } from './acciones'

/** Un conteo viejo arrastra error acumulado: a partir de acá se avisa. */
const DIAS_PARA_DESCONFIAR = 30

const ETIQUETA_TIPO: Readonly<Record<string, string>> = {
  compra: 'Compra',
  merma: 'Merma',
  ajuste: 'Ajuste',
  transferencia_entrada: 'Transferencia (entra)',
  transferencia_salida: 'Transferencia (sale)',
}

export default async function Stock({
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
  const hasta = periodo?.hasta ?? new Date().toISOString().slice(0, 10)

  const [stock, libro, insumos, sucursales] = await Promise.all([
    stockTeorico(usuario, hasta),
    periodo ? movimientos(usuario, periodo) : Promise.resolve([]),
    listarInsumos(usuario),
    sucursalesParaSelector(usuario),
  ])

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)
  const cantidad = (v: number): string => formatearCantidad(v, organizacion.pais)

  const valuacionTotal = stock.reduce((s, f) => s + (f.valuacion ?? 0), 0)
  const masViejo = stock.reduce((m, f) => Math.max(m, f.diasDesdeConteo), 0)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Stock teórico</h1>
      <p className="mt-1 text-sm text-stone-600">
        Lo que <em>debería</em> haber al {hasta}: último conteo, más lo que entró,
        menos lo que salió y lo que las recetas dicen que se consumió.{' '}
        <Link href="/inventario" className="font-medium text-stone-900 underline">
          Ir a conteos
        </Link>
      </p>

      {error === 'permisos' && (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          data-testid="aviso-permisos"
        >
          Tu rol no tiene permiso para registrar movimientos de inventario.
        </p>
      )}

      {/* Es teórico y el nombre lo dice: si coincidiera con la realidad, la
          varianza de food cost no existiría. */}
      <p className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
        Es una estimación, no un inventario. Si coincidiera siempre con la
        realidad, la varianza de food cost no tendría nada que medir. Sirve para
        saber qué reponer sin ir a contar, y para ver contra qué se va a comparar
        el próximo conteo.
      </p>

      {stock.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Hace falta al menos un conteo cerrado para calcular stock: sin punto de
          partida no hay nada que arrastrar.
        </p>
      ) : (
        <>
          {masViejo >= DIAS_PARA_DESCONFIAR && (
            <p
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="aviso-conteo-viejo"
            >
              El conteo más viejo que se está arrastrando tiene {masViejo} días.
              Cada día suma error acumulado: conviene contar antes de decidir
              compras con estos números.
            </p>
          )}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-sm" data-testid="tabla-stock">
              <thead>
                <tr className="border-b border-stone-300 text-left text-stone-500">
                  <th className="pb-2 font-medium">Insumo</th>
                  <th className="pb-2 font-medium">Contado el</th>
                  <th className="pb-2 text-right font-medium">Contado</th>
                  <th className="pb-2 text-right font-medium">Entró</th>
                  <th className="pb-2 text-right font-medium">Salió</th>
                  <th className="pb-2 text-right font-medium">Consumo teórico</th>
                  <th className="pb-2 text-right font-medium">Stock</th>
                  <th className="pb-2 text-right font-medium">Valuación</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((f) => (
                  <tr
                    key={f.insumoId}
                    className="border-b border-stone-200"
                    data-testid={`stock-${f.insumo}`}
                  >
                    <td className="py-2">
                      {f.insumo}
                      <span className="ml-1 text-xs text-stone-400">{f.unidad}</span>
                    </td>
                    <td className="py-2 text-stone-600">
                      {f.conteoBase}
                      <span className="ml-1 text-xs text-stone-400">
                        ({f.diasDesdeConteo} d)
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {cantidad(f.cantidadContada)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {cantidad(f.entradas)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {cantidad(f.salidas)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {cantidad(f.consumoTeorico)}
                    </td>
                    <td
                      className={
                        f.stock < 0
                          ? 'py-2 text-right font-medium tabular-nums text-red-700'
                          : 'py-2 text-right font-medium tabular-nums'
                      }
                    >
                      {cantidad(f.stock)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-stone-600">
                      {f.valuacion === null ? '—' : importe(f.valuacion)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-300 font-medium">
                  <td className="py-2" colSpan={7}>
                    Valuación del stock teórico
                  </td>
                  <td className="py-2 text-right tabular-nums" data-testid="valuacion-total">
                    {importe(valuacionTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
        Ajustes y transferencias
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Lo único que no sale de una compra, una merma o un conteo. Un ajuste con
        motivo es trazable; un stock que cambia solo, no.
      </p>

      <form action={registrarMovimiento} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Tipo</span>
          <select
            name="tipo"
            defaultValue="ajuste"
            data-testid="mov-tipo"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="ajuste">Ajuste</option>
            <option value="transferencia">Transferencia</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Insumo</span>
          <select
            name="insumoId"
            required
            data-testid="mov-insumo"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {insumos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Cantidad</span>
          <input
            type="number"
            name="cantidad"
            step="any"
            required
            data-testid="mov-cantidad"
            className="mt-1 w-28 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Fecha</span>
          <input
            type="date"
            name="fecha"
            required
            data-testid="mov-fecha"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Desde</span>
          <select
            name="origen"
            defaultValue=""
            data-testid="mov-origen"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Hacia</span>
          <select
            name="destino"
            defaultValue=""
            data-testid="mov-destino"
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Motivo</span>
          <input
            type="text"
            name="motivo"
            required
            data-testid="mov-motivo"
            className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          Registrar
        </button>
      </form>
      <p className="mt-2 text-xs text-stone-500">
        En un ajuste la cantidad lleva signo: negativa si se encontró de menos.
        Una transferencia necesita las dos sucursales y descuenta de una para
        sumar en la otra — y entra en el cálculo de varianza, para que mover
        mercadería entre locales no se lea como consumo.
      </p>

      {libro.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Libro de movimientos
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-sm" data-testid="tabla-movimientos">
              <thead>
                <tr className="border-b border-stone-300 text-left text-stone-500">
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Tipo</th>
                  <th className="pb-2 font-medium">Insumo</th>
                  <th className="pb-2 font-medium">Sucursal</th>
                  <th className="pb-2 text-right font-medium">Cantidad</th>
                  <th className="pb-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {libro.map((m, i) => (
                  <tr key={`${m.fecha}-${m.tipo}-${m.insumo}-${i}`} className="border-b border-stone-200">
                    <td className="py-2 text-stone-600">{m.fecha}</td>
                    <td className="py-2">{ETIQUETA_TIPO[m.tipo] ?? m.tipo}</td>
                    <td className="py-2">{m.insumo}</td>
                    <td className="py-2 text-stone-600">{m.sucursal ?? '—'}</td>
                    <td
                      className={
                        m.cantidad < 0
                          ? 'py-2 text-right tabular-nums text-red-700'
                          : 'py-2 text-right tabular-nums'
                      }
                    >
                      {cantidad(m.cantidad)} {m.unidad}
                    </td>
                    <td className="py-2 text-stone-500">{m.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
