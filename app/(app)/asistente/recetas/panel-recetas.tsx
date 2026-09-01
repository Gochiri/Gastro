'use client'

import { useActionState, useId, useState } from 'react'
import Link from 'next/link'
import {
  analizarReceta,
  guardarReceta,
  type EstadoEscandallo,
  type LineaBorrador,
} from '../acciones'
import { AvisoCifras, BotonGenerar, ErrorWidget } from '@/app/componentes/widget'

const INICIAL: EstadoEscandallo = {}

const EJEMPLO = `Ñoquis de papa para 4 porciones
1 kg de papa
250 g de harina 0000
1 huevo
sal a gusto
Salsa: 400 g de tomate perita, 50 ml de aceite de oliva`

export function PanelRecetas({ unidades }: { unidades: string[] }) {
  const [analisis, accionAnalizar, analizando] = useActionState(analizarReceta, INICIAL)

  return (
    <>
      <form action={accionAnalizar} className="mt-6">
        <textarea
          name="texto"
          rows={8}
          required
          minLength={20}
          maxLength={4000}
          defaultValue={analisis.texto}
          placeholder={EJEMPLO}
          data-testid="texto-receta"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
        />
        <div className="mt-2">
          <BotonGenerar
            pendiente={analizando}
            etiqueta="Estructurar la receta"
            etiquetaPendiente="Leyendo…"
            testid="analizar-receta"
          />
        </div>
      </form>

      <ErrorWidget mensaje={analisis.error} />

      {analisis.respuesta && analisis.lineas && (
        <>
          <AvisoCifras cifras={analisis.cifrasNoRespaldadas} />
          {analisis.respuesta.advertencias.length > 0 && (
            <ul
              className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="advertencias-receta"
            >
              {analisis.respuesta.advertencias.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {/*
            La key remonta el formulario cuando llega un borrador nuevo: así el
            estado de los selectores se reinicia solo, sin guardar estado
            derivado en un efecto.
          */}
          <Confirmacion
            key={analisis.respuesta.nombre + analisis.lineas.length}
            nombre={analisis.respuesta.nombre}
            tipo={analisis.respuesta.tipo}
            rendimiento={analisis.respuesta.rendimiento_cantidad}
            unidadRendimiento={analisis.respuesta.rendimiento_unidad}
            rendimientoExplicito={analisis.respuesta.rendimiento_explicito}
            lineas={analisis.lineas}
            unidades={unidades}
          />
        </>
      )}
    </>
  )
}

function Confirmacion({
  nombre,
  tipo,
  rendimiento,
  unidadRendimiento,
  rendimientoExplicito,
  lineas,
  unidades,
}: {
  nombre: string
  tipo: string
  rendimiento: number
  unidadRendimiento: string
  rendimientoExplicito: boolean
  lineas: LineaBorrador[]
  unidades: string[]
}) {
  const [guardado, accionGuardar, guardando] = useActionState(guardarReceta, INICIAL)
  const [elegidos, setElegidos] = useState<string[]>(() =>
    lineas.map((l) => l.preseleccionado),
  )
  const [cantidades, setCantidades] = useState<string[]>(() =>
    lineas.map((l) => (l.cantidad === null ? '' : String(l.cantidad))),
  )
  // Si el texto decía "2 tazas", la unidad llega como "taza" y NO está en el
  // catálogo: el selector queda vacío y la línea no se puede guardar. Convertir
  // esa taza a mililitros sería inventar una equivalencia.
  const [unidadesElegidas, setUnidadesElegidas] = useState<string[]>(() =>
    lineas.map((l) => (l.unidad && unidades.includes(l.unidad) ? l.unidad : '')),
  )
  const idBase = useId()

  const listas = lineas.map(
    (_, i) =>
      elegidos[i] !== '' &&
      unidadesElegidas[i] !== '' &&
      cantidades[i].trim() !== '' &&
      Number(cantidades[i]) > 0,
  )
  const pendientes = listas.filter((x) => !x).length
  const puedeGuardar = listas.some(Boolean) && pendientes === 0

  if (guardado.guardada) {
    return (
      <p
        className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
        data-testid="receta-guardada"
      >
        Se creó la ficha técnica «{guardado.guardada.nombre}».{' '}
        <Link
          href={`/recetas/${guardado.guardada.id}`}
          className="font-medium underline"
        >
          Ver su costeo
        </Link>
        .
      </p>
    )
  }

  return (
    <form action={accionGuardar} className="mt-6" data-testid="borrador">
      <input type="hidden" name="lineas" value={lineas.length} />

      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Borrador — revisá antes de guardar
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Nada de esto está guardado todavía. El asistente no eligió los insumos:
        los propone el catálogo por parecido de nombre, y los confirmás vos.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col">
          <span className="text-xs text-stone-500">Nombre</span>
          <input
            type="text"
            name="nombre"
            required
            defaultValue={nombre}
            data-testid="nombre-receta"
            className="mt-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Tipo</span>
          <select
            name="tipo"
            defaultValue={tipo}
            className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="plato">Plato</option>
            <option value="subreceta">Subreceta</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Rinde</span>
          <input
            type="number"
            name="rendimiento"
            step="any"
            min="0.0001"
            required
            defaultValue={rendimiento}
            data-testid="rendimiento"
            className="mt-1 w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-stone-500">Unidad</span>
          <input
            type="text"
            name="unidadRendimiento"
            required
            defaultValue={unidadRendimiento}
            className="mt-1 w-28 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </label>
      </div>

      {/* El rendimiento divide el costo de TODA la ficha: si lo puso el
          asistente por defecto, quien confirme tiene que saberlo. */}
      {!rendimientoExplicito && (
        <p
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
          data-testid="aviso-rendimiento"
        >
          El texto no decía cuánto rinde. Se puso {rendimiento} {unidadRendimiento} por
          defecto, y ese número divide el costo de toda la ficha: revisalo antes
          de guardar.
        </p>
      )}

      <table className="mt-4 w-full border-collapse text-sm" data-testid="tabla-borrador">
        <thead>
          <tr className="border-b border-stone-300 text-left text-stone-500">
            <th className="pb-2 font-medium">Del texto</th>
            <th className="pb-2 font-medium">Insumo del catálogo</th>
            <th className="pb-2 font-medium">Cantidad</th>
            <th className="pb-2 font-medium">Unidad</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={`${idBase}-${i}`} className="border-b border-stone-200 align-top">
              <td className="py-2 pr-3">
                <div className="text-stone-900">{l.textoOriginal}</div>
                {l.nota && <div className="text-xs text-stone-500">{l.nota}</div>}
              </td>
              <td className="py-2 pr-3">
                <select
                  name={`insumo-${i}`}
                  value={elegidos[i]}
                  data-testid={`insumo-${i}`}
                  onChange={(e) =>
                    setElegidos((previo) =>
                      previo.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  className="w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">— elegir —</option>
                  {l.candidatos.map((c) => (
                    <option key={c.insumoId} value={c.insumoId}>
                      {c.nombre} ({c.unidadBase}) · {Math.round(c.similitud * 100)}%
                    </option>
                  ))}
                </select>
                {l.candidatos.length === 0 && (
                  <div className="mt-1 text-xs text-amber-700">
                    No hay ningún insumo parecido en el catálogo. Cargalo primero
                    en Insumos.
                  </div>
                )}
              </td>
              <td className="py-2 pr-3">
                <input
                  type="text"
                  inputMode="decimal"
                  name={`cantidad-${i}`}
                  value={cantidades[i]}
                  data-testid={`cantidad-${i}`}
                  onChange={(e) =>
                    setCantidades((previo) =>
                      previo.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  className="w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
                />
                {l.cantidad === null && (
                  <div className="mt-1 text-xs text-amber-700">sin cantidad en el texto</div>
                )}
              </td>
              <td className="py-2">
                <select
                  name={`unidad-${i}`}
                  value={unidadesElegidas[i]}
                  data-testid={`unidad-${i}`}
                  onChange={(e) =>
                    setUnidadesElegidas((previo) =>
                      previo.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  className="w-24 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">— elegir —</option>
                  {unidades.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                {l.unidad && !unidades.includes(l.unidad) && (
                  <div className="mt-1 text-xs text-amber-700">
                    el texto dice «{l.unidad}»: convertila vos
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={!puedeGuardar || guardando}
          data-testid="guardar-receta"
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {guardando ? 'Guardando…' : 'Crear la ficha técnica'}
        </button>
        {pendientes > 0 && (
          <span className="text-sm text-stone-500" data-testid="pendientes">
            Faltan {pendientes} línea{pendientes === 1 ? '' : 's'} por resolver.
          </span>
        )}
      </div>

      <ErrorWidget mensaje={guardado.error} />
    </form>
  )
}
