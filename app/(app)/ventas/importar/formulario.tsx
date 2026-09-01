'use client'

import { useActionState } from 'react'
import { subirCsv, type EstadoImportacion } from '../acciones'

const INICIAL: EstadoImportacion = {}

export function FormularioSubida() {
  const [estado, accion, pendiente] = useActionState(subirCsv, INICIAL)

  return (
    <form action={accion} className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-stone-700">Archivo de ventas (CSV)</span>
        <input
          type="file"
          name="archivo"
          accept=".csv,text/csv"
          required
          data-testid="archivo"
          className="mt-2 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-900 file:px-3 file:py-1.5 file:text-white"
        />
      </label>

      <button
        type="submit"
        disabled={pendiente}
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pendiente ? 'Procesando…' : 'Subir y revisar'}
      </button>

      {estado.error && (
        <p
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          data-testid="error-subida"
        >
          {estado.error}
        </p>
      )}
      {estado.aviso && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {estado.aviso}
        </p>
      )}
    </form>
  )
}
