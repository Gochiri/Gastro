-- 0019_widgets_ia.sql
-- Registro de los cuatro widgets restantes.
--
-- El esfuerzo por widget no es un detalle de configuración: es plata. Un
-- widget de estrategia de carta se ejecuta una vez por período y justifica
-- pensar más; el asistente de escandallos se ejecuta cada vez que alguien pega
-- una receta y solo tiene que transcribir bien.

insert into widgets_ia (clave, nombre, descripcion, esfuerzo) values
  ('menu-engineering', 'Analista de menú',
   'Lee la matriz de menu engineering ya clasificada en SQL y recomienda qué hacer con cada plato.',
   'high'),
  ('detector-anomalias', 'Detector de anomalías',
   'Prioriza las señales detectadas por regla, explica causas posibles y dice cómo confirmarlas.',
   'medium'),
  ('ideas-rrss', 'Ideas para redes',
   'Plan semanal de contenido construido a partir de los platos que más margen dejan, no de los que más se venden.',
   'medium'),
  ('asistente-escandallos', 'Asistente de escandallos',
   'Convierte una receta en texto libre en un borrador de ficha técnica. No guarda nada sin confirmación.',
   'low')
on conflict (clave) do update
  set nombre      = excluded.nombre,
      descripcion = excluded.descripcion,
      esfuerzo    = excluded.esfuerzo;
