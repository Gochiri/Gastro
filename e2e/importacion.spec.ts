import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')
const CSV = path.join(RAIZ, 'supabase/seed/ventas-ejemplo.csv')

/**
 * Flujo completo del importador, por navegador.
 *
 * Cierra el circuito entre el CSV sucio y el dashboard: los importes que ve el
 * dueño del restaurante deben coincidir con el cálculo hecho a mano en
 * tests/ventas.test.mjs.
 */
test.describe('Importar ventas y ver resultados', () => {
  test.beforeAll(() => {
    // Base limpia: este flujo escribe ventas y el hash del archivo impide
    // volver a importarlo.
    execFileSync(path.join(RAIZ, 'scripts/db.sh'), ['reset'], { stdio: 'ignore' })
  })

  test.beforeEach(async ({ context }) => {
    await entrarComo(context, USUARIOS.cantinaNorte)
  })

  test('del CSV al dashboard, con el producto desconocido resuelto a mano', async ({ page }) => {
    await page.goto('/ventas/importar')

    // --- Subida -------------------------------------------------------------
    await page.getByTestId('archivo').setInputFiles(CSV)
    await page.getByRole('button', { name: 'Subir y revisar' }).click()

    // 13 de 14 filas se resuelven solas, incluidas "LASAÑA" y
    // "HAMBURGUESA CLASICA" en mayúsculas y sin acentos.
    await expect(page.getByTestId('filas-ok')).toHaveText('13 listas')

    // --- Resolución ---------------------------------------------------------
    const pendientes = page.getByTestId('pendientes').getByRole('listitem')
    await expect(pendientes).toHaveCount(1)
    await expect(pendientes.first()).toContainText('Milanesa napolitana')

    // No se puede confirmar dejando ventas sin asignar.
    await expect(page.getByTestId('confirmar')).toBeDisabled()

    await page
      .getByTestId('select-Milanesa napolitana')
      .selectOption({ label: 'Hamburguesa clásica' })
    await page.getByRole('button', { name: 'Asignar' }).click()

    await expect(page.getByTestId('listo-para-confirmar')).toBeVisible()
    await expect(page.getByTestId('confirmar')).toBeEnabled()

    // --- Confirmación -------------------------------------------------------
    await page.getByTestId('confirmar').click()
    await expect(page).toHaveURL(/\/dashboard$/)

    // --- Los números del dashboard ------------------------------------------
    // Verificados a mano en tests/ventas.test.mjs.
    await expect(page.getByTestId('cifra-principal')).toHaveText('$ 359.193,29')
    await expect(page.getByTestId('kpi-ventas')).toHaveText('$ 484.800,00')
    await expect(page.getByTestId('kpi-comisiones')).toHaveText('$ 37.139,00')
    await expect(page.getByTestId('kpi-food-cost')).toHaveText('20,7 %')
  })

  test('la cobertura de costeo se muestra junto al food cost', async ({ page }) => {
    await page.goto('/dashboard')

    // Dos ventas de cerveza no tienen receta: el food cost cubre el 88% de las
    // ventas y eso tiene que estar a la vista, no escondido.
    await expect(page.getByTestId('aviso-cobertura')).toContainText('sin ficha técnica')
    await expect(page.getByTestId('tabla-productos')).toContainText('sin costear')
  })

  test('el margen por unidad cae al vender por un canal con comisión', async ({ page }) => {
    await page.goto('/dashboard')

    const seccion = page.locator('section', { hasText: 'Margen por unidad' })
    await expect(seccion).toContainText('Salón')
    await expect(seccion).toContainText('Rappi')

    // El orden es por margen unitario descendente: salón primero, Rappi último.
    const etiquetas = await seccion.getByRole('listitem').allInnerTexts()
    const posicionSalon = etiquetas.findIndex((t) => t.includes('Salón'))
    const posicionRappi = etiquetas.findIndex((t) => t.includes('Rappi'))
    expect(posicionSalon).toBeLessThan(posicionRappi)
  })

  test('el mismo archivo no se puede importar dos veces', async ({ page }) => {
    await page.goto('/ventas/importar')
    await page.getByTestId('archivo').setInputFiles(CSV)
    await page.getByRole('button', { name: 'Subir y revisar' }).click()

    await expect(page.getByTestId('error-subida')).toContainText('ya se importó')
  })

  test('un cliente no ve las importaciones de otro', async ({ browser }) => {
    const ctx = await browser.newContext()
    await entrarComo(ctx, USUARIOS.bistroSur)
    const pagina = await ctx.newPage()
    await pagina.goto('/ventas')
    await expect(pagina.getByText('ventas-ejemplo.csv')).toHaveCount(0)
    await pagina.goto('/dashboard')
    await expect(pagina.getByText('Todavía no hay ventas cargadas')).toBeVisible()
    await ctx.close()
  })
})
