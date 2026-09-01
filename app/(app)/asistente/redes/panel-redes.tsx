'use client'

import { useActionState } from 'react'
import { generarIdeas, type EstadoWidget } from '../acciones'
import type { RespuestaRrss } from '@/lib/widgets/rrss'
import { AvisoCifras, BotonGenerar, ErrorWidget } from '@/app/componentes/widget'

const INICIAL: EstadoWidget<RespuestaRrss> = {}

const ETIQUETA_FORMATO: Record<string, string> = {
  reel: 'Reel',
  carrusel: 'Carrusel',
  historia: 'Historia',
  post: 'Post',
  video_largo: 'Video largo',
}

export function PanelRedes() {
  const [estado, accion, pendiente] = useActionState(generarIdeas, INICIAL)

  return (
    <section className="mt-8 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Plan de la semana
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Construido sobre los platos que más dejan, no sobre los que más se
        venden. El plato que ya se vende solo no necesita que le pagues alcance.
      </p>

      <form action={accion} className="mt-4">
        <input
          type="text"
          name="nota"
          maxLength={300}
          placeholder="Algo del negocio esta semana: un evento, una fecha, un ingrediente de temporada…"
          data-testid="nota-redes"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />
        <div className="mt-2">
          <BotonGenerar pendiente={pendiente} etiqueta="Armar el plan" testid="generar-ideas" />
        </div>
      </form>

      <ErrorWidget mensaje={estado.error} />

      {estado.respuesta && (
        <div className="mt-5" data-testid="respuesta-redes">
          <AvisoCifras cifras={estado.cifrasNoRespaldadas} proposito="publicacion" />

          <p className="text-sm leading-relaxed text-stone-900">{estado.respuesta.estrategia}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {estado.respuesta.pilares.map((p) => (
              <span key={p} className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-700">
                {p}
              </span>
            ))}
          </div>

          <ul className="mt-5 space-y-3">
            {estado.respuesta.publicaciones.map((p, i) => (
              <li key={`${p.dia}-${i}`} className="rounded-lg border border-stone-200 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <span className="font-medium text-stone-700">{p.dia}</span>
                  <span>·</span>
                  <span>{ETIQUETA_FORMATO[p.formato] ?? p.formato}</span>
                  <span>·</span>
                  <span>{p.pilar}</span>
                  {p.producto && (
                    <>
                      <span>·</span>
                      <span className="text-stone-700">{p.producto}</span>
                    </>
                  )}
                </div>
                <div className="mt-2 text-sm font-medium text-stone-900">{p.titulo}</div>
                <p className="mt-1 text-sm italic text-stone-700">«{p.hook}»</p>
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-stone-600">
                  {p.desarrollo.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-stone-700">
                  <span className="font-medium">CTA: </span>
                  {p.cta}
                </p>
                <p className="mt-1 text-xs text-stone-400">{p.hashtags.join(' ')}</p>
              </li>
            ))}
          </ul>

          {/*
            Una promoción NO se anuncia dentro de una pieza de contenido: es una
            decisión del dueño, no de copy. Va acá, separada, con el margen que
            se resigna dicho de frente.
          */}
          {estado.respuesta.promocion_propuesta && (
            <div
              className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"
              data-testid="promocion-propuesta"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                Propuesta de promoción — a decidir por vos
              </h3>
              <p className="mt-2 text-sm text-amber-950">
                {estado.respuesta.promocion_propuesta.idea}
              </p>
              <p className="mt-2 text-sm text-amber-900">
                <span className="font-medium">Por qué ese plato: </span>
                {estado.respuesta.promocion_propuesta.por_que_este}
              </p>
              <p className="mt-1 text-sm text-amber-900">
                <span className="font-medium">Qué resignás: </span>
                {estado.respuesta.promocion_propuesta.advertencia}
              </p>
              <p className="mt-2 text-xs text-amber-800">
                Ninguna de las piezas de arriba menciona esta promoción. Si la
                aprobás, hay que sumarla al copy a mano.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
