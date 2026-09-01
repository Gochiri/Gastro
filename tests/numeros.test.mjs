import { strict as assert } from 'node:assert'
import test from 'node:test'
import { detectarFormato, parsearNumero, parsearFecha } from '../lib/numeros.ts'

test('formato LATAM: el punto agrupa y la coma decimaliza', () => {
  const f = 'latam'
  assert.equal(parsearNumero('1.234,56', f), 1234.56)
  assert.equal(parsearNumero('12,50', f), 12.5)
  assert.equal(parsearNumero('1.234.567,89', f), 1234567.89)
  assert.equal(parsearNumero('1234', f), 1234)
  assert.equal(parsearNumero('1234,5', f), 1234.5)
  assert.equal(parsearNumero('$ 8.000,00', f), 8000)
  assert.equal(parsearNumero('-450,25', f), -450.25)
})

test('formato US: la coma agrupa y el punto decimaliza', () => {
  const f = 'us'
  assert.equal(parsearNumero('1,234.56', f), 1234.56)
  assert.equal(parsearNumero('12.50', f), 12.5)
  assert.equal(parsearNumero('1,234,567.89', f), 1234567.89)
  assert.equal(parsearNumero('1234', f), 1234)
})

test('vacío y basura devuelven null, nunca cero', () => {
  for (const v of ['', '   ', null, undefined, 'sin dato', '-', 'N/A']) {
    assert.equal(parsearNumero(v, 'latam'), null, `debería ser null: ${JSON.stringify(v)}`)
  }
  // Cero explícito sí es un número.
  assert.equal(parsearNumero('0', 'latam'), 0)
})

test('detección por columna, no por valor suelto', () => {
  // "1,234" solo es ambiguo; junto a "12,50" la coma queda clara como decimal.
  assert.equal(detectarFormato(['1,234']).evidencia, 0)
  assert.equal(detectarFormato(['1,234', '12,50']).formato, 'latam')
  assert.equal(detectarFormato(['1,234.56', '99.90']).formato, 'us')
  assert.equal(detectarFormato(['1.234.567', '890']).formato, 'latam')
})

test('una columna con formatos mezclados se marca como ambigua', () => {
  const d = detectarFormato(['1.234,56', '1,234.56'])
  assert.equal(d.ambiguo, true, 'debe avisar de la mezcla en vez de elegir en silencio')
})

test('sin evidencia se usa el formato por defecto y se avisa', () => {
  const d = detectarFormato(['100', '250', '1000'])
  assert.equal(d.formato, 'latam')
  assert.equal(d.evidencia, 0)
  assert.equal(d.ambiguo, true)
  // Sin separadores, ambos formatos dan lo mismo: la ambigüedad no hace daño.
  assert.equal(parsearNumero('100', 'latam'), parsearNumero('100', 'us'))
})

test('fechas en los formatos habituales de un POS', () => {
  assert.equal(parsearFecha('2026-03-15'), '2026-03-15')
  assert.equal(parsearFecha('15/03/2026'), '2026-03-15')
  assert.equal(parsearFecha('5-3-2026'), '2026-03-05')
  assert.equal(parsearFecha('15/03/26'), '2026-03-15')
  assert.equal(parsearFecha('no es fecha'), null)
  assert.equal(parsearFecha(''), null)
})
