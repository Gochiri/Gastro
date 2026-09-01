import Link from 'next/link'
import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { filasPendientes, listarImportaciones } from '@/consultas/ventas'
import { formatearImporte } from '@/lib/formato'
import { FormularioSubida } from './formulario'
import { catalogoProductos, confirmar, descartar, resolverProducto } from '../acciones'

export default async function Importar() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')

  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const importaciones = await listarImportaciones(usuario)
  const enRevision = importaciones.find((i) => i.estado === 'borrador')

  if (!enRevision) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Importar ventas</h1>
        <p className="mt-1 text-sm text-stone-600">
          Un CSV con fecha, producto, canal, cantidad e importe. Las columnas se
          detectan solas y los nombres de productos se emparejan con el catálogo.
        </p>
        <FormularioSubida />
      </>
    )
  }

  const [pendientes, productos] = await Promise.all([
    filasPendientes(usuario, enRevision.id),
    catalogoProductos(),
  ])
  const importe = (v: number): string =>
    formatearImporte(v, organizacion.moneda, organizacion.pais)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Revisar importación</h1>
      <p className="mt-1 text-sm text-stone-600">
        {enRevision.nombreArchivo} · {enRevision.filasTotal} filas ·{' '}
        <span data-testid="filas-ok">{enRevision.filasOk} listas</span>
        {enRevision.filasError > 0 && ` · ${enRevision.filasError} por resolver`}
      </p>

      {pendientes.length > 0 ? (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Productos no reconocidos
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Elegí a qué producto corresponde cada uno. La decisión queda guardada:
            la próxima importación lo resuelve sola.
          </p>

          <ul className="mt-4 space-y-3" data-testid="pendientes">
            {pendientes.map((p) => (
              <li key={p.id} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{p.textoProducto}</span>
                  <span className="text-sm text-stone-500">
                    fila {p.numeroFila} · {p.cantidad} × {importe(p.importe)}
                  </span>
                </div>
                <form action={resolverProducto} className="mt-3 flex gap-2">
                  <input type="hidden" name="stagingId" value={p.id} />
                  <select
                    name="productoId"
                    required
                    defaultValue={p.sugerencias[0]?.productoId ?? ''}
                    data-testid={`select-${p.textoProducto}`}
                    className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="" disabled>
                      Elegir producto…
                    </option>
                    {p.sugerencias.length > 0 && (
                      <optgroup label="Sugerencias">
                        {p.sugerencias.map((s) => (
                          <option key={s.productoId} value={s.productoId}>
                            {s.nombre} ({Math.round(s.similitud * 100)}% de parecido)
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Todo el catálogo">
                      {productos.map((prod) => (
                        <option key={prod.id} value={prod.id}>
                          {prod.nombre}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:border-stone-500"
                  >
                    Asignar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p
          className="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-700"
          data-testid="listo-para-confirmar"
        >
          Todas las filas están resueltas. Al confirmar, cada venta queda costeada
          con los precios vigentes a su fecha y ese costo no vuelve a cambiar solo.
        </p>
      )}

      <div className="mt-8 flex gap-3">
        <form action={confirmar}>
          <input type="hidden" name="importacionId" value={enRevision.id} />
          <button
            type="submit"
            disabled={pendientes.length > 0}
            data-testid="confirmar"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Confirmar importación
          </button>
        </form>
        <form action={descartar}>
          <input type="hidden" name="importacionId" value={enRevision.id} />
          <button
            type="submit"
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:border-stone-500"
          >
            Descartar
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm">
        <Link href="/ventas" className="text-stone-500 hover:text-stone-900">
          ← Historial de importaciones
        </Link>
      </p>
    </>
  )
}
