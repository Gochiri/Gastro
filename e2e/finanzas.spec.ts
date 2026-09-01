import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')

test.describe('Cierre financiero', () => {
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

  // ORDEN IMPORTANTE: los tests de una misma suite comparten la base, y
  // Playwright los corre en orden de declaración. Primero van los que solo
  // leen; los que dan de alta o de baja gastos fijos van al final, porque
  // cambian el devengamiento del mes y con él todas las cifras de arriba.

  test('el EBITDA se muestra con su cascada completa', async ({ page }) => {
    await page.goto('/finanzas')

    // Verificados a mano en tests/finanzas.test.mjs.
    await expect(page.getByTestId('cifra-principal')).toHaveText('-$ 2.110.306,71')
    await expect(page.getByTestId('margen-contribucion')).toHaveText('$ 129.693,29')
    await expect(page.getByTestId('ebitda')).toHaveText('-$ 2.110.306,71')
    await expect(page.getByTestId('resultado')).toHaveText('-$ 2.360.306,71')
  })

  test('el EBITDA avisa que es un techo cuando hay ventas sin ficha técnica', async ({ page }) => {
    await page.goto('/finanzas')
    const aviso = page.getByTestId('aviso-techo-ebitda')
    await expect(aviso).toContainText('$ 57.800,00')
    await expect(aviso).toContainText('techo')
  })

  test('avisa que el mes tiene menos días de ventas que de estructura', async ({ page }) => {
    await page.goto('/finanzas')
    const aviso = page.getByTestId('aviso-calendario')
    await expect(aviso).toContainText('3 de los 28 días')
    await expect(aviso).toContainText('2026-02-05')
  })

  test('el punto de equilibrio dice cuánto falta vender', async ({ page }) => {
    await page.goto('/finanzas')
    await expect(page.getByTestId('ventas-equilibrio')).toHaveText('$ 8.896.558,95')
    await expect(page.getByTestId('ventas-reales')).toHaveText('$ 484.800,00')
    await expect(page.getByTestId('mc-pct')).toHaveText('26,8 %')
    await expect(page.getByTestId('gastos-caja')).toHaveText('$ 2.380.000,00')
    await expect(page.getByTestId('brecha')).toContainText('$ 8.411.758,95')
  })

  test('el reporte de IVA separa el débito del crédito por alícuota', async ({ page }) => {
    await page.goto('/finanzas/fiscal')

    await expect(page.getByTestId('iva-debito')).toHaveText('$ 84.138,84')
    await expect(page.getByTestId('iva-a-pagar')).toHaveText('$ 64.537,34')

    const tabla = page.getByTestId('tabla-iva')
    await expect(tabla.locator('tbody tr')).toHaveCount(2)
    // La alícuota reducida solo tiene crédito: se compra al 10,5 % y se vende
    // el plato terminado al 21 %.
    await expect(tabla.getByRole('row', { name: /10,5 %/ })).toContainText('$ 0,00')

    await expect(page.getByTestId('aviso-alcance')).toContainText('no la liquidación')
    await expect(page.getByTestId('aviso-credito-en-costo')).toContainText('food cost real')
  })

  test('el comparativo separa los gastos propios de los prorrateados', async ({ page }) => {
    await page.goto('/finanzas/sucursales')

    const palermo = page.getByTestId('fila-Sucursal Palermo')
    await expect(palermo).toContainText('sin ventas cargadas')
    // Carga con su alquiler y no recibe prorrateo.
    await expect(palermo).toContainText('$ 620.000,00')
    await expect(palermo).toContainText('-$ 620.000,00')

    // La suma de las filas es el EBITDA de la organización.
    await expect(page.getByTestId('ebitda-total')).toHaveText('-$ 2.110.306,71')
    await expect(page.getByTestId('nota-prorrateo')).toContainText('participación en las ventas')
  })

  test('una retención cargada descuenta de la posición del período', async ({ page }) => {
    await page.goto('/finanzas/fiscal')
    await expect(page.getByTestId('iva-a-pagar')).toHaveText('$ 64.537,34')

    await page.getByTestId('ret-fecha').fill('2026-02-04')
    await page.getByTestId('ret-tipo').selectOption('iva')
    await page.getByTestId('ret-contraparte').fill('PedidosYa')
    await page.getByTestId('ret-importe').fill('1537.34')
    await page.getByRole('button', { name: 'Registrar' }).click()

    await expect(page.getByTestId('tabla-retenciones')).toContainText('PedidosYa')
    await expect(page.getByTestId('iva-a-pagar')).toHaveText('$ 63.000,00')
  })

  test('un gasto fijo nuevo entra en el resultado del período', async ({ page }) => {
    await page.goto('/finanzas/gastos')
    await expect(page.getByTestId('total-mensual')).toHaveText('$ 2.490.000,00')

    // Vigente desde el 1 de febrero: el mes de cierre lo devenga entero.
    await page.getByTestId('gasto-concepto').fill('Sistema de gestión')
    await page.getByTestId('gasto-categoria').selectOption('licencias')
    await page.getByTestId('gasto-importe').fill('40000')
    await page.getByTestId('gasto-desde').fill('2026-02-01')
    await page.getByRole('button', { name: 'Agregar' }).click()

    await expect(page.getByTestId('total-mensual')).toHaveText('$ 2.530.000,00')
    await expect(
      page.getByTestId('tabla-gastos').getByRole('row', { name: /Sistema de gestión/ }),
    ).toContainText('$ 40.000,00')

    // 2.240.000 + 40.000 de la licencia nueva.
    await page.goto('/finanzas')
    await expect(page.getByTestId('ebitda')).toHaveText('-$ 2.150.306,71')
  })

  test('dar de baja un gasto cierra su vigencia en vez de borrarlo', async ({ page }) => {
    await page.goto('/finanzas/gastos')
    const fila = page
      .getByTestId('tabla-gastos')
      .getByRole('row', { name: /Alquiler Sucursal Palermo/ })
    await expect(fila).toContainText('vigente')

    await fila.getByRole('textbox', { name: /Fecha de baja/ }).fill('2026-02-14')
    await fila.getByRole('button', { name: 'Dar de baja' }).click()

    // Sigue en la lista con su vigencia cerrada: el histórico no se toca.
    await expect(fila).toContainText('2026-01-01 → 2026-02-14')
  })

  test('la contadora ve finanzas y el encargado de compras no puede tocarlas', async ({
    context,
    page,
  }) => {
    // luis@ tiene rol `compras`: la política de escritura de gastos_fijos no lo
    // incluye, así que el alta no debe dejar rastro.
    await entrarComo(context, USUARIOS.compras)
    await page.goto('/finanzas/gastos')

    await page.getByTestId('gasto-concepto').fill('Gasto no autorizado')
    await page.getByTestId('gasto-importe').fill('999999')
    await page.getByTestId('gasto-desde').fill('2026-02-01')
    await page.getByRole('button', { name: 'Agregar' }).click()

    // Y se entera de por qué: un rechazo de permisos no puede verse como una
    // pantalla de error del framework.
    await expect(page.getByTestId('aviso-permisos')).toContainText('no tiene permiso')
    await expect(page.getByTestId('tabla-gastos')).not.toContainText('Gasto no autorizado')
  })
})
