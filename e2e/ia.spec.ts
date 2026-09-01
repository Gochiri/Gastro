import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { USUARIOS, entrarComo } from './sesion'

const RAIZ = path.resolve(__dirname, '..')

/**
 * El widget de IA, sin credenciales configuradas.
 *
 * Este contenedor no tiene ANTHROPIC_API_KEY, así que no se puede verificar
 * una respuesta real del modelo. Lo que sí se verifica —y es lo que importa
 * para no romper la confianza— es que el widget lo diga con claridad en vez de
 * fallar de forma opaca, y que la lógica de auditoría esté probada aparte en
 * tests/ia.test.mjs con un invocador simulado.
 */
test.describe('Explicador de resultados', () => {
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

  test('el widget aparece en el dashboard con sus sugerencias', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByTestId('pregunta')).toBeVisible()
    await expect(page.getByRole('button', { name: '¿Por qué mi food cost está donde está?' })).toBeVisible()
    await expect(page.getByText('No calcula nada por su cuenta')).toBeVisible()
  })

  test('sin credenciales lo dice claramente, no falla en silencio', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByTestId('pregunta').fill('¿Cómo viene el margen este mes?')
    await page.getByTestId('preguntar').click()
    await expect(page.getByTestId('error-ia')).toContainText('ANTHROPIC_API_KEY')
  })

  test('una pregunta demasiado corta se rechaza antes de gastar tokens', async ({ page }) => {
    await page.goto('/dashboard')
    // El textarea tiene minLength, así que el rechazo ocurre en el navegador.
    await page.getByTestId('pregunta').fill('hola')
    await page.getByTestId('preguntar').click()
    await expect(page.getByTestId('respuesta-ia')).toHaveCount(0)
  })
})
