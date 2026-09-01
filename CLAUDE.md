# CLAUDE.md

Sistema de gestión gastronómica: SaaS multi-negocio para restaurantes de LATAM.

@AGENTS.md

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind
- PostgreSQL 16, en producción sobre Supabase
- Acceso a datos: `pg` directo desde Server Components. **No** se usa
  `@supabase/supabase-js` para datos (ver README, sección Decisiones).

## Reglas siempre activas

Ver `.claude/rules/`: convenciones de `common/`, `typescript/` y `react/`
(origen: proyecto ECC). En resumen, lo que más se incumple:

- Tipos explícitos en funciones exportadas. Nada de `any`; `unknown` + estrechado
  para entrada externa.
- Derivar en el render, no guardar estado derivado en `useEffect`.
- Server Components por defecto; `'use client'` solo donde hace falta
  interactividad.
- E2E con Playwright para los flujos críticos.

## Reglas propias, no negociables

1. **Toda tabla con `organizacion_id` lleva RLS activado y forzado.**
   `supabase/tests/test_rls_estructura.sql` falla si alguna no lo tiene.
2. **Las vistas se crean con `security_invoker = true`.** Por defecto una vista
   corre con permisos de su dueño y hace bypass de RLS.
3. **El acceso a la base pasa siempre por `withTenant()` de `lib/db.ts`.**
   Ningún otro archivo abre conexiones. El contexto de tenant es transaccional:
   un `set_config` de sesión filtraría la identidad entre peticiones del pool.
4. **La app nunca se conecta como superusuario ni con `service_role`:** esos
   roles ignoran RLS.
5. **Los importes son `numeric`, nunca `float`.**
6. **Ningún cálculo de costos o KPIs se hace en JavaScript.** Vive en SQL, donde
   está probado contra cálculo manual.

## Comandos

```bash
./scripts/db.sh reset   # recrear base local con migraciones y seed
./scripts/test.sh       # suite SQL (RLS + costeo)
npm run dev             # app en desarrollo
npx playwright test     # E2E
```

## Next.js 16: diferencias que rompen

- El middleware es `proxy.ts`, **no** `middleware.ts`.
- `params` y `searchParams` son promesas: hay que `await`.
- `cookies()` de `next/headers` es asíncrono.
- Ante la duda, la fuente es `node_modules/next/dist/docs/`, no la memoria.
