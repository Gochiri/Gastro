import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { inspeccionar, interpretar, esImportable } from '../lib/csv.ts'

const CSV = readFileSync(new URL('../supabase/seed/ventas-ejemplo.csv', import.meta.url), 'utf8')

test('detecta delimitador, columnas y formato numérico del archivo', () => {
  const i = inspeccionar(CSV)
  assert.deepEqual(
    i.columnas.map((c) => c.nombre),
    ['Fecha', 'Producto', 'Canal', 'Cantidad', 'Importe', 'Descuento'],
    'debe autodetectar el punto y coma como delimitador',
  )
  assert.equal(i.mapeoSugerido.fecha, 'Fecha')
  assert.equal(i.mapeoSugerido.producto, 'Producto')
  assert.equal(i.mapeoSugerido.importe, 'Importe')
  assert.equal(i.formatoDetectado, 'latam', '"56.000,00" es formato LATAM')
})

test('la fila vacía del medio no genera una fila basura', () => {
  const i = inspeccionar(CSV)
  assert.equal(i.filas, 14, 'son 14 ventas: la fila en blanco se descarta')
})

const filas = () => {
  const i = inspeccionar(CSV)
  return interpretar(CSV, i.mapeoSugerido, i.formatoDetectado)
}

test('los importes con separador de miles se leen completos', () => {
  const f = filas()
  const primera = f[0]
  assert.equal(primera.fecha, '2026-02-05', 'dd/mm/aaaa -> ISO')
  assert.equal(primera.producto, 'Lasaña')
  assert.equal(primera.cantidad, 4)
  assert.equal(primera.importe, 56000, '"56.000,00" son 56 mil, no 56')
})

test('el descuento se lee y el ilegible no rompe la fila', () => {
  const f = filas()
  const conDescuento = f.find((x) => x.crudo.Descuento === '1.400,00')
  assert.equal(conDescuento.descuento, 1400)

  const ilegible = f.find((x) => x.crudo.Descuento === 'ilegible')
  assert.equal(ilegible.descuento, 0, 'se toma cero...')
  assert.match(ilegible.error, /Descuento ilegible/, '...pero se avisa, no en silencio')
  assert.equal(esImportable(ilegible), true, 'la venta sigue siendo válida')
})

test('todas las filas del ejemplo son importables', () => {
  const f = filas()
  const noImportables = f.filter((x) => !esImportable(x))
  assert.equal(noImportables.length, 0, JSON.stringify(noImportables, null, 2))
})

test('un importe mal leído se detectaría: el total cuadra', () => {
  // Si el parser confundiera el formato, este total caería a ~486 en vez de 486.200.
  const total = filas().reduce((s, x) => s + (x.importe ?? 0), 0)
  assert.equal(total, 486200)
})
