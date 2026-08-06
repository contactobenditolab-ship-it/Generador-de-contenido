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

-- RLS: todo el acceso pasa por /api/bendito.js (service role key, que
-- siempre salta RLS), así que se deja activado sin políticas públicas.
alter table posts enable row level security;
alter table inspirations enable row level security;
