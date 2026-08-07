# Generador de contenido · Bendito Lab

App interna (no visible en la web pública) para generar copy de Instagram,
LinkedIn, WhatsApp y Stories a partir de una imagen de inspiración, usando
Gemini. Cubre las cuentas Bendito Lab (B2B) y Dilo Bonito (B2C).

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
  sugerencia de prompt y generación de copy (Gemini), CRUD de posts,
  inspiraciones y logos (Supabase).
- `lib/gemini-text.js`, `lib/bendito-prompts.js` — llamada a Gemini (texto +
  visión, JSON estructurado) y prompts de marca. Antes usaba Claude
  (`lib/anthropic.js`, eliminado) — se cambió a Gemini porque tiene nivel
  gratuito y Anthropic no.
- `lib/auth.js` — firma/verificación de tokens de sesión.
- `lib/rate-limit.js` — limitador de intentos de login (tabla
  `rate_limit_hits`, mismo proyecto Supabase que usa Bendito OS).
- `lib/gemini-image.js` — edición de imagen con IA (Gemini 2.5 Flash Image /
  "Nano Banana"): integra un logo, texto o dibujo de referencia sobre la
  imagen base de forma realista (no es un simple "pegado" en canvas).
- `lib/google-calendar.js` — sincroniza los posts con fecha de publicación
  con un **calendario de Google secundario** ("Redes sociales · Bendito
  Lab"), separado del calendario principal (`primary`) que usa
  `bendito-os` — reutiliza el mismo refresh_token ya guardado en la tabla
  `google_drive_auth`, no hace falta volver a autorizar nada aquí.
- `lib/pdf-post.js` — genera un PDF de una página por post (imagen + copy de
  cada canal) con `pdf-lib`.
- `lib/google-drive.js` — sube ese PDF a Google Drive, en
  `Contenido/Redes sociales` dentro de la misma carpeta raíz que usa
  `bendito-os` (la crea sola la primera vez). Mismo refresh_token que
  `lib/google-calendar.js`, no requiere autorización aparte.
- `supabase/schema.sql` — tablas `posts` e `inspirations` (las columnas
  `fecha_programada`, `gcal_id`, `variantes` y `prompt_edicion_externa` de
  `posts`, la tabla `logos`, la tabla `carpetas`, la tabla
  `configuracion_generador`, y la columna `redes_calendar_id` de
  `google_drive_auth` se añadieron después por migración directa en
  Supabase, no están en este archivo).

La pestaña "📅 Calendario" del panel muestra pendientes (imágenes sin copy,
posts sin fecha, posts con fecha pasada sin marcar publicados) y una
agenda de los posts programados. La pestaña "🖼️ Logos" es una librería de
logos reutilizables para elegir al editar una imagen con IA. La pestaña
"⚙️ Ajustes" permite editar la dirección creativa que se le pasa a la IA
en cada llamada (prompt, copy, edición de imagen), guardada en
`configuracion_generador` — si no hay nada guardado, se usa el valor por
defecto de `lib/bendito-prompts.js`.

## Variables de entorno (Vercel)

- `ADMIN_PASSWORD` — contraseña de acceso al panel.
- `ADMIN_SESSION_SECRET` — secreto para firmar los tokens de sesión.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — mismo proyecto Supabase
  que ya usan `bendito-os` y `bendito-lab-canva`.
- `GOOGLE_AI_API_KEY` — API key de Google AI Studio (aistudio.google.com),
  usada tanto para el texto (`lib/gemini-text.js`) como para la edición de
  imagen (`lib/gemini-image.js`). Tiene nivel gratuito con límite de
  peticiones por minuto/día.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — **los mismos valores que ya
  tiene `bendito-os`** en Vercel, para sincronizar con Google Calendar.
- Vercel Blob debe estar conectado al proyecto (Storage → Blob) para poder
  subir imágenes.

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
