-- 0010_ia.sql
-- Registro de los widgets de IA y de cada ejecución.
--
-- El log no es opcional: sin él no se puede saber cuánto gasta cada cliente en
-- tokens, qué widget aporta valor y cuáles respuestas citaron cifras que no
-- estaban en el contexto.

create table widgets_ia (
  clave       text primary key,
  nombre      text not null,
  descripcion text not null,
  modelo      text not null default 'claude-opus-5',
  esfuerzo    text not null default 'medium'
                check (esfuerzo in ('low','medium','high','xhigh','max')),
  activo      boolean not null default true
);

-- Datos de referencia, iguales para todos los clientes.
alter table widgets_ia enable row level security;
create policy widgets_lectura on widgets_ia for select using (true);

insert into widgets_ia (clave, nombre, descripcion, esfuerzo) values
  ('explicador-kpis', 'Explicador de resultados',
   'Responde preguntas en lenguaje natural sobre las métricas ya calculadas del período.',
   'medium');

create table ejecuciones_ia (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references organizaciones(id) on delete cascade,
  widget              text not null references widgets_ia(clave),
  usuario_id          uuid,
  pregunta            text not null,
  contexto            jsonb not null,
  respuesta           jsonb,
  -- Cifras que la respuesta citó y que NO estaban en el contexto. Debería
  -- quedar siempre vacío; una fila con contenido acá es un incidente.
  cifras_no_respaldadas jsonb not null default '[]'::jsonb,
  modelo              text,
  tokens_entrada      integer,
  tokens_salida       integer,
  tokens_cache_lectura integer,
  costo_usd           numeric(12,6),
  duracion_ms         integer,
  error               text,
  util                boolean,
  creada_en           timestamptz not null default now()
);
create index on ejecuciones_ia (organizacion_id, creada_en desc);
create index on ejecuciones_ia (widget);

comment on column ejecuciones_ia.contexto is
  'El panorama exacto que se le pasó al modelo. Guardarlo permite reproducir una respuesta y auditar de dónde salió cada número.';

comment on column ejecuciones_ia.cifras_no_respaldadas is
  'Números citados en la respuesta que no aparecen en el contexto. Vacío es lo normal; con contenido, la respuesta se muestra con advertencia.';

alter table ejecuciones_ia enable row level security;
alter table ejecuciones_ia force row level security;

create policy ejecuciones_lectura on ejecuciones_ia
  for select using (organizacion_id in (select app_organizaciones_del_usuario()));
create policy ejecuciones_escritura on ejecuciones_ia
  for all
  using      (organizacion_id in (select app_organizaciones_del_usuario()))
  with check (organizacion_id in (select app_organizaciones_del_usuario()));

-- Gasto acumulado por organización, para poder ponerle un tope.
create or replace view vista_gasto_ia
with (security_invoker = true)
as
select organizacion_id,
       date_trunc('month', creada_en)::date as mes,
       count(*)                             as ejecuciones,
       sum(coalesce(tokens_entrada, 0))     as tokens_entrada,
       sum(coalesce(tokens_salida, 0))      as tokens_salida,
       round(sum(coalesce(costo_usd, 0)), 4) as costo_usd,
       count(*) filter (where jsonb_array_length(cifras_no_respaldadas) > 0) as respuestas_con_cifras_sin_respaldo
from ejecuciones_ia
group by organizacion_id, date_trunc('month', creada_en);

grant select on vista_gasto_ia to public;
