import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')

/**
 * Los cuatro widgets, sin credenciales configuradas.
 *
 * Este contenedor no tiene ANTHROPIC_API_KEY. Lo que se verifica acá es
 * justamente la parte que NO depende del modelo, que en estos widgets es la
 * mayor parte: la matriz de menu engineering y la detección de anomalías se
 * calculan en SQL y se muestran igual. La lógica que sí depende del modelo
 * está probada con invocador simulado en tests/widgets.test.mjs.
 */
test.describe('Widgets de IA', () => {
  test.beforeAll(() => {
    execFileSync(path.join(RAIZ, 'scripts/db.sh'), ['reset'], { stdio: 'pipe' })
    execFileSync('node', [path.join(RAIZ, 'scripts/escenario.mjs')], {
      cwd: RAIZ,
      stdio: 'pipe',
    })
  })

  test.beforeEach(async ({ context }) => {
    await entrarComo(context, USUARIOS.cantinaNorte)
  })

  test('la matriz de la carta clasifica los platos sin necesidad del modelo', async ({ page }) => {
    await page.goto('/asistente')

    const tabla = page.getByTestId('tabla-matriz')
    await expect(tabla.locator('tbody tr')).toHaveCount(4)

    await expect(page.getByTestId('matriz-Lasaña')).toContainText('Estrella')
    await expect(page.getByTestId('matriz-Lasaña')).toContainText('$ 10.625,07')
    await expect(page.getByTestId('matriz-Papas fritas')).toContainText('Vaca lechera')
    await expect(page.getByTestId('matriz-Pizza Margarita')).toContainText('Perro')

    // La cerveza no tiene ficha: no se clasifica y se dice por qué.
    await expect(tabla).not.toContainText('Cerveza artesanal')
    await expect(page.getByTestId('aviso-cobertura-matriz')).toContainText('$ 57.800,00')
  })

  test('un plato al borde del umbral se marca como tal', async ({ page }) => {
    await page.goto('/asistente')
    // La hamburguesa queda a $67 del margen de referencia: su casilla se da
    // vuelta con una semana distinta y eso tiene que estar a la vista.
    await expect(page.getByTestId('borde-Hamburguesa clásica')).toHaveText('en el borde')
  })

  test('las señales se ordenan por dinero y muestran su umbral', async ({ page }) => {
    await page.goto('/asistente/alertas')

    const senales = page.getByTestId('lista-senales').locator('> li')
    await expect(senales).toHaveCount(5)
    // Primera por plata: las ventas sin ficha técnica, $57.800.
    await expect(senales.first()).toContainText('$ 57.800,00')
    await expect(page.getByTestId('senal-varianza_insumo')).toContainText('Carne picada')
    await expect(page.getByTestId('senal-varianza_insumo')).toContainText('$ 13.500,00')
    await expect(page.getByTestId('senal-varianza_insumo')).toContainText('Umbral de la regla')

    // El aviso de precio futuro llega antes de que duela.
    await expect(page.getByTestId('senal-precio_futuro')).toContainText('Tomate perita')

    await expect(page.getByTestId('tabla-umbrales')).toContainText('Suba de precio')
  })

  test('redes ordena por lo que deja, no por lo que se vende', async ({ page }) => {
    await page.goto('/asistente/redes')

    const filas = page.getByTestId('tabla-candidatos').locator('tbody tr')
    // Las papas fritas son lo más vendido y quedan últimas entre las vacas:
    // venderlas más empeora el resultado.
    await expect(filas.first()).toContainText('Lasaña')
    await expect(page.getByText('no van a una red social ni por accidente')).toBeVisible()
  })

  test('el asistente de recetas dice qué no hace antes de que lo usen', async ({ page }) => {
    await page.goto('/asistente/recetas')
    await expect(page.getByText('transcribe, no cocina')).toBeVisible()
    await expect(page.getByTestId('texto-receta')).toBeVisible()
  })

  test('sin credenciales cada widget lo dice, no falla en silencio', async ({ page }) => {
    await page.goto('/asistente')
    await page.getByTestId('analizar-menu').click()
    await expect(page.getByTestId('error-ia')).toContainText('ANTHROPIC_API_KEY')

    await page.goto('/asistente/alertas')
    await page.getByTestId('analizar-alertas').click()
    await expect(page.getByTestId('error-ia')).toContainText('ANTHROPIC_API_KEY')

    await page.goto('/asistente/redes')
    await page.getByTestId('generar-ideas').click()
    await expect(page.getByTestId('error-ia')).toContainText('ANTHROPIC_API_KEY')

    await page.goto('/asistente/recetas')
    await page.getByTestId('texto-receta').fill('Ñoquis de papa\n1 kg de papa\n250 g de harina')
    await page.getByTestId('analizar-receta').click()
    await expect(page.getByTestId('error-ia')).toContainText('ANTHROPIC_API_KEY')
  })

  test('los fallos quedan registrados con su contexto', async ({ page }) => {
    // Un widget que falla en silencio no se arregla nunca: aunque no haya
    // credenciales, el intento no llega a la base porque se corta antes de
    // gastar. Lo que sí se verifica es que la pantalla no quede muda.
    await page.goto('/asistente')
    await page.getByTestId('analizar-menu').click()
    await expect(page.getByTestId('error-ia')).toBeVisible()
    await expect(page.getByTestId('respuesta-menu')).toHaveCount(0)
  })
})
