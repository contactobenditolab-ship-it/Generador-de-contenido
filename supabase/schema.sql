-- Ejecuta esto en Supabase → SQL Editor (mismo proyecto que ya usa /admin
-- para precios_portal, calc_precios, contenido_web). Crea las tablas para
-- /bendito-app: generador de contenido con IA para Bendito Lab y Dilo Bonito.

create extension if not exists "pgcrypto";

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  cuenta text not null check (cuenta in ('bendito_lab','dilobonito')),
  handle text not null,
  sub text,
  image_url text not null,
  ig_caption text,
  ig_hashtags text,
  li_name text,
  li_role text,
  li_caption text,
  li_hashtags text,
  wa_text text,
  stories_text text,
  fecha text,
  publicado boolean not null default false,
  carpeta text,
  fecha_programada date,
  gcal_id text,
  created_at timestamptz not null default now()
);

create table if not exists inspirations (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  prompt text,
  used boolean not null default false,
  drive_uploaded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists logos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  image_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists carpetas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

-- RLS: todo el acceso pasa por /api/bendito.js (service role key, que
-- siempre salta RLS), así que se deja activado sin políticas públicas.
alter table posts enable row level security;
alter table inspirations enable row level security;
alter table logos enable row level security;
alter table carpetas enable row level security;

-- Bucket de imágenes (inspiraciones, logos, posts editados). Antes se subía
-- a Vercel Blob (put() en api/bendito.js) — se migró a Supabase Storage
-- porque el store de Blob del equipo se quedó suspendido (cupo de
-- "Advanced Operations" agotado por otro proyecto que comparte la misma
-- cuenta de Vercel, ver bendito-lab-canva/lib/content-store.js) y empezó a
-- devolver 403 tanto en lecturas como en escrituras nuevas, para todos los
-- proyectos que usaban ese store.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generador-imagenes', 'generador-imagenes', true, 4194304, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;
