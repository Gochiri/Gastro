'use client'

import { useActionState } from 'react'
import { preguntar, type EstadoExplicacion } from '../(app)/dashboard/acciones'

const INICIAL: EstadoExplicacion = {}

const SUGERENCIAS = [
  '¿Por qué mi food cost está donde está?',
  '¿Me conviene seguir vendiendo por delivery?',
  '¿Qué plato debería revisar primero?',
]

const COLOR_SEVERIDAD: Record<string, string> = {
  informativo: 'border-stone-200 bg-white',
  atencion: 'border-amber-200 bg-amber-50',
  urgente: 'border-red-200 bg-red-50',
}

export function Explicador() {
  const [estado, accion, pendiente] = useActionState(preguntar, INICIAL)

  return (
    <section className="mt-10 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Preguntale a tus números
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Responde sobre las métricas de este período. No calcula nada por su
        cuenta: solo interpreta las cifras que ya ves en esta pantalla.
      </p>

      <form action={accion} className="mt-4">
        <textarea
          name="pregunta"
          rows={2}
          required
          minLength={5}
          maxLength={500}
          defaultValue={estado.pregunta}
          placeholder="¿Por qué cayó mi margen?"
          data-testid="pregunta"
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pendiente}
            data-testid="preguntar"
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pendiente ? 'Pensando…' : 'Preguntar'}
          </button>
          {SUGERENCIAS.map((s) => (
            <button
              key={s}
              type="submit"
              name="pregunta"
              value={s}
              disabled={pendiente}
              className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:border-stone-500 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      </form>

      {estado.error && (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          data-testid="error-ia"
        >
          {estado.error}
        </p>
      )}

      {estado.respuesta && (
        <div className="mt-5" data-testid="respuesta-ia">
          {/*
            Si la respuesta citó cifras que no estaban en el contexto, se
            muestra igual pero con la advertencia arriba. Ocultarla dejaría al
            usuario sin saber que hubo un problema.
          */}
          {estado.cifrasNoRespaldadas && estado.cifrasNoRespaldadas.length > 0 && (
            <p
              className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
              data-testid="aviso-cifras"
            >
              Esta respuesta menciona cifras que no están en tus datos
              ({estado.cifrasNoRespaldadas.join(', ')}). Tomala con reservas y
              contrastá contra las tarjetas de arriba.
            </p>
          )}

          <p className="text-sm leading-relaxed text-stone-900">
            {estado.respuesta.respuesta}
          </p>

          {estado.respuesta.datos_insuficientes && (
            <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
              Los datos cargados no alcanzan para responder esto con precisión.
            </p>
          )}

          {estado.respuesta.hallazgos.length > 0 && (
            <ul className="mt-4 space-y-2">
              {estado.respuesta.hallazgos.map((h) => (
                <li
                  key={h.titulo}
                  className={`rounded-lg border p-3 ${COLOR_SEVERIDAD[h.severidad] ?? COLOR_SEVERIDAD.informativo}`}
                >
                  <div className="text-sm font-medium text-stone-900">{h.titulo}</div>
                  <div className="mt-1 text-sm text-stone-600">{h.detalle}</div>
                </li>
              ))}
            </ul>
          )}

          {estado.respuesta.recomendaciones.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                Qué hacer
              </h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-700">
                {estado.respuesta.recomendaciones.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
