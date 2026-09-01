import { entrarComo, listarUsuariosDev } from './acciones'

export default async function Login() {
  const usuarios = await listarUsuariosDev()

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Gestión gastronómica</h1>

      {usuarios.length === 0 ? (
        <p className="mt-6 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-600">
          El acceso de desarrollo está desactivado. En producción esta pantalla
          la reemplaza Supabase Auth.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-stone-600">
            Acceso de desarrollo. Elegí con qué usuario del seed entrar.
          </p>
          <ul className="mt-6 space-y-2">
            {usuarios.map((u) => (
              <li key={u.usuarioId}>
                <form action={entrarComo}>
                  <input type="hidden" name="usuarioId" value={u.usuarioId} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-stone-400"
                  >
                    <span className="font-medium">{u.organizacion}</span>
                    <span className="text-sm text-stone-500">{u.rol}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
