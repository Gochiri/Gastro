'use client'

import { useActionState } from 'react'
import { analizarAnomalias, type EstadoWidget } from '../acciones'
import type { RespuestaAnomalias } from '@/lib/widgets/anomalias'
import { AvisoCifras, BotonGenerar, ErrorWidget } from '@/app/componentes/widget'
import { COLOR_SEVERIDAD } from '@/app/componentes/cuadrantes'

const INICIAL: EstadoWidget<RespuestaAnomalias> = {}

export function PanelAlertas() {
  const [estado, accion, pendiente] = useActionState(analizarAnomalias, INICIAL)

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Qué mirar primero
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Las señales de arriba las encuentra la base con reglas y umbrales fijos.
        El asistente las prioriza, propone causas y dice cómo confirmarlas.
      </p>

      <form action={accion} className="mt-4">
        <BotonGenerar pendiente={pendiente} etiqueta="Priorizar las señales" testid="analizar-alertas" />
      </form>

      <ErrorWidget mensaje={estado.error} />

      {estado.respuesta && (
        <div className="mt-5" data-testid="respuesta-alertas">
          <AvisoCifras cifras={estado.cifrasNoRespaldadas} />

          <p className="text-sm leading-relaxed text-stone-900">{estado.respuesta.resumen}</p>

          <ul className="mt-5 space-y-3">
            {estado.respuesta.senales.map((s) => (
              <li
                key={s.entidad}
                className={`rounded-lg border p-3 ${COLOR_SEVERIDAD[s.severidad] ?? COLOR_SEVERIDAD.informativo}`}
              >
                <div className="text-sm font-medium text-stone-900">{s.entidad}</div>
                <p className="mt-1 text-sm text-stone-700">{s.que_pasa}</p>

                {/* Una señal no es un diagnóstico: las causas van en plural y
                    con su forma de confirmarlas, para que nadie acuse a nadie
                    con un número de inventario en la mano. */}
                <div className="mt-2 text-sm text-stone-600">
                  <span className="font-medium">Puede ser: </span>
                  {s.causas_probables.join(' · ')}
                </div>
                <div className="mt-1 text-sm text-stone-600">
                  <span className="font-medium">Hacé esto: </span>
                  {s.que_hacer}
                </div>
                <div className="mt-1 text-sm text-stone-500">
                  <span className="font-medium text-stone-600">Para confirmar: </span>
                  {s.como_confirmar}
                </div>
              </li>
            ))}
          </ul>

          {estado.respuesta.falsos_positivos.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Probablemente ruido
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-600">
                {estado.respuesta.falsos_positivos.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
