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
    allPosts: [],
    allInspirations: [],
    allLogos: [],
    allCarpetas: [],
    folderFilter: '',
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
      el('rs-gen-carpeta').value = post.carpeta || '';
      el('rs-gen-fecha').value = post.fecha_programada || '';
      el('rs-gen-blocks').innerHTML = '<p class="rs-feed-empty">Editando solo la imagen — el copy actual del post no cambia salvo que pulses "Generar con IA" otra vez.</p>';
      el('rs-gen-result').style.display = 'block';
      setGenStatus('✓ Editando la imagen de un post existente — usa "🪄 Editar con IA" abajo y luego guarda para actualizarlo.');
    } catch (e) {
      setGenStatus('Error cargando la imagen: ' + e.message);
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

  function postCardHtml(channel, p) {
    var del = '<button class="rs-post-del" data-del-id="' + p.id + '">×</button>' +
      '<button class="rs-post-del" style="right:38px;" data-editar-post-id="' + p.id + '" title="Editar imagen con IA">✎</button>';
    if (channel === 'wa') {
      return '<div class="rs-post-card">' + del +
        '<div class="rs-wa-head">' + esc(p.handle) + ' · Canal de difusión</div>' +
        '<div class="rs-wa-wrap"><div class="rs-wa-bubble">' +
        '<img src="' + esc(p.image_url) + '">' +
        '<p>' + esc(p.wa_text || '(sin copy de WhatsApp)') + '</p>' +
        '</div></div>' +
        '<div class="rs-post-copy-row"><button class="rs-copy-btn" data-copy-text="' + esc(p.wa_text || '') + '">Copiar copy</button></div>' +
        metaRowHtml(p) +
        '</div>';
    }
    var isIg = channel === 'ig';
    var caption = isIg ? p.ig_caption : p.li_caption;
    var hashtags = isIg ? p.ig_hashtags : p.li_hashtags;
    var name = isIg ? p.handle : p.li_name;
    var full = (caption || '') + '\n\n' + (hashtags || '');
    return '<div class="rs-post-card">' + del +
      '<div class="rs-post-head">' + esc(name) + '</div>' +
      '<img class="rs-post-img" src="' + esc(p.image_url) + '">' +
      '<div class="rs-post-body"><p>' + esc(caption) + '</p><p class="rs-post-tags">' + esc(hashtags) + '</p></div>' +
      '<div class="rs-post-copy-row"><button class="rs-copy-btn" data-copy-text="' + esc(full) + '">Copiar copy</button></div>' +
      metaRowHtml(p) +
      '</div>';
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
    }
    renderCalendario();
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
      el('rs-gen-preview').src = info.dataUrl;
      el('rs-gen-preview').style.display = 'block';
      el('rs-gen-prompt').value = insp.prompt || '';
      el('rs-gen-ficha').style.display = 'none';
      el('rs-gen-result').style.display = 'none';
      setGenStatus(insp.prompt ? '✓ Imagen cargada — revisa el prompt.' : 'Imagen cargada — escribe o genera el prompt.');
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

    var conFecha = state.allPosts.filter(function (p) { return p.fecha_programada; })
      .sort(function (a, b) { return a.fecha_programada < b.fecha_programada ? -1 : 1; });

    if (!conFecha.length) {
      agBox.innerHTML = '<p class="rs-feed-empty">No hay posts programados todavía.</p>';
      return;
    }
    agBox.innerHTML = conFecha.map(function (p) {
      var vencido = p.fecha_programada < hoy && !p.publicado;
      return '<div class="rs-post-card" style="margin-bottom:12px;' + (vencido ? 'border-color:#C0392B;' : '') + '">' +
        '<div class="rs-post-meta" style="padding:12px 12px 0;">' +
        '<span class="rs-folder-badge">' + esc(p.fecha_programada) + '</span>' +
        (p.carpeta ? '<span class="rs-folder-badge">' + esc(p.carpeta) + '</span>' : '') +
        (p.gcal_id ? '<span class="rs-folder-badge" style="background:#E8F5E9;">✓ En Google Calendar</span>' : '') +
        '</div>' +
        '<div class="rs-post-body"><p>' + esc(p.sub || p.ig_caption || '(sin descripción)') + '</p></div>' +
        metaRowHtml(p) +
        '</div>';
    }).join('');
    agBox.querySelectorAll('[data-publish-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePublicado(btn.dataset.publishId, btn.dataset.publicado !== 'true'); });
    });
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
    state.editingPostId = null;
    el('rs-gen-result').style.display = 'none';
    el('rs-gen-art-file').value = '';
    el('rs-gen-art-preview').style.display = 'none';
    el('rs-gen-preview').src = info.dataUrl;
    el('rs-gen-preview').style.display = 'block';
    el('rs-gen-ficha').style.display = 'none';
    setGenStatus('Subiendo imagen…');

    try {
      var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: info.base64, mediaType: info.mediaType, filename: 'inspiracion' });
      state.imageUrl = up.url;

      var insp = await BL_API.benditoPost({ accion: 'crearInspiracion', image_url: up.url });
      state.inspirationId = insp.data.id;

      setGenStatus('Analizando imagen…');
      var ficha = await BL_API.benditoPost({ accion: 'sugerirPrompt', base64: info.base64, mediaType: info.mediaType });
      if (ficha.prompt_sugerido) {
        el('rs-gen-prompt').value = ficha.prompt_sugerido;
        await BL_API.benditoPost({ accion: 'actualizarInspiracion', id: state.inspirationId, prompt: ficha.prompt_sugerido });
      }
      renderFichaImagen(ficha);
      setGenStatus('✓ Prompt sugerido — edítalo si quieres.');
    } catch (err) {
      setGenStatus('Error: ' + err.message);
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
    el('rs-gen-logo-select').value = ''; // solo una fuente de logo a la vez
  }

  function setIaEditStatus(msg) { el('rs-gen-ia-status').textContent = msg || ''; }

  async function handleEditarConIA() {
    var instruccion = el('rs-gen-ia-instruccion').value.trim();
    if (!state.imageInfo || !instruccion) {
      setIaEditStatus('Sube la imagen base y escribe qué quieres que integre la IA.');
      return;
    }
    var btn = el('rs-gen-ia-btn');
    var logoSeleccionadoUrl = el('rs-gen-logo-select').value;
    btn.disabled = true; btn.textContent = 'Editando…';
    setIaEditStatus('Generando la imagen editada… puede tardar unos segundos.');
    try {
      var result = await BL_API.benditoPost({
        accion: 'editarConIA',
        baseBase64: state.imageInfo.base64,
        baseMediaType: state.imageInfo.mediaType,
        refBase64: state.logoInfo ? state.logoInfo.base64 : undefined,
        refMediaType: state.logoInfo ? state.logoInfo.mediaType : undefined,
        refImageUrl: (!state.logoInfo && logoSeleccionadoUrl) ? logoSeleccionadoUrl : undefined,
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
      { label: 'Instagram', value: r.caption_ig + '\n\n' + r.hashtags_ig },
      { label: 'LinkedIn', value: r.caption_li + '\n\n' + r.hashtags_li },
      { label: 'WhatsApp', value: r.caption_wa },
      { label: 'Stories', value: r.stories_text },
    ];
    el('rs-gen-blocks').innerHTML = blocks.map(function (b) {
      return '<div class="rs-result-block"><div class="rs-rb-head"><span class="rs-rb-label">' + esc(b.label) +
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
    if (!state.imageUrl || (!state.genResult && !editando)) return;
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
        await BL_API.benditoPost(Object.assign({ accion: 'actualizarPost' }, patch));
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
        };
        await BL_API.benditoPost({ accion: 'crearPost', post: post, inspiration_id: state.inspirationId });
        setGenStatus('✓ Guardado en el archivo.');
      }
      resetGenForm();
      loadFeeds();
      loadGallery();
      switchTab('ig');
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
    state.editingPostId = null;
    el('rs-gen-file').value = '';
    el('rs-gen-preview').style.display = 'none';
    el('rs-gen-prompt').value = '';
    el('rs-gen-result').style.display = 'none';
    el('rs-gen-art-file').value = '';
    el('rs-gen-art-preview').style.display = 'none';
    el('rs-gen-ia-instruccion').value = '';
    el('rs-gen-ia-preview').style.display = 'none';
    setIaEditStatus('');
    el('rs-gen-carpeta').value = '';
    el('rs-gen-fecha').value = '';
    el('rs-gen-ficha').style.display = 'none';
    el('rs-gen-logo-select').value = '';
  }

  // ── LOGOS ──────────────────────────────────────────────
  var logoParaSubir = null; // { base64, mediaType, dataUrl }

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
          '<button class="rs-post-del" data-del-logo-id="' + l.id + '">×</button></div>';
      }).join('');
      grid.querySelectorAll('[data-del-logo-id]').forEach(function (btn) {
        btn.addEventListener('click', function () { eliminarLogo(btn.dataset.delLogoId); });
      });
    }
    select.innerHTML = '<option value="">— Ninguno —</option>' +
      state.allLogos.map(function (l) { return '<option value="' + esc(l.image_url) + '">' + esc(l.nombre) + '</option>'; }).join('');
  }

  async function handleLogoFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    logoParaSubir = await fileToBase64(file);
    el('logo-preview').src = logoParaSubir.dataUrl;
    el('logo-preview').style.display = 'block';
  }

  async function handleSubirLogo() {
    var nombre = el('logo-nombre').value.trim();
    if (!logoParaSubir || !nombre) {
      el('logo-status').textContent = 'Elige un archivo y escribe un nombre.';
      return;
    }
    var btn = el('logo-subir-btn');
    btn.disabled = true;
    el('logo-status').textContent = 'Guardando…';
    try {
      await BL_API.benditoPost({ accion: 'subirLogo', base64: logoParaSubir.base64, mediaType: logoParaSubir.mediaType, nombre: nombre });
      el('logo-nombre').value = '';
      el('logo-file').value = '';
      el('logo-preview').style.display = 'none';
      logoParaSubir = null;
      el('logo-status').textContent = '✓ Logo guardado.';
      loadLogos();
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
    lista.innerHTML = state.allCarpetas.length
      ? state.allCarpetas.map(function (c) {
          return '<div class="carpeta-row"><span>' + esc(c.nombre) + '</span>' +
            '<button data-del-carpeta-id="' + c.id + '">Eliminar</button></div>';
        }).join('')
      : '<p class="rs-feed-empty">Todavía no has creado ninguna carpeta.</p>';
    lista.querySelectorAll('[data-del-carpeta-id]').forEach(function (btn) {
      btn.addEventListener('click', function () { eliminarCarpeta(btn.dataset.delCarpetaId); });
    });

    var actual = select.value;
    select.innerHTML = '<option value="">— Ninguna —</option>' +
      state.allCarpetas.map(function (c) { return '<option value="' + esc(c.nombre) + '">' + esc(c.nombre) + '</option>'; }).join('');
    select.value = actual;
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
    el('rs-gen-ia-btn').addEventListener('click', handleEditarConIA);
    el('logo-file').addEventListener('change', handleLogoFileChange);
    el('logo-subir-btn').addEventListener('click', handleSubirLogo);
    el('carpeta-crear-btn').addEventListener('click', handleCrearCarpeta);
    el('carpeta-nombre').addEventListener('keydown', function (e) { if (e.key === 'Enter') handleCrearCarpeta(); });
    el('rs-gen-logo-select').addEventListener('change', function (e) {
      if (e.target.value) {
        state.logoInfo = null; // solo una fuente de logo a la vez
        el('rs-gen-art-file').value = '';
        el('rs-gen-art-preview').style.display = 'none';
      }
    });
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
