'use client'

import { useActionState } from 'react'
import { analizarMenu, type EstadoWidget } from './acciones'
import type { RespuestaMenu } from '@/lib/widgets/menu'
import { AvisoCifras, BotonGenerar, ErrorWidget } from '@/app/componentes/widget'

const INICIAL: EstadoWidget<RespuestaMenu> = {}

const ETIQUETA_ACCION: Record<string, string> = {
  mantener: 'Mantener',
  subir_precio: 'Subir precio',
  bajar_costo: 'Bajar costo',
  dar_visibilidad: 'Dar visibilidad',
  rediseñar: 'Rediseñar',
  retirar: 'Retirar',
}

export function PanelMenu() {
  const [estado, accion, pendiente] = useActionState(analizarMenu, INICIAL)

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Qué hacer con cada plato
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        La matriz de arriba está calculada en la base. El analista no la
        reclasifica: lee la casilla de cada plato y recomienda una acción.
      </p>

      <form action={accion} className="mt-4">
        <BotonGenerar pendiente={pendiente} etiqueta="Analizar la carta" testid="analizar-menu" />
      </form>

      <ErrorWidget mensaje={estado.error} />

      {estado.respuesta && (
        <div className="mt-5" data-testid="respuesta-menu">
          <AvisoCifras cifras={estado.cifrasNoRespaldadas} />

          <p className="text-sm leading-relaxed text-stone-900">{estado.respuesta.lectura}</p>

          {estado.respuesta.datos_insuficientes && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              La matriz cubre una parte demasiado chica del negocio como para
              sacar conclusiones de la carta entera.
            </p>
          )}

          {estado.respuesta.orden_de_ataque.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Por dónde empezar
              </h3>
              <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-stone-700">
                {estado.respuesta.orden_de_ataque.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </>
          )}

          <ul className="mt-5 space-y-3">
            {estado.respuesta.platos.map((p) => (
              <li key={p.producto} className="rounded-lg border border-stone-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-stone-900">{p.producto}</span>
                  <span className="rounded bg-stone-900 px-2 py-0.5 text-xs text-white">
                    {ETIQUETA_ACCION[p.accion] ?? p.accion}
                  </span>
                </div>
                <p className="mt-2 text-sm text-stone-600">{p.por_que}</p>
                {/* El riesgo va SIEMPRE visible, no plegado: un consejo sin
                    contraindicación es un consejo que nadie puede evaluar. */}
                <p className="mt-2 text-sm text-stone-500">
                  <span className="font-medium text-stone-600">Riesgo: </span>
                  {p.riesgo}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
