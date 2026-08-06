# Generador de contenido · Bendito Lab

App interna (no visible en la web pública) para generar copy de Instagram,
LinkedIn, WhatsApp y Stories a partir de una imagen de inspiración, usando
Claude. Cubre las cuentas Bendito Lab (B2B) y Dilo Bonito (B2C).

Extraída del panel "Redes sociales · Generador de contenido" que vivía en
`admin.html` del repo `bendito-lab-canva` — se mueve aquí para que la app
de gestión de contenido/IA no forme parte del sitio público, y quede
conectada a **Bendito OS** desde *Ajustes → Accesos externos*.

## Stack

Igual que `bendito-lab-canva`: HTML/JS estático servido por Vercel, con
funciones serverless en `api/` y Supabase como base de datos.

- `admin.html` — login + panel del generador (única página de la app).
- `api/auth.js` — login (password → token HMAC).
- `api/bendito.js` — endpoint único: subida de imágenes (Vercel Blob),
  sugerencia de prompt y generación de copy (Claude), CRUD de posts e
  inspiraciones (Supabase).
- `lib/anthropic.js`, `lib/bendito-prompts.js` — llamada a Claude y prompts
  de marca.
- `lib/auth.js` — firma/verificación de tokens de sesión.
- `lib/rate-limit.js` — limitador de intentos de login (tabla
  `rate_limit_hits`, mismo proyecto Supabase que usa Bendito OS).
- `supabase/schema.sql` — tablas `posts` e `inspirations`.

## Variables de entorno (Vercel)

- `ADMIN_PASSWORD` — contraseña de acceso al panel.
- `ADMIN_SESSION_SECRET` — secreto para firmar los tokens de sesión.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — mismo proyecto Supabase
  que ya usan `bendito-os` y `bendito-lab-canva`.
- `ANTHROPIC_API_KEY` — para generar el copy.
- Vercel Blob debe estar habilitado en el proyecto (subida de imágenes).

## Pendiente / fuera de alcance de esta primera versión

El generador original tenía un checkbox "también subir esta imagen a la
página web", que escribía directamente en un slot de imagen del sitio
público (`IMG_GROUPS` + `/api/upload-image` de `bendito-lab-canva`). Se
quitó al mover la app aquí porque acoplaba este repo interno con el
público. Si hace falta recuperarlo, lo más limpio es que este repo llame
a la API pública de `bendito-lab-canva` (URL configurable), en vez de
compartir código entre los dos repos.

## Conexión desde Bendito OS

`bendito-os` enlaza a esta app desde *Ajustes → Accesos externos*
(`src/app/configuracion/page.tsx`). Actualiza esa URL cuando el proyecto
tenga dominio de despliegue definitivo.
