import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

/**
 * Cierra el circuito entre la base y la pantalla: los importes que muestra la
 * UI deben ser exactamente los que `supabase/tests/test_costeo.sql` contrasta
 * contra un cálculo manual independiente.
 *
 *   Lasaña (rinde 8) = $17.086,10  ->  por porción $2.135,76
 *
 * Si alguien rompe el costeo, o formatea mal, o mezcla monedas, esto falla.
 */
test.describe('Costeo de recetas en la interfaz', () => {
  test.beforeEach(async ({ context }) => {
    await entrarComo(context, USUARIOS.cantinaNorte)
  })

  test('la ficha de la Lasaña muestra los costos verificados a mano', async ({ page }) => {
    await page.goto('/recetas')
    await expect(page.getByTestId('organizacion')).toHaveText('Cantina Norte')

    await page.getByRole('link', { name: 'Lasaña' }).click()

    await expect(page.getByTestId('costo-total')).toHaveText('$ 17.086,10')
    await expect(page.getByTestId('costo-unitario')).toHaveText('$ 2.135,76')
  })

  test('el desglose explota las subrecetas hasta los insumos', async ({ page }) => {
    await page.goto('/recetas')
    await page.getByRole('link', { name: 'Lasaña' }).click()

    // La lasaña no lleva tomate directamente: llega por Ragú -> Salsa Pomodoro.
    // 2000 g netos x factor 0,25 / (1 - 0,10 de merma) = 555,56 g brutos.
    const fila = page.getByRole('row').filter({ hasText: 'Tomate perita' })
    await expect(fila).toContainText('555,56 g')

    // Ningún componente puede aparecer como subreceta en el desglose.
    await expect(page.getByTestId('desglose')).not.toContainText('Ragú')
  })

  test('los porcentajes del desglose suman aproximadamente 100', async ({ page }) => {
    await page.goto('/recetas')
    await page.getByRole('link', { name: 'Lasaña' }).click()
    // Sin esperar a la ficha, el locator leería todavía la tabla del listado.
    await expect(page.getByTestId('costo-total')).toBeVisible()

    const celdas = await page
      .getByTestId('desglose')
      .locator('tbody tr td:last-child')
      .allInnerTexts()
    const suma = celdas
      .map((t) => Number(t.replace(' %', '').replace(',', '.')))
      .reduce((a, b) => a + b, 0)
    expect(suma).toBeGreaterThan(99.5)
    expect(suma).toBeLessThan(100.5)
  })
})
