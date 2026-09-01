import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { periodoFinanciero } from '@/consultas/finanzas'
import { matrizMenu } from '@/consultas/widgets'
import { formatearImporte } from '@/lib/formato'
import { COLOR_CUADRANTE, ETIQUETA_CUADRANTE } from '@/app/componentes/cuadrantes'
import { NavAsistente } from '../nav'
import { PanelRedes } from './panel-redes'

export default async function Redes() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const periodo = await periodoFinanciero(usuario)
  const matriz = periodo ? await matrizMenu(usuario, periodo) : []

  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)

  // Lo que hay que empujar: primero los rompecabezas (dejan mucho y nadie los
  // pide), después las estrellas como gancho de marca.
  const prioridad: Record<string, number> = { rompecabezas: 0, estrella: 1, vaca: 2, perro: 3 }
  const candidatos = [...matriz].sort(
    (a, b) =>
      prioridad[a.clasificacion] - prioridad[b.clasificacion] ||
      b.margenUnitario - a.margenUnitario,
  )

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
      <p className="mt-1 text-sm text-stone-600">
        Contenido para redes, a partir de tus propios números.
      </p>
      <NavAsistente activa="/asistente/redes" />

      {matriz.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
          Sin platos costeados no se puede saber cuál conviene promocionar, que
          es justamente lo que este asistente aporta.
        </p>
      ) : (
        <>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Qué conviene empujar
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            El orden no es por ventas. Un <strong>rompecabezas</strong> deja
            mucho y casi nadie lo pide: es donde el contenido rinde más. Una{' '}
            <strong>vaca lechera</strong> se vende sola y deja poco — venderla
            más empeora el resultado.
          </p>

          <table className="mt-4 w-full border-collapse text-sm" data-testid="tabla-candidatos">
            <thead>
              <tr className="border-b border-stone-300 text-left text-stone-500">
                <th className="pb-2 font-medium">Plato</th>
                <th className="pb-2 font-medium">Cuadrante</th>
                <th className="pb-2 text-right font-medium">Precio</th>
                <th className="pb-2 text-right font-medium">Deja por unidad</th>
              </tr>
            </thead>
            <tbody>
              {candidatos.map((f) => (
                <tr key={f.productoId} className="border-b border-stone-200">
                  <td className="py-2">{f.producto}</td>
                  <td className="py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${COLOR_CUADRANTE[f.clasificacion]}`}>
                      {ETIQUETA_CUADRANTE[f.clasificacion]}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-stone-600">
                    {importe(f.precioPromedio)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{importe(f.margenUnitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 text-xs text-stone-500">
            El asistente recibe estos precios y márgenes, y tiene prohibido
            inventar otros. Los costos internos no salen de acá: no van a una red
            social ni por accidente.
          </p>

          <PanelRedes />
        </>
      )}
    </>
  )
}
