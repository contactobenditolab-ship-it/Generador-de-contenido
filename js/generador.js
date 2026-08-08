// js/generador.js — Generador de contenido con IA (Bendito Lab / Dilo
// Bonito): pestañas, generador, feed de posts y galería de inspiración.
// Extraído de bendito-lab-canva (js/bendito-app-1.js). Vanilla JS, usa
// BL_API.bendito* (js/bl-api.js) para hablar con /api/bendito.
//
// Nota: la función "también subir esta imagen a la página web" del
// original se quitó aquí a propósito — dependía de IMG_GROUPS y
// /api/upload-image del repo bendito-lab-canva. Si se necesita, hay que
// traer esa parte de vuelta apuntando a la API de ese repo.
(function () {
  'use strict';

  var state = {
    loaded: false,
    imageInfo: null,   // { base64, mediaType, dataUrl }
    imageUrl: null,
    inspirationId: null,
    genResult: null,
    logoInfo: null,     // { dataUrl } de la imagen de referencia (logo/texto/dibujo), sin subir todavía
    iaEditedInfo: null, // { base64, mediaType, dataUrl } de la imagen ya editada con IA, lista para guardar
    resultadosExternos: [], // [{ base64, mediaType, dataUrl }] resultados subidos manualmente, para elegir cuál usar
    allPosts: [],
    allInspirations: [],
    allLogos: [],
    allCarpetas: [],
    folderFilter: '',
    editandoCarpetas: false,
    editingPostId: null, // si se está reeditando la imagen de un post ya guardado (en vez de crear uno nuevo)
  };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── TABS ───────────────────────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.rs-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.rsTab === tab);
    });
    document.querySelectorAll('.rs-panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.rsPanel === tab);
    });
    el('rs-folder-bar').style.display = (tab === 'ig' || tab === 'li' || tab === 'wa') ? 'flex' : 'none';
  }

  function ensureLoaded() {
    if (state.loaded) return;
    state.loaded = true;
    loadFeeds();
    loadGallery();
    loadLogos();
    loadCarpetas();
    loadAjustes();
    loadPinterestEstado();
  }

  // ── FEEDS (IG / LI / WA) ──────────────────────────────
  async function loadFeeds() {
    ['ig', 'li', 'wa'].forEach(function (ch) {
      el('rs-feed-' + ch).innerHTML = '<p class="rs-feed-empty">Cargando…</p>';
    });
    try {
      var d = await BL_API.benditoGet('posts');
      state.allPosts = d.data || [];
    } catch (e) {
      ['ig', 'li', 'wa'].forEach(function (ch) {
        el('rs-feed-' + ch).innerHTML = '<p class="rs-feed-empty">Error cargando publicaciones: ' + esc(e.message) + '</p>';
      });
      return;
    }
    renderFolderFilter();
    renderAllFeeds();
    renderCalendario();
  }

  function renderFolderFilter() {
    var carpetas = [];
    state.allPosts.forEach(function (p) {
      if (p.carpeta && carpetas.indexOf(p.carpeta) === -1) carpetas.push(p.carpeta);
    });
    carpetas.sort();

    var select = el('rs-folder-filter');
    var prev = state.folderFilter;
    select.innerHTML = '<option value="">Todas las carpetas</option>' +
      carpetas.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    select.value = carpetas.indexOf(prev) !== -1 ? prev : '';
    state.folderFilter = select.value;
  }

  function renderAllFeeds() {
    var posts = state.folderFilter
      ? state.allPosts.filter(function (p) { return p.carpeta === state.folderFilter; })
      : state.allPosts;
    ['ig', 'li', 'wa'].forEach(function (ch) { renderFeed(ch, posts); });
  }

  function renderFeed(channel, posts) {
    var box = el('rs-feed-' + channel);
    if (!posts.length) {
      box.innerHTML = '<p class="rs-feed-empty">Todavía no hay publicaciones guardadas.</p>';
      return;
    }
    box.innerHTML = posts.map(function (p) { return postCardHtml(channel, p); }).join('');
    box.querySelectorAll('[data-del-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { deletePost(btn.dataset.delId); });
    });
    box.querySelectorAll('[data-copy-text]').forEach(function (btn) {
      btn.addEventListener('click', function () { copyToClipboard(btn.dataset.copyText, btn); });
    });
    box.querySelectorAll('[data-publish-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePublicado(btn.dataset.publishId, btn.dataset.publicado !== 'true'); });
    });
    box.querySelectorAll('[data-editar-post-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { editarPostImagenEnGenerador(btn.dataset.editarPostId); });
    });
    box.querySelectorAll('[data-toggle-variantes-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        el('rs-post-variantes-strip-' + btn.dataset.toggleVariantesId).classList.toggle('open');
      });
    });
    box.querySelectorAll('[data-usar-variante-url]').forEach(function (img) {
      img.addEventListener('click', function () { usarVarianteComoPortada(img.dataset.usarVarianteId, img.dataset.usarVarianteUrl); });
    });
    box.querySelectorAll('[data-abrir-ficha-id]').forEach(function (img) {
      img.addEventListener('click', function () { abrirPostModal(img.dataset.abrirFichaId); });
    });
  }

  async function editarPostImagenEnGenerador(id) {
    var post = state.allPosts.find(function (p) { return p.id === id; });
    if (!post) return;
    switchTab('ai');
    setGenStatus('Cargando imagen del post…');
    try {
      var info = await urlToBase64(post.image_url);
      state.imageInfo = info;
      state.imageUrl = post.image_url;
      state.inspirationId = null;
      state.genResult = null;
      state.editingPostId = post.id;
      el('rs-gen-preview').src = info.dataUrl;
      el('rs-gen-preview').style.display = 'block';
      el('rs-gen-prompt').value = post.sub || '';
      el('rs-gen-ficha').style.display = 'none';
      el('rs-gen-result').style.display = 'none';
      el('rs-gen-cuenta').value = post.cuenta;
      if (window.actualizarFavicon) window.actualizarFavicon(post.cuenta);
      el('rs-gen-carpeta').value = post.carpeta || '';
      el('rs-gen-fecha').value = post.fecha_programada || '';
      el('rs-gen-blocks').innerHTML = '<p class="rs-feed-empty">Editando solo la imagen — el copy actual del post no cambia salvo que pulses "Generar con IA" otra vez.</p>';
      el('rs-gen-result').style.display = 'block';
      renderVariantesPost();
      if (post.prompt_edicion_externa) {
        el('rs-gen-prompt-ext-texto').textContent = post.prompt_edicion_externa;
        el('rs-gen-prompt-ext-box').style.display = 'block';
      }
      setGenStatus('✓ Editando la imagen de un post existente — usa "🪄 Editar con IA" abajo y luego guarda para actualizarlo.');
    } catch (e) {
      setGenStatus('Error cargando la imagen: ' + e.message);
    }
  }

  function renderVariantesPost() {
    var box = el('rs-post-variantes-box');
    var grid = el('rs-post-variantes-grid');
    if (!state.editingPostId) { box.style.display = 'none'; return; }
    var post = state.allPosts.find(function (p) { return p.id === state.editingPostId; });
    if (!post) { box.style.display = 'none'; return; }

    var todas = [post.image_url].concat(Array.isArray(post.variantes) ? post.variantes : []);
    grid.innerHTML = todas.map(function (url) {
      var sel = url === state.imageUrl;
      return '<div class="rs-gallery-item' + (sel ? '' : '') + '" style="' + (sel ? 'outline:3px solid var(--blue);' : '') + '">' +
        '<img src="' + esc(url) + '" data-variante-url="' + esc(url) + '">' +
        (url !== post.image_url ? '<div class="rs-gallery-actions" style="left:auto;right:4px;"><button data-quitar-variante-url="' + esc(url) + '" title="Quitar variante">×</button></div>' : '') +
        '</div>';
    }).join('');
    grid.querySelectorAll('[data-variante-url]').forEach(function (img) {
      img.addEventListener('click', function () { seleccionarVariante(img.dataset.varianteUrl); });
    });
    grid.querySelectorAll('[data-quitar-variante-url]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); quitarVariante(btn.dataset.quitarVarianteUrl); });
    });
    box.style.display = 'block';
  }

  async function seleccionarVariante(url) {
    setGenStatus('Cargando variante…');
    try {
      var info = await urlToBase64(url);
      state.imageInfo = info;
      state.imageUrl = url;
      el('rs-gen-preview').src = info.dataUrl;
      el('rs-gen-preview').style.display = 'block';
      renderVariantesPost();
      setGenStatus('✓ Variante cargada como base — genera el prompt o edita con IA si quieres.');
    } catch (e) {
      setGenStatus('Error cargando la variante: ' + e.message);
    }
  }

  async function handleAgregarVariantePost(e) {
    var file = e.target.files && e.target.files[0];
    if (!file || !state.editingPostId) return;
    setGenStatus('Subiendo variante…');
    try {
      var info = await fileToBase64(file);
      var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: info.base64, mediaType: info.mediaType, filename: 'variante' });
      var res = await BL_API.benditoPost({ accion: 'agregarVariante', id: state.editingPostId, image_url: up.url });
      var post = state.allPosts.find(function (p) { return p.id === state.editingPostId; });
      if (post) post.variantes = res.data.variantes;
      el('rs-post-variante-file').value = '';
      renderVariantesPost();
      setGenStatus('✓ Variante añadida.');
    } catch (err) {
      setGenStatus('Error subiendo la variante: ' + err.message);
    }
  }

  async function quitarVariante(url) {
    if (!state.editingPostId) return;
    if (!confirm('¿Quitar esta variante del post?')) return;
    try {
      var res = await BL_API.benditoPost({ accion: 'eliminarVariante', id: state.editingPostId, image_url: url });
      var post = state.allPosts.find(function (p) { return p.id === state.editingPostId; });
      if (post) post.variantes = res.data.variantes;
      renderVariantesPost();
    } catch (e) {
      alert('Error al quitar la variante: ' + e.message);
    }
  }

  function metaRowHtml(p) {
    var publicado = !!p.publicado;
    return '<div class="rs-post-meta">' +
      (p.carpeta ? '<span class="rs-folder-badge">' + esc(p.carpeta) + '</span>' : '') +
      '<button class="rs-publish-toggle' + (publicado ? ' on' : '') + '" data-publish-id="' + p.id + '" data-publicado="' + publicado + '">' +
      (publicado ? '✓ Publicado' : 'Marcar como publicado') + '</button>' +
      '</div>';
  }

  var SHAPE_BY_CHANNEL = { ig: 'shape-circle', li: 'shape-square', wa: 'shape-triangle' };
  var SHADOW_BY_CHANNEL = { ig: 'shadow-hard-blue', li: 'shadow-hard-red', wa: 'shadow-hard-yellow' };

  function variantesStripHtml(p) {
    var variantes = Array.isArray(p.variantes) ? p.variantes : [];
    if (!variantes.length) return '';
    var todas = [p.image_url].concat(variantes);
    return '<button class="rs-post-variantes-toggle" data-toggle-variantes-id="' + p.id + '">🖼️ Variantes (' + todas.length + ')</button>' +
      '<div class="rs-post-variantes-strip" id="rs-post-variantes-strip-' + p.id + '">' +
      todas.map(function (url) {
        return '<img src="' + esc(url) + '" class="' + (url === p.image_url ? 'actual' : '') + '" data-usar-variante-id="' + p.id + '" data-usar-variante-url="' + esc(url) + '">';
      }).join('') + '</div>';
  }

  function fichaVariantesHtml(p) {
    var variantes = Array.isArray(p.variantes) ? p.variantes : [];
    if (!variantes.length) return '';
    var todas = [p.image_url].concat(variantes);
    return '<p style="font-size:12px;font-weight:800;color:#999;margin:10px 0 2px;">IMÁGENES GUARDADAS (' + todas.length + ')</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
      todas.map(function (url) {
        return '<img src="' + esc(url) + '" style="width:44px;height:44px;object-fit:cover;border:2px solid var(--ink);' + (url === p.image_url ? 'outline:3px solid var(--blue);' : '') + 'cursor:pointer;" data-usar-variante-id="' + p.id + '" data-usar-variante-url="' + esc(url) + '">';
      }).join('') + '</div>';
  }

  // El "ojo" de Bendito Lab como icono de cuenta: azul para Bendito Lab, amarillo para Dilo Bonito.
  // El "ojo" de Bendito Lab con rayos, como icono de cuenta: azul para
  // Bendito Lab, amarillo para Dilo Bonito. No hay un SVG de este diseño
  // en los repos (solo se pasó como imagen), así que está recreado a mano
  // — mismo estilo (ojo almendrado + pupila con dos brillos + rayos
  // radiales de longitud alterna).
  var OJO_RAYOS_CACHE = {};
  function construirRayosOjo() {
    var rayos = '';
    var n = 16;
    for (var i = 0; i < n; i++) {
      var angulo = (Math.PI * 2 * i) / n;
      var largo = i % 2 === 0 ? 13 : 8;
      var rInterno = 15;
      var rExterno = rInterno + largo;
      var x1 = 32 + Math.cos(angulo) * rInterno;
      var y1 = 32 + Math.sin(angulo) * rInterno;
      var x2 = 32 + Math.cos(angulo) * rExterno;
      var y2 = 32 + Math.sin(angulo) * rExterno;
      rayos += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
    }
    return rayos;
  }

  function ojoLogoHtml(cuenta) {
    var color = cuenta === 'dilobonito' ? 'var(--yellow)' : 'var(--blue)';
    if (!OJO_RAYOS_CACHE.svg) OJO_RAYOS_CACHE.svg = construirRayosOjo();
    return '<svg viewBox="0 0 64 64" width="20" height="20" style="color:' + color + ';flex-shrink:0;">' +
      OJO_RAYOS_CACHE.svg +
      '<path d="M14 32C20 24 26 20 32 20S44 24 50 32C44 40 38 44 32 44S20 40 14 32Z" fill="#fff" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>' +
      '<circle cx="32" cy="32" r="8" fill="currentColor"/>' +
      '<circle cx="34.5" cy="29" r="2.2" fill="#fff"/>' +
      '<circle cx="30.5" cy="32.5" r="1" fill="#fff"/>' +
      '</svg>';
  }

  function postCardHtml(channel, p) {
    var del = '<button class="rs-post-del" data-del-id="' + p.id + '">×</button>' +
      '<button class="rs-post-del" style="right:38px;" data-editar-post-id="' + p.id + '" title="Editar imagen con IA">✎</button>';
    if (channel === 'wa') {
      return '<div class="rs-post-card ' + SHADOW_BY_CHANNEL[channel] + '">' + del +
        '<div class="rs-wa-head" style="display:flex;align-items:center;gap:8px;">' + ojoLogoHtml(p.cuenta) + esc(p.handle) + ' · Canal de difusión</div>' +
        '<div class="rs-wa-wrap"><div class="rs-wa-bubble">' +
        '<img src="' + esc(p.image_url) + '" data-abrir-ficha-id="' + p.id + '" style="cursor:pointer;">' +
        '<p>' + esc(p.wa_text || '(sin copy de WhatsApp)') + '</p>' +
        '</div></div>' +
        '<div class="rs-post-copy-row"><button class="rs-copy-btn" data-copy-text="' + esc(p.wa_text || '') + '">Copiar copy</button></div>' +
        metaRowHtml(p) + variantesStripHtml(p) +
        '</div>';
    }
    var isIg = channel === 'ig';
    var caption = isIg ? p.ig_caption : p.li_caption;
    var hashtags = isIg ? p.ig_hashtags : p.li_hashtags;
    var name = isIg ? p.handle : p.li_name;
    var full = (caption || '') + '\n\n' + (hashtags || '');
    return '<div class="rs-post-card ' + SHADOW_BY_CHANNEL[channel] + '">' + del +
      '<div class="rs-post-head">' + ojoLogoHtml(p.cuenta) + '<span class="' + SHAPE_BY_CHANNEL[channel] + '"></span>' + esc(name) + '</div>' +
      '<img class="rs-post-img" src="' + esc(p.image_url) + '" data-abrir-ficha-id="' + p.id + '" style="cursor:pointer;">' +
      '<div class="rs-post-body"><p>' + esc(caption) + '</p><p class="rs-post-tags">' + esc(hashtags) + '</p></div>' +
      '<div class="rs-post-copy-row"><button class="rs-copy-btn" data-copy-text="' + esc(full) + '">Copiar copy</button></div>' +
      metaRowHtml(p) + variantesStripHtml(p) +
      '</div>';
  }

  async function usarVarianteComoPortada(id, url) {
    try {
      var res = await BL_API.benditoPost({ accion: 'actualizarPost', id: id, image_url: url });
      var idx = state.allPosts.findIndex(function (p) { return p.id === id; });
      if (idx !== -1) state.allPosts[idx] = res.data;
      renderAllFeeds();
    } catch (e) {
      alert('Error al cambiar la imagen: ' + e.message);
    }
  }

  async function deletePost(id) {
    if (!confirm('¿Eliminar esta publicación?')) return;
    try {
      await BL_API.benditoPost({ accion: 'eliminarPost', id: id });
      loadFeeds();
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  }

  async function togglePublicado(id, publicado) {
    try {
      await BL_API.benditoPost({ accion: 'actualizarPost', id: id, publicado: publicado });
      var p = state.allPosts.find(function (x) { return x.id === id; });
      if (p) p.publicado = publicado;
      renderAllFeeds();
      renderCalendario();
    } catch (e) {
      alert('Error al actualizar: ' + e.message);
    }
  }

  async function asignarFecha(id, fecha) {
    if (!fecha) return;
    try {
      var res = await BL_API.benditoPost({ accion: 'actualizarPost', id: id, fecha_programada: fecha });
      var p = state.allPosts.find(function (x) { return x.id === id; });
      if (p) { p.fecha_programada = res.data.fecha_programada; p.gcal_id = res.data.gcal_id; }
      renderCalendario();
    } catch (e) {
      alert('Error asignando la fecha: ' + e.message);
    }
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = '✓ Copiado';
      setTimeout(function () { btn.classList.remove('copied'); btn.textContent = orig; }, 1500);
    }).catch(function () {});
  }

  // ── GALLERY ────────────────────────────────────────────
  async function loadGallery() {
    var box = el('rs-gallery');
    var items;
    try {
      var d = await BL_API.benditoGet('inspirations');
      items = d.data || [];
      state.allInspirations = items;
    } catch (e) {
      box.innerHTML = '<p class="rs-feed-empty">Error cargando inspiración: ' + esc(e.message) + '</p>';
      return;
    }
    if (!items.length) {
      box.innerHTML = '<p class="rs-feed-empty">Sube tu primera imagen desde el Generador IA.</p>';
    } else {
      box.innerHTML = '<p class="rs-gallery-hint">✓ verde = ya usada para un post</p><div class="rs-gallery-grid">' +
        items.map(function (i) {
          return '<div class="rs-gallery-item"><img src="' + esc(i.image_url) + '">' +
            (i.used ? '<span class="rs-gallery-used">✓</span>' : '') +
            '<div class="rs-gallery-actions">' +
            '<button data-descargar-insp-url="' + esc(i.image_url) + '" title="Descargar en calidad original">⬇</button>' +
            '<button data-editar-insp-id="' + i.id + '" title="Editar en el Generador IA">✎</button>' +
            '<button data-del-insp-id="' + i.id + '" title="Eliminar">×</button>' +
            '</div></div>';
        }).join('') + '</div>';
      box.querySelectorAll('[data-del-insp-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { eliminarInspiracion(btn.dataset.delInspId); });
      });
      box.querySelectorAll('[data-editar-insp-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { editarInspiracionEnGenerador(btn.dataset.editarInspId); });
      });
      box.querySelectorAll('[data-descargar-insp-url]').forEach(function (btn) {
        btn.addEventListener('click', function () { descargarImagenOriginal(btn.dataset.descargarInspUrl); });
      });
    }
    renderCalendario();
  }

  /** Descarga la imagen en su calidad/resolución original (no la miniatura que se ve en pantalla). */
  async function descargarImagenOriginal(url) {
    try {
      var res = await fetch(url);
      var blob = await res.blob();
      var nombre = url.split('/').pop().split('?')[0] || 'imagen';

      // Móvil: si el navegador soporta compartir archivos, se abre la
      // ventana nativa de "Compartir" — ahí el usuario elige "Guardar en
      // Fotos"/"Guardar imagen", que sí escribe en el carrete. Un simple
      // <a download> desde la web NO puede escribir en el carrete
      // directamente (restricción del navegador), solo va a Descargas.
      var file = new File([blob], nombre, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }

      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 5000);
    } catch (e) {
      if (e.name === 'AbortError') return; // el usuario canceló el share sheet, no es un error real
      alert('Error al descargar: ' + e.message);
    }
  }

  // ── PNG a 300ppp ───────────────────────────────────────
  var CRC_TABLE = (function () {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function u32(n) { return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF]; }

  /** Inserta (o sustituye) el chunk pHYs de un PNG para que quede marcado a 300ppp — necesario para imprenta, no cambia los píxeles reales. */
  function pngA300ppp(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var PNG_SIG_LEN = 8;
    var pixelsPorMetro = Math.round(300 / 0.0254); // 300ppp -> px/m
    var chunkData = new Uint8Array(9);
    chunkData.set(u32(pixelsPorMetro), 0);
    chunkData.set(u32(pixelsPorMetro), 4);
    chunkData[8] = 1; // unidad: metro
    var typeAndData = new Uint8Array(4 + 9);
    typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // "pHYs"
    typeAndData.set(chunkData, 4);
    var crc = crc32(typeAndData);
    var physChunk = new Uint8Array(4 + 4 + 9 + 4);
    physChunk.set(u32(9), 0);
    physChunk.set(typeAndData, 4);
    physChunk.set(u32(crc), 4 + typeAndData.length);

    // El primer chunk siempre es IHDR (13 bytes de datos), justo tras la firma.
    var ihdrLen = (bytes[PNG_SIG_LEN] << 24) | (bytes[PNG_SIG_LEN + 1] << 16) | (bytes[PNG_SIG_LEN + 2] << 8) | bytes[PNG_SIG_LEN + 3];
    var afterIhdr = PNG_SIG_LEN + 4 + 4 + ihdrLen + 4;

    var siguienteEsPhys = bytes[afterIhdr + 4] === 0x70 && bytes[afterIhdr + 5] === 0x48 && bytes[afterIhdr + 6] === 0x59 && bytes[afterIhdr + 7] === 0x73;
    if (siguienteEsPhys) {
      var largoExistente = (bytes[afterIhdr] << 24) | (bytes[afterIhdr + 1] << 16) | (bytes[afterIhdr + 2] << 8) | bytes[afterIhdr + 3];
      var finExistente = afterIhdr + 4 + 4 + largoExistente + 4;
      var out = new Uint8Array(bytes.length - (finExistente - afterIhdr) + physChunk.length);
      out.set(bytes.subarray(0, afterIhdr), 0);
      out.set(physChunk, afterIhdr);
      out.set(bytes.subarray(finExistente), afterIhdr + physChunk.length);
      return out.buffer;
    }
    var out2 = new Uint8Array(bytes.length + physChunk.length);
    out2.set(bytes.subarray(0, afterIhdr), 0);
    out2.set(physChunk, afterIhdr);
    out2.set(bytes.subarray(afterIhdr), afterIhdr + physChunk.length);
    return out2.buffer;
  }

  async function descargarLogo(url, nombre) {
    try {
      var res = await fetch(url);
      var buffer = await res.arrayBuffer();
      var esPng = (res.headers.get('content-type') || '').indexOf('png') !== -1 || url.split('?')[0].toLowerCase().endsWith('.png');
      var finalBuffer = esPng ? pngA300ppp(buffer) : buffer;
      var blob = new Blob([finalBuffer], { type: esPng ? 'image/png' : (res.headers.get('content-type') || 'image/png') });
      var filename = (nombre || 'logo').replace(/[^a-zA-Z0-9_-]+/g, '_') + (esPng ? '.png' : '');

      var file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }

      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 5000);
    } catch (e) {
      if (e.name === 'AbortError') return;
      alert('Error al descargar el logo: ' + e.message);
    }
  }

  async function hashArchivo(file) {
    var buffer = await file.arrayBuffer();
    var digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.prototype.map.call(new Uint8Array(digest), function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  async function handleBulkUpload(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    var statusEl = el('insp-bulk-status');
    var subidas = 0;
    var duplicadas = 0;
    var hashesEnEsteLote = {};
    for (var i = 0; i < files.length; i++) {
      statusEl.textContent = 'Subiendo ' + (i + 1) + ' de ' + files.length + '…';
      try {
        var hash = await hashArchivo(files[i]);
        if (hashesEnEsteLote[hash]) { duplicadas++; continue; }
        var existente = await BL_API.benditoPost({ accion: 'buscarInspiracionPorHash', image_hash: hash });
        if (existente.existe) { duplicadas++; hashesEnEsteLote[hash] = true; continue; }
        hashesEnEsteLote[hash] = true;

        var info = await fileToBase64(files[i]);
        var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: info.base64, mediaType: info.mediaType, filename: 'pinterest' });
        var res = await BL_API.benditoPost({ accion: 'crearInspiracion', image_url: up.url, image_hash: hash });
        if (res.duplicado) duplicadas++; else subidas++;
      } catch (err) {
        statusEl.textContent = 'Error subiendo "' + files[i].name + '": ' + err.message;
      }
    }
    statusEl.textContent = '✓ ' + subidas + ' guardada(s)' + (duplicadas ? ', ' + duplicadas + ' ya existían (omitida' + (duplicadas === 1 ? '' : 's') + ')' : '') + '.';
    el('insp-bulk-file').value = '';
    loadGallery();
  }

  async function handleAgregarInspiracionPorUrl() {
    var input = el('insp-url');
    var url = input.value.trim();
    if (!url) return;
    var btn = el('insp-url-btn');
    var statusEl = el('insp-url-status');
    btn.disabled = true;
    statusEl.textContent = 'Descargando imagen…';
    try {
      var res = await BL_API.benditoPost({ accion: 'crearInspiracionDesdeUrl', url: url });
      if (res.duplicado) {
        statusEl.textContent = 'Esa imagen ya estaba guardada en Inspiración — no se duplica.';
      } else {
        statusEl.textContent = '✓ Imagen añadida a Inspiración.';
        input.value = '';
      }
      loadGallery();
    } catch (e) {
      statusEl.textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function eliminarInspiracion(id) {
    if (!confirm('¿Eliminar esta imagen de inspiración? No se puede deshacer.')) return;
    try {
      await BL_API.benditoPost({ accion: 'eliminarInspiracion', id: id });
      loadGallery();
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  }

  async function urlToBase64(url) {
    var res = await fetch(url);
    var blob = await res.blob();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        resolve({ base64: dataUrl.split(',')[1], mediaType: blob.type || 'image/png', dataUrl: dataUrl });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function editarInspiracionEnGenerador(id) {
    var insp = state.allInspirations.find(function (i) { return i.id === id; });
    if (!insp) return;
    switchTab('ai');
    setGenStatus('Cargando imagen…');
    try {
      var info = await urlToBase64(insp.image_url);
      state.imageInfo = info;
      state.imageUrl = insp.image_url;
      state.inspirationId = insp.id;
      state.genResult = null;
      state.editingPostId = null;
      el('rs-post-variantes-box').style.display = 'none';
      el('rs-gen-preview').src = info.dataUrl;
      el('rs-gen-preview').style.display = 'block';
      el('rs-gen-prompt').value = insp.prompt || '';
      el('rs-gen-ficha').style.display = 'none';
      el('rs-gen-result').style.display = 'none';
      if (insp.prompt_edicion_externa) {
        el('rs-gen-prompt-ext-texto').textContent = insp.prompt_edicion_externa;
        el('rs-gen-prompt-ext-box').style.display = 'block';
      }
      if (insp.prompt) {
        setGenStatus('✓ Imagen cargada — revisa el prompt.');
      } else {
        // Las imágenes subidas por lotes (Inspiración → Subir varias
        // imágenes) se guardan sin analizar — se genera ahora, sin tener
        // que volver a subir el archivo.
        await analizarImagenActual();
      }
    } catch (e) {
      setGenStatus('Error cargando la imagen: ' + e.message);
    }
  }

  // ── CALENDARIO ─────────────────────────────────────────
  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderCalendario() {
    var pendBox = el('cal-pendientes');
    var agBox = el('cal-agenda');
    if (!pendBox || !agBox) return;

    var hoy = hoyISO();
    var sinCopy = state.allInspirations.filter(function (i) { return !i.used; });
    var sinFecha = state.allPosts.filter(function (p) { return !p.fecha_programada; });
    var sinPublicar = state.allPosts.filter(function (p) {
      return p.fecha_programada && p.fecha_programada < hoy && !p.publicado;
    });

    var pendHtml = '';
    if (sinCopy.length) {
      pendHtml += '<p style="font-size:12px;font-weight:700;color:#E2704A;margin:0 0 6px;">🖼️ ' + sinCopy.length + ' imagen(es) esperando copy — ve a Inspiración y súbelas al Generador IA.</p>';
    }
    if (sinPublicar.length) {
      pendHtml += '<p style="font-size:12px;font-weight:700;color:#C0392B;margin:0 0 10px;">⚠️ ' + sinPublicar.length + ' post(s) con fecha pasada y sin marcar como publicados.</p>';
    }
    if (sinFecha.length) {
      pendHtml += '<p style="font-size:12px;font-weight:700;color:#2F8FEA;margin:0 0 6px;">📅 ' + sinFecha.length + ' post(s) sin fecha de publicación:</p>';
      pendHtml += sinFecha.map(function (p) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F0EDE6;">' +
          '<span style="font-size:12px;flex:1;">' + esc(p.sub || p.ig_caption || p.handle || '(sin descripción)') + '</span>' +
          '<input type="date" data-assign-fecha-id="' + p.id + '" style="width:150px;padding:5px 6px;border:1px solid #E0DDD6;font-size:12px;">' +
          '</div>';
      }).join('');
    }
    pendBox.innerHTML = pendHtml || '<p class="rs-feed-empty">Todo al día — nada pendiente.</p>';
    pendBox.querySelectorAll('[data-assign-fecha-id]').forEach(function (input) {
      input.addEventListener('change', function () { asignarFecha(input.dataset.assignFechaId, input.value); });
    });

    renderCalGrid();
  }

  // ── AGENDA · CALENDARIO MENSUAL ─────────────────────────
  var calHoy = new Date();
  state.calMes = calHoy.getMonth(); // 0-indexed
  state.calAnio = calHoy.getFullYear();

  var MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DOW_ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  function diasDelMes(anio, mes) {
    var primerDia = new Date(anio, mes, 1);
    var ultimoDia = new Date(anio, mes + 1, 0);
    var inicioOffset = (primerDia.getDay() + 6) % 7; // lunes=0
    var dias = [];
    for (var k = 0; k < inicioOffset; k++) dias.push(null);
    for (var d = 1; d <= ultimoDia.getDate(); d++) dias.push(d);
    return dias;
  }

  function fechaISO(anio, mes, dia) {
    return anio + '-' + String(mes + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
  }

  function renderCalGrid() {
    var agBox = el('cal-agenda');
    if (!agBox) return;
    var hoy = hoyISO();
    var anio = state.calAnio, mes = state.calMes;
    el('cal-mes-label').textContent = MESES_ES[mes] + ' ' + anio;

    var porFecha = {};
    state.allPosts.forEach(function (p) {
      if (!p.fecha_programada) return;
      (porFecha[p.fecha_programada] = porFecha[p.fecha_programada] || []).push(p);
    });

    var dias = diasDelMes(anio, mes);
    var html = DOW_ES.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');
    html += dias.map(function (dia) {
      if (dia === null) return '<div class="cal-day empty"></div>';
      var fecha = fechaISO(anio, mes, dia);
      var posts = porFecha[fecha] || [];
      var esHoy = fecha === hoy;
      var imgs = posts.map(function (p) {
        var vencido = fecha < hoy && !p.publicado;
        return '<img src="' + esc(p.image_url) + '" class="' + (vencido ? 'vencido' : '') + '" data-abrir-post-id="' + p.id + '">';
      }).join('');
      return '<div class="cal-day' + (esHoy ? ' today' : '') + '"><div class="cal-day-num">' + dia + '</div><div class="cal-day-imgs">' + imgs + '</div></div>';
    }).join('');

    agBox.innerHTML = '<div class="cal-grid">' + html + '</div>';
    agBox.querySelectorAll('[data-abrir-post-id]').forEach(function (img) {
      img.addEventListener('click', function () { abrirPostModal(img.dataset.abrirPostId); });
    });
  }

  function cambiarMesCalendario(delta) {
    state.calMes += delta;
    if (state.calMes < 0) { state.calMes = 11; state.calAnio--; }
    if (state.calMes > 11) { state.calMes = 0; state.calAnio++; }
    renderCalGrid();
  }

  function abrirPostModal(id) {
    var p = state.allPosts.find(function (x) { return x.id === id; });
    if (!p) return;
    var overlay = el('cal-modal-overlay');
    var content = el('cal-modal-content');
    content.innerHTML =
      '<button class="cal-modal-close" id="cal-modal-close-btn">×</button>' +
      '<img class="cal-modal-img" src="' + esc(p.image_url) + '">' +
      '<div class="cal-modal-body">' +
      '<div class="rs-post-meta" style="padding:0 0 10px;">' +
      (p.fecha_programada ? '<span class="rs-folder-badge">' + esc(p.fecha_programada) + '</span>' : '') +
      (p.carpeta ? '<span class="rs-folder-badge">' + esc(p.carpeta) + '</span>' : '') +
      '</div>' +
      (p.ig_caption ? '<p style="font-size:12px;font-weight:800;color:#999;margin:10px 0 2px;">INSTAGRAM</p><p style="font-size:13px;white-space:pre-line;">' + esc(p.ig_caption) + (p.ig_hashtags ? '\n\n' + esc(p.ig_hashtags) : '') + '</p>' : '') +
      (p.li_caption ? '<p style="font-size:12px;font-weight:800;color:#999;margin:10px 0 2px;">LINKEDIN</p><p style="font-size:13px;white-space:pre-line;">' + esc(p.li_caption) + (p.li_hashtags ? '\n\n' + esc(p.li_hashtags) : '') + '</p>' : '') +
      (p.wa_text ? '<p style="font-size:12px;font-weight:800;color:#999;margin:10px 0 2px;">WHATSAPP</p><p style="font-size:13px;white-space:pre-line;">' + esc(p.wa_text) + '</p>' : '') +
      (p.stories_text ? '<p style="font-size:12px;font-weight:800;color:#999;margin:10px 0 2px;">STORIES</p><p style="font-size:13px;white-space:pre-line;">' + esc(p.stories_text) + '</p>' : '') +
      (p.prompt_edicion_externa ? '<p style="font-size:12px;font-weight:800;color:#999;margin:10px 0 2px;">PROMPT DE EDICIÓN GUARDADO</p><p style="font-size:12px;white-space:pre-line;background:var(--paper);border:2px solid var(--ink);padding:8px;">' + esc(p.prompt_edicion_externa) + '</p>' : '') +
      fichaVariantesHtml(p) +
      metaRowHtml(p) +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="save-btn" id="cal-modal-editar-btn" style="flex:1;">✎ Editar imagen con IA</button>' +
      '<button class="save-btn" id="cal-modal-pdf-btn" style="flex:1;background:#fff;">📄 PDF</button>' +
      '<button class="rs-post-del" id="cal-modal-borrar-btn" style="position:static;width:auto;border-radius:20px;padding:0 14px;font-size:12px;">Eliminar</button>' +
      '</div>' +
      '<div class="rs-gen-status" id="cal-modal-pdf-status"></div>' +
      '</div>';

    overlay.style.display = 'flex';
    el('cal-modal-close-btn').addEventListener('click', cerrarPostModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) cerrarPostModal(); });
    content.querySelectorAll('[data-publish-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePublicado(btn.dataset.publishId, btn.dataset.publicado !== 'true'); cerrarPostModal(); });
    });
    content.querySelectorAll('[data-usar-variante-url]').forEach(function (img) {
      img.addEventListener('click', function () {
        usarVarianteComoPortada(img.dataset.usarVarianteId, img.dataset.usarVarianteUrl);
        cerrarPostModal();
      });
    });
    el('cal-modal-editar-btn').addEventListener('click', function () {
      cerrarPostModal();
      editarPostImagenEnGenerador(p.id);
    });
    el('cal-modal-borrar-btn').addEventListener('click', function () {
      cerrarPostModal();
      deletePost(p.id);
    });
    el('cal-modal-pdf-btn').addEventListener('click', function () { descargarPdfPost(p.id); });
  }

  async function descargarPdfPost(id, opciones) {
    opciones = opciones || {};
    var btn = opciones.btnEl || el('cal-modal-pdf-btn');
    var statusEl = opciones.statusEl || el('cal-modal-pdf-status');
    var setStatus = opciones.setStatus || function (msg) { if (statusEl) statusEl.textContent = msg; };
    if (btn) btn.disabled = true;
    setStatus('Generando PDF (post + versión de trabajo) y subiéndolos a Drive…');
    try {
      var result = await BL_API.benditoPost({ accion: 'descargarPdfPost', id: id });
      var byteChars = atob(result.pdf_base64);
      var bytes = new Uint8Array(byteChars.length);
      for (var i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'post-' + id + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      if (result.drive_link || result.drive_link_pendiente) {
        setStatus('✓ PDF descargado y subido a Drive (Redes sociales' + (result.drive_link_pendiente ? ' + Pendiente redes sociales' : '') + ').');
      } else {
        setStatus('✓ PDF descargado. No se pudo subir a Drive (revisa la conexión en Configuración → Drive de bendito-os).');
      }
    } catch (e) {
      setStatus('Error generando el PDF: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function cerrarPostModal() {
    el('cal-modal-overlay').style.display = 'none';
  }

  // ── GENERADOR IA ───────────────────────────────────────
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result;
        resolve({ base64: dataUrl.split(',')[1], mediaType: file.type, dataUrl: dataUrl });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setGenStatus(msg) { el('rs-gen-status').textContent = msg || ''; }

  async function handleFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var info = await fileToBase64(file);
    state.imageInfo = info;
    state.genResult = null;
    state.logoInfo = null;
    state.iaEditedInfo = null;
    state.resultadosExternos = [];
    state.editingPostId = null;
    el('rs-post-variantes-box').style.display = 'none';
    el('rs-gen-prompt-ext-box').style.display = 'none';
    el('rs-gen-resultados-externos-grid').innerHTML = '';
    el('rs-gen-result').style.display = 'none';
    el('rs-gen-art-file').value = '';
    el('rs-gen-art-preview').style.display = 'none';
    el('rs-gen-preview').src = info.dataUrl;
    el('rs-gen-preview').style.display = 'block';
    el('rs-gen-ficha').style.display = 'none';
    setGenStatus('Subiendo imagen…');

    try {
      var hash = await hashArchivo(file);
      var existente = await BL_API.benditoPost({ accion: 'buscarInspiracionPorHash', image_hash: hash });
      if (existente.existe) {
        setGenStatus('Esta imagen ya estaba guardada en Inspiración — se reutiliza en vez de duplicarla.');
        state.imageUrl = existente.data.image_url;
        var inspExistente = state.allInspirations.find(function (i) { return i.id === existente.data.id; });
        state.inspirationId = existente.data.id;
        if (inspExistente && inspExistente.prompt) {
          el('rs-gen-prompt').value = inspExistente.prompt;
          setGenStatus('✓ Imagen ya existente — prompt cargado.');
          return;
        }
        await analizarImagenActual();
        return;
      }

      var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: info.base64, mediaType: info.mediaType, filename: 'inspiracion' });
      state.imageUrl = up.url;

      var insp = await BL_API.benditoPost({ accion: 'crearInspiracion', image_url: up.url, image_hash: hash });
      state.inspirationId = insp.data.id;

      await analizarImagenActual();
    } catch (err) {
      setGenStatus('Error: ' + err.message);
    }
  }

  /**
   * Analiza state.imageInfo con IA (ficha + prompt sugerido) y lo guarda en
   * la inspiración actual (state.inspirationId) si hay una. Reutilizable
   * tanto al subir una imagen nueva como desde el botón "🔄 Sugerir prompt"
   * — necesario porque las imágenes subidas por lotes (Inspiración → Subir
   * varias imágenes) se guardan sin pasar por este análisis, así que si no,
   * la única forma de generarlo era volver a subir el archivo entero.
   */
  async function analizarImagenActual() {
    if (!state.imageInfo) {
      setGenStatus('Sube o carga una imagen primero.');
      return;
    }
    setGenStatus('Analizando imagen…');
    try {
      var ficha = await BL_API.benditoPost({ accion: 'sugerirPrompt', base64: state.imageInfo.base64, mediaType: state.imageInfo.mediaType });
      if (ficha.prompt_sugerido) {
        el('rs-gen-prompt').value = ficha.prompt_sugerido;
        if (state.inspirationId) {
          await BL_API.benditoPost({ accion: 'actualizarInspiracion', id: state.inspirationId, prompt: ficha.prompt_sugerido });
        }
      }
      renderFichaImagen(ficha);
      setGenStatus('✓ Prompt sugerido — edítalo si quieres.');
    } catch (err) {
      setGenStatus('Error analizando la imagen: ' + err.message);
    }
  }

  function renderFichaImagen(ficha) {
    var box = el('rs-gen-ficha');
    var campos = [
      ['Objeto', ficha.objeto], ['Material', ficha.material], ['Color', ficha.color_dominante],
      ['Estilo', ficha.estilo], ['Zona personalizable', ficha.superficie_personalizable], ['Sensación', ficha.sensacion],
    ].filter(function (c) { return c[1]; });
    if (!campos.length && !ficha.prompt_replicar_imagen) { box.style.display = 'none'; return; }

    var html = campos.map(function (c) { return '<strong>' + esc(c[0]) + ':</strong> ' + esc(c[1]); }).join(' · ');
    if (ficha.prompt_replicar_imagen) {
      html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #E0DDD6;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
        '<strong>Prompt para replicar la imagen</strong>' +
        '<button class="rs-copy-btn" data-copy-text="' + esc(ficha.prompt_replicar_imagen) + '">Copiar</button>' +
        '</div><span>' + esc(ficha.prompt_replicar_imagen) + '</span></div>';
    }
    box.innerHTML = html;
    box.style.display = 'block';
    box.querySelectorAll('[data-copy-text]').forEach(function (btn) {
      btn.addEventListener('click', function () { copyToClipboard(btn.dataset.copyText, btn); });
    });
  }

  async function handleArtFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var info = await fileToBase64(file);
    state.logoInfo = info;
    el('rs-gen-art-preview').src = info.dataUrl;
    el('rs-gen-art-preview').style.display = 'block';
  }

  function setIaEditStatus(msg) { el('rs-gen-ia-status').textContent = msg || ''; }

  /** Junta el logo ad-hoc subido (state.logoInfo) con los logos elegidos de la librería (selección múltiple) en una sola lista para mandar como referencia a la IA. */
  function logosSeleccionadosParaRef() {
    var refs = [];
    if (state.logoInfo) refs.push({ base64: state.logoInfo.base64, mediaType: state.logoInfo.mediaType });
    Array.prototype.forEach.call(el('rs-gen-logo-select').selectedOptions, function (opt) {
      refs.push({ url: opt.value });
    });
    return refs;
  }

  async function handleEditarConIA() {
    var instruccion = el('rs-gen-ia-instruccion').value.trim();
    if (!state.imageInfo || !instruccion) {
      setIaEditStatus('Sube la imagen base y escribe qué quieres que integre la IA.');
      return;
    }
    var btn = el('rs-gen-ia-btn');
    btn.disabled = true; btn.textContent = 'Editando…';
    setIaEditStatus('Generando la imagen editada… puede tardar unos segundos.');
    try {
      var result = await BL_API.benditoPost({
        accion: 'editarConIA',
        baseBase64: state.imageInfo.base64,
        baseMediaType: state.imageInfo.mediaType,
        refImagenes: logosSeleccionadosParaRef(),
        instruccion: instruccion,
      });
      state.iaEditedInfo = {
        base64: result.base64,
        mediaType: result.mediaType,
        dataUrl: 'data:' + result.mediaType + ';base64,' + result.base64,
      };
      el('rs-gen-ia-preview').src = state.iaEditedInfo.dataUrl;
      el('rs-gen-ia-preview').style.display = 'block';
      setIaEditStatus('✓ Imagen editada — se guardará esta versión.');
    } catch (err) {
      setIaEditStatus('Error editando con IA: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '🪄 Editar con IA';
    }
  }

  /** Genera solo el texto del prompt (no gasta cuota de edición de imagen) para pegarlo en otra IA. */
  async function handleGenerarPromptExterno() {
    var instruccion = el('rs-gen-ia-instruccion').value.trim();
    if (!state.imageInfo || !instruccion) {
      setIaEditStatus('Sube la imagen base y escribe qué quieres que integre la IA.');
      return;
    }
    var btn = el('rs-gen-prompt-ext-btn');
    btn.disabled = true; btn.textContent = 'Generando…';
    setIaEditStatus('Escribiendo el prompt…');
    try {
      var result = await BL_API.benditoPost({
        accion: 'generarPromptEdicion',
        baseBase64: state.imageInfo.base64,
        baseMediaType: state.imageInfo.mediaType,
        refImagenes: logosSeleccionadosParaRef(),
        instruccion: instruccion,
      });
      el('rs-gen-prompt-ext-texto').textContent = result.prompt_para_ia_externa || '';
      el('rs-gen-prompt-ext-box').style.display = 'block';
      setIaEditStatus('✓ Prompt listo — cópialo, créala en tu IA favorita y súbela abajo.');
    } catch (err) {
      setIaEditStatus('Error generando el prompt: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '📝 Solo generar prompt';
    }
  }

  async function handleGuardarPromptExterno() {
    var texto = el('rs-gen-prompt-ext-texto').textContent;
    if (!texto) return;
    var btn = el('rs-gen-prompt-ext-guardar-btn');
    btn.disabled = true;
    try {
      if (state.editingPostId) {
        await BL_API.benditoPost({ accion: 'actualizarPost', id: state.editingPostId, prompt_edicion_externa: texto });
      } else if (state.inspirationId) {
        await BL_API.benditoPost({ accion: 'actualizarInspiracion', id: state.inspirationId, prompt_edicion_externa: texto });
      } else {
        setIaEditStatus('Sube o carga una imagen (que quede guardada como inspiración o post) antes de guardar el prompt.');
        return;
      }
      setIaEditStatus('✓ Prompt guardado — se queda con esta imagen aunque salgas de la página.');
    } catch (e) {
      setIaEditStatus('Error guardando el prompt: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function handleResultadoExternoChange(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    for (var i = 0; i < files.length; i++) {
      var info = await fileToBase64(files[i]);
      state.resultadosExternos.push({ base64: info.base64, mediaType: info.mediaType, dataUrl: info.dataUrl });
    }
    // La última añadida queda seleccionada por defecto — el usuario puede tocar otra para cambiarla.
    seleccionarResultadoExterno(state.resultadosExternos.length - 1);
    el('rs-gen-resultado-externo-file').value = '';
  }

  function seleccionarResultadoExterno(idx) {
    var elegido = state.resultadosExternos[idx];
    if (!elegido) return;
    state.iaEditedInfo = elegido;
    el('rs-gen-ia-preview').src = elegido.dataUrl;
    el('rs-gen-ia-preview').style.display = 'block';
    renderResultadosExternos(idx);
    setIaEditStatus('✓ Resultado externo seleccionado — se guardará esta versión al pulsar "Guardar en el archivo".');
  }

  function renderResultadosExternos(idxSeleccionado) {
    var grid = el('rs-gen-resultados-externos-grid');
    if (!state.resultadosExternos.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = state.resultadosExternos.map(function (r, idx) {
      var sel = idx === idxSeleccionado;
      return '<div class="rs-gallery-item" style="' + (sel ? 'outline:3px solid var(--blue);' : '') + '">' +
        '<img src="' + r.dataUrl + '" data-elegir-resultado-idx="' + idx + '">' +
        '<div class="rs-gallery-actions" style="left:auto;right:4px;"><button data-quitar-resultado-idx="' + idx + '" title="Quitar">×</button></div>' +
        '</div>';
    }).join('');
    grid.querySelectorAll('[data-elegir-resultado-idx]').forEach(function (img) {
      img.addEventListener('click', function () { seleccionarResultadoExterno(Number(img.dataset.elegirResultadoIdx)); });
    });
    grid.querySelectorAll('[data-quitar-resultado-idx]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = Number(btn.dataset.quitarResultadoIdx);
        var eraSeleccionado = state.iaEditedInfo === state.resultadosExternos[idx];
        state.resultadosExternos.splice(idx, 1);
        if (eraSeleccionado) {
          state.iaEditedInfo = null;
          el('rs-gen-ia-preview').style.display = 'none';
        }
        renderResultadosExternos(state.resultadosExternos.indexOf(state.iaEditedInfo));
      });
    });
  }

  async function handleGenerate() {
    var prompt = el('rs-gen-prompt').value.trim();
    if (!state.imageInfo || !prompt) {
      setGenStatus('Sube una imagen y escribe/revisa el prompt.');
      return;
    }
    var btn = el('rs-gen-btn');
    btn.disabled = true; btn.textContent = 'Generando…';
    setGenStatus('');
    try {
      var result = await BL_API.benditoPost({
        accion: 'generarCopy',
        base64: state.imageInfo.base64,
        mediaType: state.imageInfo.mediaType,
        prompt: prompt,
        cuenta: el('rs-gen-cuenta').value,
        formato: el('rs-gen-formato').value,
      });
      state.genResult = result;
      renderGenResult(result);
    } catch (err) {
      setGenStatus('Error generando el copy: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Generar con IA';
    }
  }

  function renderGenResult(r) {
    var blocks = [
      { label: 'Instagram', value: r.caption_ig + '\n\n' + r.hashtags_ig, shape: 'shape-circle' },
      { label: 'LinkedIn', value: r.caption_li + '\n\n' + r.hashtags_li, shape: 'shape-square' },
      { label: 'WhatsApp', value: r.caption_wa, shape: 'shape-triangle' },
      { label: 'Stories', value: r.stories_text, shape: 'shape-ring' },
    ];
    el('rs-gen-blocks').innerHTML = blocks.map(function (b) {
      return '<div class="rs-result-block"><div class="rs-rb-head"><span class="rs-rb-label"><span class="' + b.shape + '"></span>' + esc(b.label) +
        '</span><button class="rs-copy-btn" data-copy-text="' + esc(b.value) + '">Copiar</button></div>' +
        '<p>' + esc(b.value) + '</p></div>';
    }).join('');
    el('rs-gen-blocks').querySelectorAll('[data-copy-text]').forEach(function (btn) {
      btn.addEventListener('click', function () { copyToClipboard(btn.dataset.copyText, btn); });
    });
    el('rs-gen-result').style.display = 'block';
  }

  async function handleSavePost() {
    var editando = !!state.editingPostId;
    if (!state.imageUrl) {
      setGenStatus('Sube primero una imagen base antes de guardar.');
      return;
    }
    if (!state.genResult && !editando) {
      setGenStatus('Genera el copy con IA ("Generar con IA") antes de guardar — aunque luego uses una imagen de otra IA, hace falta el copy generado para crear el post.');
      return;
    }
    var cuenta = el('rs-gen-cuenta').value;
    var isDilo = cuenta === 'dilobonito';
    var prompt = el('rs-gen-prompt').value;
    var r = state.genResult;
    var saveBtn = document.querySelector('[data-action="rs-save-post"]');

    var finalImageUrl = state.imageUrl;
    if (state.iaEditedInfo) {
      saveBtn.disabled = true;
      setGenStatus('Subiendo la imagen editada con IA…');
      try {
        var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: state.iaEditedInfo.base64, mediaType: state.iaEditedInfo.mediaType, filename: 'post-editado-ia' });
        finalImageUrl = up.url;
      } catch (err) {
        saveBtn.disabled = false;
        setGenStatus('Error al subir la imagen editada: ' + err.message);
        return;
      }
    }

    // Se guarda el primer logo de librería elegido (referencia para volver a abrir el post); si solo se usó un logo suelto (ad-hoc), no hay URL que guardar.
    var logoSelectOptions = el('rs-gen-logo-select').selectedOptions;
    var logoUrl = logoSelectOptions.length ? logoSelectOptions[0].value : null;
    var postGuardadoId = null;

    try {
      if (editando) {
        var patch = { id: state.editingPostId, image_url: finalImageUrl };
        if (r) {
          patch.ig_caption = r.caption_ig; patch.ig_hashtags = r.hashtags_ig;
          patch.li_caption = r.caption_li; patch.li_hashtags = r.hashtags_li;
          patch.wa_text = r.caption_wa; patch.stories_text = r.stories_text;
        }
        patch.carpeta = el('rs-gen-carpeta').value.trim() || null;
        patch.fecha_programada = el('rs-gen-fecha').value || null;
        if (logoUrl) patch.logo_url = logoUrl;
        var resPatch = await BL_API.benditoPost(Object.assign({ accion: 'actualizarPost' }, patch));
        postGuardadoId = resPatch.data.id;
        setGenStatus('✓ Post actualizado.');
      } else {
        var post = {
          cuenta: cuenta,
          handle: isDilo ? 'dilobonito.es' : 'bendito_lab',
          sub: prompt.slice(0, 60),
          image_url: finalImageUrl,
          ig_caption: r.caption_ig,
          ig_hashtags: r.hashtags_ig,
          li_name: isDilo ? 'Dilo Bonito' : 'Bendito Lab',
          li_role: isDilo ? 'Personalización en directo para bodas y eventos' : 'Personalización de producto para empresas y eventos',
          li_caption: r.caption_li,
          li_hashtags: r.hashtags_li,
          wa_text: r.caption_wa,
          stories_text: r.stories_text,
          fecha: 'Generado con IA',
          carpeta: el('rs-gen-carpeta').value.trim() || null,
          fecha_programada: el('rs-gen-fecha').value || null,
          prompt_edicion_externa: el('rs-gen-prompt-ext-texto').textContent || null,
          logo_url: logoUrl,
        };
        var resCrear = await BL_API.benditoPost({ accion: 'crearPost', post: post, inspiration_id: state.inspirationId });
        postGuardadoId = resCrear.data.id;
        setGenStatus('✓ Guardado en el archivo.');
      }
      resetGenForm();
      loadFeeds();
      loadGallery();
      switchTab('ig');
      if (postGuardadoId) {
        descargarPdfPost(postGuardadoId, { setStatus: setGenStatus });
      }
    } catch (e) {
      setGenStatus('Error al guardar el post: ' + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  function resetGenForm() {
    state.imageInfo = null;
    state.imageUrl = null;
    state.inspirationId = null;
    state.genResult = null;
    state.logoInfo = null;
    state.iaEditedInfo = null;
    state.resultadosExternos = [];
    state.editingPostId = null;
    el('rs-gen-file').value = '';
    el('rs-gen-preview').style.display = 'none';
    el('rs-gen-prompt').value = '';
    el('rs-gen-result').style.display = 'none';
    el('rs-gen-art-file').value = '';
    el('rs-gen-art-preview').style.display = 'none';
    el('rs-gen-ia-instruccion').value = '';
    el('rs-gen-ia-preview').style.display = 'none';
    el('rs-gen-prompt-ext-box').style.display = 'none';
    el('rs-gen-prompt-ext-texto').textContent = '';
    el('rs-gen-resultado-externo-file').value = '';
    el('rs-gen-resultados-externos-grid').innerHTML = '';
    setIaEditStatus('');
    el('rs-gen-carpeta').value = '';
    el('rs-gen-fecha').value = '';
    el('rs-gen-ficha').style.display = 'none';
    Array.prototype.forEach.call(el('rs-gen-logo-select').options, function (opt) { opt.selected = false; });
    el('rs-post-variantes-box').style.display = 'none';
  }

  // ── LOGOS ──────────────────────────────────────────────
  var logoParaSubir = null; // { base64, mediaType, dataUrl }
  var logoHashActual = null;
  var logoCola = []; // File[] pendientes de subir, se procesan de uno en uno
  var logoColaIndex = 0;

  function nombreSugeridoDeArchivo(file) {
    return file.name.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  async function avanzarColaLogos() {
    var colaEl = el('logo-cola-status');
    if (logoColaIndex >= logoCola.length) {
      colaEl.style.display = 'none';
      el('logo-file').value = '';
      logoCola = [];
      logoColaIndex = 0;
      logoParaSubir = null;
      logoHashActual = null;
      el('logo-preview').style.display = 'none';
      el('logo-nombre').value = '';
      return;
    }
    colaEl.style.display = 'block';
    colaEl.textContent = 'Logo ' + (logoColaIndex + 1) + ' de ' + logoCola.length + '…';
    var file = logoCola[logoColaIndex];
    try {
      var hash = await hashArchivo(file);
      var existente = await BL_API.benditoPost({ accion: 'buscarLogoPorHash', image_hash: hash });
      if (existente.existe) {
        el('logo-status').textContent = '"' + file.name + '" ya estaba guardado como "' + existente.data.nombre + '" — omitido.';
        logoColaIndex++;
        return avanzarColaLogos();
      }
      var info = await fileToBase64(file);
      logoParaSubir = info;
      logoHashActual = hash;
      el('logo-preview').src = info.dataUrl;
      el('logo-preview').style.display = 'block';
      el('logo-nombre').value = nombreSugeridoDeArchivo(file);
      el('logo-status').textContent = '';
    } catch (e) {
      el('logo-status').textContent = 'Error preparando "' + file.name + '": ' + e.message;
      logoColaIndex++;
      return avanzarColaLogos();
    }
  }

  async function loadLogos() {
    var grid = el('logos-grid');
    var select = el('rs-gen-logo-select');
    try {
      var d = await BL_API.benditoGet('logos');
      state.allLogos = d.data || [];
    } catch (e) {
      grid.innerHTML = '<p class="rs-feed-empty">Error cargando logos: ' + esc(e.message) + '</p>';
      return;
    }
    if (!state.allLogos.length) {
      grid.innerHTML = '<p class="rs-feed-empty">Todavía no has guardado ningún logo.</p>';
    } else {
      grid.innerHTML = state.allLogos.map(function (l) {
        return '<div class="rs-gallery-item"><img src="' + esc(l.image_url) + '" title="' + esc(l.nombre) + '">' +
          '<div class="rs-gallery-actions">' +
          '<button data-descargar-logo-url="' + esc(l.image_url) + '" data-descargar-logo-nombre="' + esc(l.nombre) + '" title="Descargar (fondo transparente, 300ppp)">⬇</button>' +
          '<button data-del-logo-id="' + l.id + '" title="Eliminar">×</button>' +
          '</div></div>';
      }).join('');
      grid.querySelectorAll('[data-del-logo-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { eliminarLogo(btn.dataset.delLogoId); });
      });
      grid.querySelectorAll('[data-descargar-logo-url]').forEach(function (btn) {
        btn.addEventListener('click', function () { descargarLogo(btn.dataset.descargarLogoUrl, btn.dataset.descargarLogoNombre); });
      });
    }
    select.innerHTML = state.allLogos.map(function (l) { return '<option value="' + esc(l.image_url) + '">' + esc(l.nombre) + '</option>'; }).join('');
  }

  async function handleLogoFileChange(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    if (!files.length) return;
    logoCola = files;
    logoColaIndex = 0;
    await avanzarColaLogos();
  }

  async function handleSubirLogo() {
    var nombre = el('logo-nombre').value.trim();
    if (!logoParaSubir || !nombre) {
      el('logo-status').textContent = 'Elige un archivo y escribe un nombre.';
      return;
    }
    var btn = el('logo-subir-btn');
    btn.disabled = true;
    el('logo-status').textContent = 'Procesando fondo transparente y guardando… puede tardar unos segundos.';
    try {
      await BL_API.benditoPost({ accion: 'subirLogo', base64: logoParaSubir.base64, mediaType: logoParaSubir.mediaType, nombre: nombre, image_hash: logoHashActual });
      loadLogos();
      if (logoCola.length) {
        logoColaIndex++;
        var quedanMas = logoColaIndex < logoCola.length;
        await avanzarColaLogos();
        if (!quedanMas) el('logo-status').textContent = '✓ Todos los logos guardados.';
      } else {
        el('logo-nombre').value = '';
        el('logo-preview').style.display = 'none';
        logoParaSubir = null;
        el('logo-status').textContent = '✓ Logo guardado.';
      }
    } catch (e) {
      el('logo-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function eliminarLogo(id) {
    if (!confirm('¿Eliminar este logo de la librería?')) return;
    try {
      await BL_API.benditoPost({ accion: 'eliminarLogo', id: id });
      loadLogos();
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  }

  // ── CARPETAS ───────────────────────────────────────────
  async function loadCarpetas() {
    var lista = el('carpetas-lista');
    var select = el('rs-gen-carpeta');
    try {
      var d = await BL_API.benditoGet('carpetas');
      state.allCarpetas = d.data || [];
    } catch (e) {
      lista.innerHTML = '<p class="rs-feed-empty">Error cargando carpetas: ' + esc(e.message) + '</p>';
      return;
    }
    lista.className = 'carpetas-botones' + (state.editandoCarpetas ? ' editando' : '');
    lista.innerHTML = state.allCarpetas.length
      ? state.allCarpetas.map(function (c) {
          var n = state.allPosts.filter(function (p) { return p.carpeta === c.nombre; }).length;
          return '<button class="carpeta-btn" data-ver-carpeta="' + esc(c.nombre) + '">' + esc(c.nombre) +
            '<span style="opacity:.55;font-weight:600;font-size:11px;">' + n + (n === 1 ? ' post' : ' posts') + '</span>' +
            '<span class="carpeta-del" data-del-carpeta-id="' + c.id + '" title="Eliminar carpeta">×</span></button>';
        }).join('')
      : '<p class="rs-feed-empty">Todavía no has creado ninguna carpeta.</p>';
    lista.querySelectorAll('[data-del-carpeta-id]').forEach(function (span) {
      span.addEventListener('click', function (e) {
        e.stopPropagation();
        eliminarCarpeta(span.dataset.delCarpetaId);
      });
    });
    lista.querySelectorAll('[data-ver-carpeta]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.editandoCarpetas) return;
        verPostsDeCarpeta(btn.dataset.verCarpeta);
      });
    });

    var actual = select.value;
    select.innerHTML = '<option value="">— Ninguna —</option>' +
      state.allCarpetas.map(function (c) { return '<option value="' + esc(c.nombre) + '">' + esc(c.nombre) + '</option>'; }).join('');
    select.value = actual;
  }

  function handleToggleEditarCarpetas() {
    state.editandoCarpetas = !state.editandoCarpetas;
    el('carpetas-editar-btn').textContent = state.editandoCarpetas ? '✓ Listo' : '✎ Editar';
    loadCarpetas();
  }

  async function handleCrearCarpeta() {
    var nombre = el('carpeta-nombre').value.trim();
    if (!nombre) {
      el('carpeta-status').textContent = 'Escribe un nombre.';
      return;
    }
    var btn = el('carpeta-crear-btn');
    btn.disabled = true;
    el('carpeta-status').textContent = 'Creando…';
    try {
      await BL_API.benditoPost({ accion: 'crearCarpeta', nombre: nombre });
      el('carpeta-nombre').value = '';
      el('carpeta-status').textContent = '✓ Carpeta creada.';
      loadCarpetas();
    } catch (e) {
      el('carpeta-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function eliminarCarpeta(id) {
    if (!confirm('¿Eliminar esta carpeta? Los posts que ya la tenían asignada mantienen el nombre igualmente, solo deja de estar en la lista.')) return;
    try {
      await BL_API.benditoPost({ accion: 'eliminarCarpeta', id: id });
      loadCarpetas();
    } catch (e) {
      alert('Error al eliminar: ' + e.message);
    }
  }

  function verPostsDeCarpeta(nombre) {
    switchTab('ig');
    state.folderFilter = nombre;
    el('rs-folder-filter').value = nombre;
    renderAllFeeds();
  }

  // ── AJUSTES ────────────────────────────────────────────
  async function loadAjustes() {
    try {
      var d = await BL_API.benditoGet('configuracion');
      el('ajustes-direccion-creativa').value = d.direccion_creativa || '';
    } catch (e) {
      el('ajustes-status').textContent = 'Error cargando la configuración: ' + e.message;
    }
  }

  async function handleGuardarAjustes() {
    var texto = el('ajustes-direccion-creativa').value.trim();
    var btn = el('ajustes-guardar-btn');
    btn.disabled = true;
    el('ajustes-status').textContent = 'Guardando…';
    try {
      await BL_API.benditoPost({ accion: 'guardarConfiguracion', direccion_creativa: texto });
      el('ajustes-status').textContent = '✓ Guardado — se aplica desde la próxima vez que generes algo.';
    } catch (e) {
      el('ajustes-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function handleRestaurarAjustes() {
    if (!confirm('¿Restaurar la dirección creativa por defecto? Se perderán los cambios que hayas hecho aquí.')) return;
    var btn = el('ajustes-restaurar-btn');
    btn.disabled = true;
    el('ajustes-status').textContent = 'Restaurando…';
    try {
      await BL_API.benditoPost({ accion: 'guardarConfiguracion', direccion_creativa: '' });
      await loadAjustes();
      el('ajustes-status').textContent = '✓ Restaurado el valor por defecto.';
    } catch (e) {
      el('ajustes-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ── PINTEREST ──────────────────────────────────────────
  async function loadPinterestEstado() {
    try {
      var d = await BL_API.benditoGet('pinterest_estado');
      if (!d.conectado) {
        el('pinterest-estado').textContent = 'No conectado.';
        el('pinterest-conectar-bloque').style.display = 'block';
        el('pinterest-conectado-bloque').style.display = 'none';
        el('pinterest-conectar-btn').href = '/api/auth/pinterest/iniciar?token=' + encodeURIComponent(BL_API.getToken());
        return;
      }
      el('pinterest-conectar-bloque').style.display = 'none';
      el('pinterest-conectado-bloque').style.display = 'block';
      var textoEstado = '✓ Conectado';
      textoEstado += d.board_nombre ? ' — tablón: ' + esc(d.board_nombre) : ' — sin tablón elegido todavía';
      textoEstado += d.last_sync_at ? ' — última sincronización: ' + new Date(d.last_sync_at).toLocaleString() : '';
      el('pinterest-estado').textContent = textoEstado;
      await cargarTablerosPinterest(d.board_id);
    } catch (e) {
      el('pinterest-estado').textContent = 'Error comprobando la conexión: ' + e.message;
    }
  }

  async function cargarTablerosPinterest(boardIdActual) {
    var select = el('pinterest-tablero-select');
    select.innerHTML = '<option value="">Cargando tableros…</option>';
    try {
      var d = await BL_API.benditoPost({ accion: 'listarTablerosPinterest' });
      var tableros = d.tableros || [];
      select.innerHTML = tableros.map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (t.id === boardIdActual ? ' selected' : '') + '>' + esc(t.nombre) + '</option>';
      }).join('') || '<option value="">Sin tableros</option>';
    } catch (e) {
      select.innerHTML = '<option value="">Error cargando tableros</option>';
      el('pinterest-status').textContent = 'Error: ' + e.message;
    }
  }

  async function handleGuardarTokenManualPinterest() {
    var token = el('pinterest-token-manual').value.trim();
    if (!token) return;
    var btn = el('pinterest-guardar-token-btn');
    btn.disabled = true;
    el('pinterest-status').textContent = 'Guardando token…';
    try {
      await BL_API.benditoPost({ accion: 'guardarTokenPinterest', access_token: token });
      el('pinterest-token-manual').value = '';
      el('pinterest-status').textContent = '✓ Token guardado — elige ahora el tablón a sincronizar.';
      await loadPinterestEstado();
    } catch (e) {
      el('pinterest-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function handleGuardarTableroPinterest() {
    var select = el('pinterest-tablero-select');
    var boardId = select.value;
    if (!boardId) return;
    var boardNombre = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '';
    var btn = el('pinterest-guardar-tablero-btn');
    btn.disabled = true;
    el('pinterest-status').textContent = 'Guardando…';
    try {
      await BL_API.benditoPost({ accion: 'guardarTableroPinterest', board_id: boardId, board_nombre: boardNombre });
      el('pinterest-status').textContent = '✓ Tablón guardado — se sincronizará una vez al día.';
      await loadPinterestEstado();
    } catch (e) {
      el('pinterest-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function handleSincronizarPinterestAhora() {
    var btn = el('pinterest-sincronizar-btn');
    btn.disabled = true;
    el('pinterest-status').textContent = 'Sincronizando…';
    try {
      var d = await BL_API.benditoPost({ accion: 'sincronizarPinterestAhora' });
      el('pinterest-status').textContent = '✓ Sincronizado — ' + (d.importados || 0) + ' pin(es) nuevo(s) añadido(s) a Inspiración.';
      await loadPinterestEstado();
      loadGallery();
    } catch (e) {
      el('pinterest-status').textContent = 'Error: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ── WIRING ─────────────────────────────────────────────
  // ensureLoaded() NO se llama aquí: en DOMContentLoaded todavía no hay
  // sesión (la pantalla de login está encima). admin.html llama a
  // window.Generador.start() solo después de un login válido (o si ya
  // había un token guardado), para no disparar /api/bendito sin auth.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.rs-tab').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.rsTab); });
    });
    el('rs-gen-file').addEventListener('change', handleFileChange);
    el('rs-gen-art-file').addEventListener('change', handleArtFileChange);
    el('rs-gen-btn').addEventListener('click', handleGenerate);
    el('rs-gen-cuenta').addEventListener('change', function (e) {
      if (window.actualizarFavicon) window.actualizarFavicon(e.target.value);
    });
    el('rs-gen-ia-btn').addEventListener('click', handleEditarConIA);
    el('rs-gen-prompt-ext-btn').addEventListener('click', handleGenerarPromptExterno);
    el('rs-gen-prompt-ext-guardar-btn').addEventListener('click', handleGuardarPromptExterno);
    el('rs-gen-prompt-ext-copy-btn').addEventListener('click', function () {
      copyToClipboard(el('rs-gen-prompt-ext-texto').textContent, el('rs-gen-prompt-ext-copy-btn'));
    });
    el('rs-gen-resultado-externo-file').addEventListener('change', handleResultadoExternoChange);
    el('rs-post-variante-file').addEventListener('change', handleAgregarVariantePost);
    el('logo-file').addEventListener('change', handleLogoFileChange);
    el('logo-subir-btn').addEventListener('click', handleSubirLogo);
    el('carpeta-crear-btn').addEventListener('click', handleCrearCarpeta);
    el('carpeta-nombre').addEventListener('keydown', function (e) { if (e.key === 'Enter') handleCrearCarpeta(); });
    el('carpetas-editar-btn').addEventListener('click', handleToggleEditarCarpetas);
    el('ajustes-guardar-btn').addEventListener('click', handleGuardarAjustes);
    el('ajustes-restaurar-btn').addEventListener('click', handleRestaurarAjustes);
    el('pinterest-guardar-token-btn').addEventListener('click', handleGuardarTokenManualPinterest);
    el('pinterest-guardar-tablero-btn').addEventListener('click', handleGuardarTableroPinterest);
    el('pinterest-sincronizar-btn').addEventListener('click', handleSincronizarPinterestAhora);
    el('cal-mes-prev').addEventListener('click', function () { cambiarMesCalendario(-1); });
    el('cal-mes-next').addEventListener('click', function () { cambiarMesCalendario(1); });
    el('insp-bulk-file').addEventListener('change', handleBulkUpload);
    el('insp-url-btn').addEventListener('click', handleAgregarInspiracionPorUrl);
    el('insp-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') handleAgregarInspiracionPorUrl(); });
    el('rs-gen-reanalizar-btn').addEventListener('click', analizarImagenActual);
    document.querySelector('[data-action="rs-save-post"]').addEventListener('click', handleSavePost);
    el('rs-folder-filter').addEventListener('change', function (e) {
      state.folderFilter = e.target.value;
      renderAllFeeds();
    });

    // Si el login ya se resolvió antes de que este script cargara (sesión
    // con token guardado — ver admin.html), arrancar directamente.
    if (BL_API.getToken()) ensureLoaded();
  });

  window.Generador = { start: ensureLoaded };
})();
