import { redirect } from 'next/navigation'
import { usuarioActual } from '@/lib/sesion'
import { organizacionActiva } from '@/consultas/recetas'
import { unidadesDisponibles } from '@/consultas/widgets'
import { NavAsistente } from '../nav'
import { PanelRecetas } from './panel-recetas'

export default async function AsistenteRecetas() {
  const usuario = await usuarioActual()
  if (!usuario) redirect('/login')
  const organizacion = await organizacionActiva(usuario)
  if (!organizacion) redirect('/login')

  const unidades = await unidadesDisponibles(usuario)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Asistente</h1>
      <p className="mt-1 text-sm text-stone-600">
        Pegá una receta como la tengas escrita y quedará estructurada para
        costear.
      </p>
      <NavAsistente activa="/asistente/recetas" />

      <p className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
        El asistente <strong>transcribe, no cocina</strong>: no agrega
        ingredientes que no estén escritos ni estima cantidades que falten. Si
        el texto dice «sal a gusto», la línea queda sin cantidad y la completás
        vos. Un gramaje inventado se convierte en un costo inventado, y de ahí
        en un precio de venta mal calculado.
      </p>

      <PanelRecetas unidades={unidades} />
    </>
  )
}
