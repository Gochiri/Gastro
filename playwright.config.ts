import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

/**
 * El entorno trae Chromium preinstalado en /opt/pw-browsers, que puede no
 * coincidir con el build que espera la versión de @playwright/test. Usarlo por
 * ruta evita descargar un navegador (bloqueado en CI y en el contenedor).
 * Si no está, se deja que Playwright resuelva su propio navegador.
 */
const CHROMIUM_LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const executablePath = existsSync(CHROMIUM_LOCAL) ? CHROMIUM_LOCAL : undefined

export default defineConfig({
  testDir: './e2e',
  // La prueba de humo necesita un build de producción corriendo, no `next dev`:
  // se ejecuta aparte, con `npm run test:humo`. Si corriera acá pasaría igual,
  // y esa es justamente la razón para excluirla — pasaría sin haber probado lo
  // que dice probar.
  testIgnore: '**/humo-produccion.spec.ts',
  // Un solo worker, no negociable: las suites comparten UNA base de datos y
  // varias la recrean en su beforeAll. `fullyParallel: false` solo serializa
  // los tests dentro de cada archivo; sin `workers: 1`, Playwright corre
  // archivos distintos en paralelo y dos procesos intentan crear la base a la
  // vez ("duplicate key ... pg_database_datname_index").
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
