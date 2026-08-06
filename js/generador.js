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
    logoInfo: null,     // { dataUrl } del logo a superponer, sin subir todavía
    allPosts: [],
    folderFilter: '',
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

    el('rs-carpetas-list').innerHTML = carpetas.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
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
    var del = '<button class="rs-post-del" data-del-id="' + p.id + '">×</button>';
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
    } catch (e) {
      alert('Error al actualizar: ' + e.message);
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
    } catch (e) {
      box.innerHTML = '<p class="rs-feed-empty">Error cargando inspiración: ' + esc(e.message) + '</p>';
      return;
    }
    if (!items.length) {
      box.innerHTML = '<p class="rs-feed-empty">Sube tu primera imagen desde el Generador IA.</p>';
      return;
    }
    box.innerHTML = '<p class="rs-gallery-hint">✓ verde = ya usada para un post</p><div class="rs-gallery-grid">' +
      items.map(function (i) {
        return '<div class="rs-gallery-item"><img src="' + esc(i.image_url) + '">' +
          (i.used ? '<span class="rs-gallery-used">✓</span>' : '') + '</div>';
      }).join('') + '</div>';
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
    el('rs-gen-result').style.display = 'none';
    el('rs-gen-art-file').value = '';
    el('rs-gen-art-preview').style.display = 'none';
    el('rs-gen-preview').src = info.dataUrl;
    el('rs-gen-preview').style.display = 'block';
    setGenStatus('Subiendo imagen…');

    try {
      var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: info.base64, mediaType: info.mediaType, filename: 'inspiracion' });
      state.imageUrl = up.url;

      var insp = await BL_API.benditoPost({ accion: 'crearInspiracion', image_url: up.url });
      state.inspirationId = insp.data.id;

      setGenStatus('Analizando imagen…');
      var prompt = await BL_API.benditoPost({ accion: 'sugerirPrompt', base64: info.base64, mediaType: info.mediaType });
      if (prompt.suggested_prompt) {
        el('rs-gen-prompt').value = prompt.suggested_prompt;
        await BL_API.benditoPost({ accion: 'actualizarInspiracion', id: state.inspirationId, prompt: prompt.suggested_prompt });
      }
      setGenStatus('✓ Prompt sugerido — edítalo si quieres.');
    } catch (err) {
      setGenStatus('Error: ' + err.message);
    }
  }

  async function handleArtFileChange(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var info = await fileToBase64(file);
    state.logoInfo = info;
    el('rs-gen-art-preview').src = info.dataUrl;
    el('rs-gen-art-preview').style.display = 'block';
    setGenStatus('✓ Logo listo — se superpondrá sobre la imagen al guardar.');
  }

  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  // Combina la imagen base con el logo (esquina inferior derecha) en un
  // <canvas> y devuelve el PNG resultante listo para subir.
  async function composeImageWithLogo(baseDataUrl, logoDataUrl) {
    var base = await loadImageEl(baseDataUrl);
    var logo = await loadImageEl(logoDataUrl);
    var canvas = document.createElement('canvas');
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

    var margin = canvas.width * 0.04;
    var logoW = canvas.width * 0.22;
    var logoH = logoW * (logo.naturalHeight / logo.naturalWidth);
    ctx.drawImage(logo, canvas.width - logoW - margin, canvas.height - logoH - margin, logoW, logoH);

    var dataUrl = canvas.toDataURL('image/png');
    return { base64: dataUrl.split(',')[1], mediaType: 'image/png' };
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
    if (!state.genResult || !state.imageUrl) return;
    var cuenta = el('rs-gen-cuenta').value;
    var isDilo = cuenta === 'dilobonito';
    var prompt = el('rs-gen-prompt').value;
    var r = state.genResult;
    var saveBtn = document.querySelector('[data-action="rs-save-post"]');

    var finalImageUrl = state.imageUrl;
    if (state.logoInfo) {
      saveBtn.disabled = true;
      setGenStatus('Componiendo logo sobre la imagen…');
      try {
        var composed = await composeImageWithLogo(state.imageInfo.dataUrl, state.logoInfo.dataUrl);
        var up = await BL_API.benditoPost({ accion: 'subirImagen', base64: composed.base64, mediaType: composed.mediaType, filename: 'post-con-logo' });
        finalImageUrl = up.url;
      } catch (err) {
        saveBtn.disabled = false;
        setGenStatus('Error al superponer el logo: ' + err.message);
        return;
      }
    }

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
    };

    try {
      await BL_API.benditoPost({ accion: 'crearPost', post: post, inspiration_id: state.inspirationId });
      setGenStatus('✓ Guardado en el archivo.');
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
    el('rs-gen-file').value = '';
    el('rs-gen-preview').style.display = 'none';
    el('rs-gen-prompt').value = '';
    el('rs-gen-result').style.display = 'none';
    el('rs-gen-art-file').value = '';
    el('rs-gen-art-preview').style.display = 'none';
    el('rs-gen-carpeta').value = '';
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
