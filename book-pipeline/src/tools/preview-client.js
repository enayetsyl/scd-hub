/* preview-client.js — browser side of the studybook layout preview/editor.
 * Served by preview.js at /editor.js. Plain DOM, no dependencies.
 * Edits go through POST /api/row and /api/bubbles; the server writes
 * book.json, the mtime poll notices, and the page reloads re-measured. */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const profile = params.get('profile') || 'print-colour';
  let bubbleMode = null;   // {lesson,row,blockId,lines,positions,rowEl}
  let stripMode = null;    // {file,strips,layer,rowEl,imgEl}
  let suspendReload = false;

  // fetch helper: a non-JSON reply almost always means the running server
  // predates this client — say so instead of a cryptic parse error
  async function api(url, body) {
    const r = await fetch(url, body === undefined ? undefined
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch (_) {
      throw new Error('the preview server is running an older version — restart it (Ctrl+C, then npm run preview -- <book.json> --images <dir>)');
    }
  }

  /* ---------- styles ---------- */
  const css = document.createElement('style');
  css.textContent = `
  body { background: #666 !important; padding-top: 36px !important; }
  .sb-page { margin: 10px auto; outline: 2px solid #2a2; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  .sb-page.pv-overflow { outline: 3px solid #e00; }
  .pv-badge { position: absolute; top: 2mm; left: 2mm; z-index: 9; font: bold 11px sans-serif;
    background: #e00; color: #fff; padding: 2px 6px; border-radius: 3px; }
  #pv-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 30; background: #222; color: #eee;
    font: 13px sans-serif; padding: 6px 12px; display: flex; gap: 16px; align-items: center; }
  #pv-bar a { color: #8cf; } #pv-bar .on { color: #fff; font-weight: bold; text-decoration: none; }
  #pv-bar button { background: #444; color: #eee; border: 1px solid #666; border-radius: 3px;
    padding: 2px 10px; cursor: pointer; }
  [data-sb-lesson] { cursor: pointer; }
  [data-sb-lesson]:hover { outline: 1px dashed #08f; }
  [data-sb-lesson].pv-sel { outline: 2px solid #08f !important; }
  #pv-panel { position: fixed; top: 44px; right: 8px; width: 260px; z-index: 30; background: #fff;
    border: 1px solid #999; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.4);
    font: 13px sans-serif; padding: 10px 12px; }
  #pv-panel h3 { margin: 0 0 8px; font-size: 13px; }
  #pv-panel label { display: block; margin: 7px 0 2px; color: #555; font-size: 11px; }
  #pv-panel select, #pv-panel input[type=number] { width: 100%; box-sizing: border-box; }
  #pv-panel input[type=range] { width: 100%; }
  #pv-panel .pv-btns { display: flex; gap: 6px; margin-top: 10px; }
  #pv-panel button { flex: 1; padding: 4px; cursor: pointer; }
  #pv-panel .pv-val { float: right; color: #08f; }
  .pv-marker { position: absolute; z-index: 20; transform: translate(-50%, -50%);
    font: 400 12pt "NotoSerifBengali", serif; text-align: center; max-width: 30%;
    outline: 1px dashed #08f; background: rgba(200,230,255,.25); cursor: grab; }
  .pv-marker .pv-idx { position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
    font: bold 10px sans-serif; background: #08f; color: #fff; border-radius: 8px; padding: 0 5px; }
  #pv-bubble-list { margin: 6px 0; max-height: 180px; overflow-y: auto; }
  #pv-bubble-list div { padding: 2px 4px; border-radius: 3px; }
  #pv-bubble-list .done { color: #2a2; } #pv-bubble-list .next { background: #def; font-weight: bold; }
  .pv-strip-layer { position: absolute; z-index: 18; cursor: crosshair; outline: 1px dashed #f80; }
  .pv-strip { position: absolute; background: rgba(255,255,255,.85); border: 1px solid rgba(192,57,43,.9); }
  .pv-strip .pv-idx { position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
    font: bold 10px sans-serif; background: #c0392b; color: #fff; border-radius: 8px; padding: 0 5px; }
  .pv-pend { position: absolute; width: 10px; height: 10px; border-radius: 50%;
    background: rgba(192,57,43,.9); transform: translate(-50%, -50%); }
  .pv-cross { position: absolute; display: none; pointer-events: none; }
  .pv-cross-v { top: 0; bottom: 0; width: 0; border-left: 1px solid rgba(47,111,208,.8); }
  .pv-cross-h { left: 0; right: 0; height: 0; border-top: 1px solid rgba(47,111,208,.8); }
  #pv-strip-list { margin: 6px 0; font-size: 11px; }
  #pv-strip-list .row { display: flex; gap: 4px; align-items: center; margin: 2px 0; }
  #pv-strip-list input { width: 44px; }
  `;
  document.head.appendChild(css);

  /* ---------- toolbar ---------- */
  const bar = document.createElement('div');
  bar.id = 'pv-bar';
  bar.innerHTML =
    '<span>studybook editor</span>' +
    ['print-colour', 'bw-photocopy'].map(p =>
      '<a class="' + (p === profile ? 'on' : '') + '" href="/?profile=' + p + '">' + p + '</a>').join('') +
    '<span id="pv-status">measuring…</span>' +
    '<button id="pv-undo" title="restore book.json from the last backup">↩ Undo</button>' +
    '<button id="pv-validate" title="run validate-studybook.js">✔ Validate</button>' +
    '<span style="color:#888">click a row to edit</span>';
  document.body.appendChild(bar);
  document.getElementById('pv-undo').onclick = async () => {
    const r = await fetch('/api/undo', { method: 'POST' });
    const j = await r.json();
    if (!j.ok) alert('nothing to undo');
  };
  document.getElementById('pv-validate').onclick = async () => {
    const btn = document.getElementById('pv-validate');
    btn.disabled = true; btn.textContent = '… validating';
    try {
      showValidation(await api('/api/validate', {}));
    } catch (e) { alert('validator failed: ' + e.message); }
    btn.disabled = false; btn.textContent = '✔ Validate';
  };

  function showValidation(j) {
    let box = document.getElementById('pv-validation');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'pv-validation';
    box.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:40;width:420px;max-height:50vh;' +
      'overflow-y:auto;background:#fff;border:2px solid ' + (j.result === 'pass' ? '#2a2' : '#e00') +
      ';border-radius:6px;font:12px monospace;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    let html = '<b style="font:bold 14px sans-serif;color:' + (j.result === 'pass' ? '#2a2' : '#e00') + '">' +
      (j.result === 'pass' ? 'VALIDATOR: PASS ✓' : 'VALIDATOR: ' + String(j.result || 'FAIL').toUpperCase()) + '</b>' +
      ' <a href="#" id="pv-vclose" style="float:right">✕ close</a>';
    if (j.error) html += '<pre>' + j.error + '</pre>';
    (j.red || []).forEach(x => { html += '<div style="color:#c00">RED [' + x.check + '] ' + x.msg + '</div>'; });
    (j.grey || []).forEach(x => { html += '<div style="color:#777">grey [' + x.check + '] ' + x.msg + '</div>'; });
    if (j.result === 'pass' && !(j.grey || []).length) html += '<div style="color:#2a2">0 red · 0 grey</div>';
    box.innerHTML = html;
    document.body.appendChild(box);
    document.getElementById('pv-vclose').onclick = e => { e.preventDefault(); box.remove(); };
  }

  /* ---------- overflow measurement ---------- */
  async function measure() {
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
    let bad = 0;
    const badPages = [];
    document.querySelectorAll('.sb-page').forEach((pg, i) => {
      const lesson = pg.querySelector('[data-lesson]');
      const over = Math.max(pg.scrollHeight - pg.clientHeight,
        lesson ? lesson.scrollHeight - lesson.clientHeight : 0);
      if (over > 2) {
        bad++;
        badPages.push(i + 1);
        pg.classList.add('pv-overflow');
        const b = document.createElement('div');
        b.className = 'pv-badge';
        b.textContent = 'page ' + (i + 1) + (lesson ? ' (lesson ' + lesson.getAttribute('data-lesson') + ')' : '') +
          ' overflows by ' + (over * 25.4 / 96).toFixed(1) + 'mm';
        pg.appendChild(b);
      }
    });
    const s = document.getElementById('pv-status');
    s.textContent = bad ? bad + ' page(s) OVERFLOW: ' + badPages.join(', ') : 'all pages fit ✓';
    s.style.color = bad ? '#f66' : '#6f6';
    s.style.cursor = bad ? 'pointer' : '';
    s.onclick = bad ? () => document.querySelectorAll('.pv-overflow')[0].scrollIntoView({ block: 'start' }) : null;
  }

  /* ---------- reload on change ---------- */
  let last = null;
  setInterval(async () => {
    if (suspendReload) return;
    try {
      const r = await fetch('/mtime'); const j = await r.json();
      if (last === null) last = j.mtime;
      else if (j.mtime !== last) location.reload();
    } catch (_) {}
  }, 1000);

  /* ---------- inspector panel ---------- */
  let panel = null;
  function closePanel() {
    if (panel) panel.remove(); panel = null;
    document.querySelectorAll('.pv-sel').forEach(el => el.classList.remove('pv-sel'));
    endBubbleMode(false);
    endStripMode();
    sessionStorage.removeItem('pv-sel');
  }

  function field(label, inner) { return '<label>' + label + '</label>' + inner; }
  function slider(id, val, min, max) {
    return '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + Math.round(val * 100) + '">' +
      '<span class="pv-val" id="' + id + '-v">' + Math.round(val * 100) + '%</span>';
  }
  function hookSlider(id) {
    const el = document.getElementById(id);
    if (el) el.oninput = () => { document.getElementById(id + '-v').textContent = el.value + '%'; };
  }

  async function selectRow(rowEl) {
    closePanel();
    rowEl.classList.add('pv-sel');
    const lesson = rowEl.getAttribute('data-sb-lesson');
    const row = rowEl.getAttribute('data-sb-row');
    sessionStorage.setItem('pv-sel', lesson + ':' + row);
    const info = await (await fetch('/api/rowinfo?lesson=' + lesson + '&row=' + row)).json();
    if (info.error) { alert(info.error); return; }

    panel = document.createElement('div');
    panel.id = 'pv-panel';
    const p = info.preset || {};
    let html = '<h3>lesson ' + info.lesson + ' · row ' + info.row +
      (info.presetName ? ' <small style="color:#999">(' + info.presetName + ')</small>' : '') + '</h3>';
    html += field('arrangement', '<select id="pv-arr">' + info.arrangements.map(a =>
      '<option' + (a === info.arrangement ? ' selected' : '') + '>' + a + '</option>').join('') + '</select>');
    html += field('page', '<input type="number" id="pv-page" min="1" max="9" value="' + info.page + '">');
    html += '<div id="pv-preset-fields"></div>';
    html += '<div class="pv-btns"><button id="pv-apply">Apply</button><button id="pv-close">Close</button></div>';
    html += '<div id="pv-bubble-area"></div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);

    function renderPresetFields() {
      const arr = document.getElementById('pv-arr').value;
      let f = '';
      if (arr === 'image-only') {
        f += field('image width (centered)', slider('pv-if', p.image_frac || 1, 10, 100));
      } else if (arr === 'side-by-side') {
        f += field('image width', slider('pv-if', p.image_frac || 0.5, 10, 100));
        f += field('gutter (mm)', '<input type="number" id="pv-gut" value="' + (p.gutter_mm != null ? p.gutter_mm : 6) + '">');
        f += field('vertical align', '<select id="pv-va"><option' + ((p.valign || 'top') === 'top' ? ' selected' : '') + '>top</option>' +
          '<option' + (p.valign === 'center' ? ' selected' : '') + '>center</option></select>');
      } else if (arr === 'image-text-image') {
        f += field('left image width', slider('pv-lf', p.left_frac || 0.3, 5, 60));
        f += field('right image width', slider('pv-rf', p.right_frac || 0.3, 5, 60));
        f += field('gutter (mm)', '<input type="number" id="pv-gut" value="' + (p.gutter_mm != null ? p.gutter_mm : 6) + '">');
        f += field('vertical align', '<select id="pv-va"><option' + ((p.valign || 'top') === 'top' ? ' selected' : '') + '>top</option>' +
          '<option' + (p.valign === 'center' ? ' selected' : '') + '>center</option></select>');
        f += field('single image split', '<select id="pv-split"><option value="">off (two images)</option>' +
          '<option value="vertical"' + (p.split === 'vertical' ? ' selected' : '') + '>vertical halves</option></select>');
      } else if (arr === 'text-in-image') {
        f += field('overlay anchor', '<select id="pv-anchor">' + ['top-right', 'top-left', 'bottom-right', 'bottom-left'].map(a =>
          '<option' + ((p.anchor || 'top-right') === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select>');
        f += field('overlay max width', slider('pv-mw', p.max_width_frac || 0.45, 20, 90));
        f += field('overlay padding (mm)', '<input type="number" id="pv-pad" value="' + (p.pad_mm != null ? p.pad_mm : 4) + '">');
        f += field('image width (centered)', slider('pv-if', p.image_frac || 1, 10, 100));
        f += field('positioned bubble style', '<select id="pv-bstyle"><option value=""' + (!p.bubble_style ? ' selected' : '') + '>plain (art has bubbles)</option>' +
          '<option value="pill"' + (p.bubble_style === 'pill' ? ' selected' : '') + '>pill (draw balloons)</option></select>');
      }
      document.getElementById('pv-preset-fields').innerHTML = f;
      ['pv-if', 'pv-lf', 'pv-rf', 'pv-mw'].forEach(hookSlider);
      renderBubbleArea(arr);
    }

    function renderBubbleArea(arr) {
      const area = document.getElementById('pv-bubble-area');
      const bb = info.textBlocks.find(b => b.hint === 'speech-bubbles');
      let h = (arr === 'text-in-image' && bb)
        ? '<div class="pv-btns"><button id="pv-place">🎯 Place bubbles</button></div>' : '';
      (info.imageRefs || []).forEach((ref, i) => {
        if (ref.filename) h += '<div class="pv-btns"><button class="pv-strips-btn" data-i="' + i +
          '" title="' + ref.filename + '">🏳 Strips: ' + ref.id + '</button></div>';
      });
      area.innerHTML = h;
      const btn = document.getElementById('pv-place');
      if (btn) btn.onclick = () => startBubbleMode(info, bb, rowEl);
      area.querySelectorAll('.pv-strips-btn').forEach(b =>
        b.onclick = () => startStripMode(info.imageRefs[+b.getAttribute('data-i')].filename, rowEl));
    }

    document.getElementById('pv-arr').onchange = renderPresetFields;
    renderPresetFields();
    document.getElementById('pv-close').onclick = closePanel;
    document.getElementById('pv-apply').onclick = async () => {
      const arr = document.getElementById('pv-arr').value;
      const body = { lesson: +lesson, row: +row, arrangement: arr, page: +document.getElementById('pv-page').value };
      const g = id => document.getElementById(id);
      if (arr === 'image-only') {
        body.preset = { image_frac: g('pv-if').value / 100 };
      } else if (arr === 'side-by-side') {
        body.preset = { image_frac: g('pv-if').value / 100, gutter_mm: +g('pv-gut').value, valign: g('pv-va').value };
      } else if (arr === 'image-text-image') {
        body.preset = { left_frac: g('pv-lf').value / 100, right_frac: g('pv-rf').value / 100,
          gutter_mm: +g('pv-gut').value, valign: g('pv-va').value };
        if (g('pv-split').value) body.preset.split = g('pv-split').value;
      } else if (arr === 'text-in-image') {
        body.preset = { anchor: g('pv-anchor').value, max_width_frac: g('pv-mw').value / 100, pad_mm: +g('pv-pad').value };
        if (+g('pv-if').value < 100) body.preset.image_frac = g('pv-if').value / 100;
        if (g('pv-bstyle').value) body.preset.bubble_style = g('pv-bstyle').value;
      }
      const r = await fetch('/api/row', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.error) alert('save failed: ' + j.error);
      // mtime poll picks up the write and reloads; selection restored below
    };
  }

  /* ---------- bubble placement mode ---------- */
  function startBubbleMode(info, block, rowEl) {
    endBubbleMode(false);
    suspendReload = true;
    const positions = (block.bubble_pos || []).slice();
    while (positions.length < block.lines.length) positions.push(null);
    bubbleMode = { lesson: info.lesson, blockId: block.id, lines: block.lines, positions, rowEl, markers: [] };
    // hide the composed bubbles so markers replace them visually
    rowEl.querySelectorAll('.sb-bubble-abs, .sb-overlay').forEach(el => el.style.visibility = 'hidden');
    const area = document.getElementById('pv-bubble-area');
    area.innerHTML = '<div id="pv-bubble-list"></div>' +
      '<div class="pv-btns"><button id="pv-bsave">Save</button><button id="pv-bcancel">Cancel</button></div>' +
      '<div style="color:#777;font-size:11px;margin-top:4px">click in the image to place the highlighted label; drag markers to adjust</div>';
    document.getElementById('pv-bsave').onclick = saveBubbles;
    document.getElementById('pv-bcancel').onclick = () => endBubbleMode(true);
    positions.forEach((p, i) => { if (p) addMarker(i, p); });
    renderBubbleList();
    rowEl.addEventListener('click', placeClick);
  }

  function renderBubbleList() {
    const list = document.getElementById('pv-bubble-list');
    if (!list || !bubbleMode) return;
    const next = bubbleMode.positions.findIndex(p => !p);
    list.innerHTML = bubbleMode.lines.map((l, i) =>
      '<div class="' + (bubbleMode.positions[i] ? 'done' : (i === next ? 'next' : '')) + '">' +
      (i + 1) + '. ' + l + (bubbleMode.positions[i] ? ' ✓' : '') + '</div>').join('');
  }

  function addMarker(i, p) {
    const m = document.createElement('span');
    m.className = 'pv-marker';
    m.innerHTML = '<span class="pv-idx">' + (i + 1) + '</span>' + bubbleMode.lines[i];
    m.style.left = (p.x * 100) + '%';
    m.style.top = (p.y * 100) + '%';
    bubbleMode.rowEl.appendChild(m);
    bubbleMode.markers[i] = m;
    m.onpointerdown = e => {
      e.preventDefault(); e.stopPropagation();
      const rect = bubbleMode.rowEl.getBoundingClientRect();
      const move = ev => {
        const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
        bubbleMode.positions[i] = { x, y };
        m.style.left = (x * 100) + '%'; m.style.top = (y * 100) + '%';
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  function placeClick(e) {
    if (!bubbleMode || e.target.closest('.pv-marker')) return;
    e.preventDefault(); e.stopPropagation();
    const i = bubbleMode.positions.findIndex(p => !p);
    if (i === -1) return;
    const rect = bubbleMode.rowEl.getBoundingClientRect();
    const p = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    bubbleMode.positions[i] = p;
    addMarker(i, p);
    renderBubbleList();
  }

  async function saveBubbles() {
    const r = await fetch('/api/bubbles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson: bubbleMode.lesson, blockId: bubbleMode.blockId, positions: bubbleMode.positions }),
    });
    const j = await r.json();
    if (j.error) { alert('save failed: ' + j.error); return; }
    endBubbleMode(false);
    suspendReload = false; // let the poll reload the recomposed page
  }

  function endBubbleMode(restoreVisibility) {
    if (!bubbleMode) { suspendReload = false; return; }
    bubbleMode.rowEl.removeEventListener('click', placeClick);
    bubbleMode.markers.forEach(m => m && m.remove());
    if (restoreVisibility) {
      bubbleMode.rowEl.querySelectorAll('.sb-bubble-abs, .sb-overlay').forEach(el => el.style.visibility = '');
    }
    bubbleMode = null;
    suspendReload = false;
  }

  /* ---------- compliance strip mode (two-click clicker, §7.5 model) ----------
   * click 1 = top of the head, click 2 = bottom of the feet; x = mean of the
   * two clicks (the character's midline), 2-decimal fractions. "auto" variant. */
  const round2 = n => Math.round(n * 100) / 100;

  let stripStart = 0; // guards the await below against a second click

  async function startStripMode(file, rowEl) {
    endBubbleMode(true); endStripMode();
    suspendReload = true;
    const token = ++stripStart;
    const j = await api('/api/strips?file=' + encodeURIComponent(file));
    // a second click during the fetch wins; this call must not also build
    // layers, or the first set is orphaned in the DOM with live listeners
    if (token !== stripStart) return;
    // sweep any markers left by an earlier session on this row
    rowEl.querySelectorAll('.pv-strip-layer, .pv-strip, .pv-pend').forEach(el => el.remove());
    const imgs = [...new Set([...rowEl.querySelectorAll('img')]
      .filter(im => im.src.endsWith('/' + encodeURIComponent(file)) || im.src.endsWith('/' + file)))];
    if (!imgs.length) { alert('image element not found in this row'); suspendReload = false; return; }
    // one click layer per visible piece of the image. In a split row each
    // half shows part of the full image, so each layer carries the mapping
    // local-x → full-image-x (strip coords are always full-image fractions).
    const rRect = rowEl.getBoundingClientRect();
    const layers = imgs.map(imgEl => {
      // The clipping box may show only part of the image: a left/right half
      // (sb-img-half) or one horizontal band of a tall multi-panel artwork
      // (sb-band, which offsets the img with a negative top). Derive the
      // visible window from geometry so both cases — and any future clip —
      // map correctly. Strip coords are always FULL-image fractions.
      const clip = imgEl.closest('.sb-img-half, .sb-band');
      const target = clip || imgEl;
      const tRect = target.getBoundingClientRect();
      const iRect = imgEl.getBoundingClientRect(); // full image box, even when clipped
      const el = document.createElement('div');
      el.className = 'pv-strip-layer';
      el.style.left = (tRect.left - rRect.left) + 'px';
      el.style.top = (tRect.top - rRect.top) + 'px';
      el.style.width = tRect.width + 'px';
      el.style.height = tRect.height + 'px';
      el.innerHTML = '<div class="pv-cross pv-cross-v"></div><div class="pv-cross pv-cross-h"></div>';
      rowEl.appendChild(el);
      const layer = {
        el,
        xOff: iRect.width ? (tRect.left - iRect.left) / iRect.width : 0,
        xScale: iRect.width ? tRect.width / iRect.width : 1,
        yOff: iRect.height ? (tRect.top - iRect.top) / iRect.height : 0,
        yScale: iRect.height ? tRect.height / iRect.height : 1,
      };
      el.addEventListener('click', e => stripLayerClick(e, layer));
      el.addEventListener('pointermove', e => stripCrosshair(e, layer));
      el.addEventListener('pointerleave', () => {
        el.querySelectorAll('.pv-cross').forEach(c => c.style.display = 'none');
      });
      return layer;
    });
    stripMode = {
      file, layers, rowEl,
      strips: (j.strips || []).map(s => Object.assign({ y0: 0, y1: 1, strip: 'auto' }, s)),
      pending: null,
    };
    document.addEventListener('keydown', stripKeys);
    renderStrips();
    renderStripPanel();
  }

  function stripCrosshair(e, layer) {
    const rect = layer.el.getBoundingClientRect();
    const v = layer.el.querySelector('.pv-cross-v');
    const h = layer.el.querySelector('.pv-cross-h');
    v.style.display = h.style.display = 'block';
    v.style.left = (e.clientX - rect.left) + 'px';
    h.style.top = (e.clientY - rect.top) + 'px';
  }

  function stripKeys(e) {
    if (!stripMode) return;
    if (e.key === 'Escape') endStripMode();
    else if (e.key === 'Enter') { e.preventDefault(); saveStrips(); }
    else if (e.key === 'r' || e.key === 'R') { stripMode.strips = []; stripMode.pending = null; stripMode.dirty = true; renderStrips(); renderStripPanel(); }
  }

  function stripLayerClick(e, layer) {
    if (e.target.closest('.pv-strip')) return;
    const rect = layer.el.getBoundingClientRect();
    const fx = layer.xOff + layer.xScale * ((e.clientX - rect.left) / rect.width);
    const fy = layer.yOff + layer.yScale * ((e.clientY - rect.top) / rect.height);
    if (!stripMode.pending) {
      stripMode.pending = { x: fx, y: fy };
    } else {
      if (stripMode.strips.length >= 24) { alert('max 24 strips per image'); return; }
      // two clicks at the same height give a zero-height strip, which
      // composites as a 1px mark — looks placed, protects nothing
      if (Math.abs(fy - stripMode.pending.y) < 0.02) {
        alert('those two clicks are at the same height — click 1 = top of head, click 2 = bottom of feet');
        return;
      }
      stripMode.strips.push({
        x: round2((stripMode.pending.x + fx) / 2),
        y0: round2(Math.min(stripMode.pending.y, fy)),
        y1: round2(Math.max(stripMode.pending.y, fy)),
        strip: 'auto',
      });
      stripMode.pending = null;
      stripMode.dirty = true;
    }
    renderStrips();
    renderStripPanel();
  }

  function renderStrips() {
    // true-to-size display: match the real asset width (fraction of the
    // strip's own height, like apply-strips scaling), min 3px to stay visible
    const VW = { 'strip-a': 0.006, 'strip-b': 0.009, 'strip-c': 0.005, 'strip-d': 0.011 };
    // clear markers across the whole row, not just the layers we track: a
    // marker orphaned by an earlier session would otherwise never be removed
    // and would read as an extra click point
    stripMode.rowEl.querySelectorAll('.pv-strip, .pv-pend').forEach(el => el.remove());
    for (const layer of stripMode.layers) {
      const layerW = layer.el.clientWidth, layerH = layer.el.clientHeight;
      // full-image fraction → this layer's visible window
      const localX = x => (x - layer.xOff) / layer.xScale;
      const localY = y => (y - layer.yOff) / layer.yScale;
      // the image's full rendered height, so a strip keeps one true width
      const imgH = layerH / (layer.yScale || 1);
      stripMode.strips.forEach((s, i) => {
        const lx = localX(s.x);
        const ly0 = localY(s.y0), ly1 = localY(s.y1);
        if (lx < 0 || lx > 1) return;       // lives in another half
        if (ly1 <= 0 || ly0 >= 1) return;   // lives in another band
        const el = document.createElement('div');
        el.className = 'pv-strip';
        // show the ink that will actually be composited
        if (s.ink === 'black') { el.style.background = 'rgba(31,31,31,.9)'; el.style.borderColor = '#fff'; }
        el.innerHTML = '<span class="pv-idx">' + (i + 1) + '</span>';
        const frac = VW[s.strip] || 0.008; // "auto" ≈ average variant
        // mirror apply-strips: width floors at 0.35% of the image width, so a
        // small figure still gets a strip you can see
        const imgW = layerW / (layer.xScale || 1);
        const wPx = Math.max(3, imgW * 0.0035, (s.y1 - s.y0) * imgH * frac);
        el.style.left = (lx * layerW - wPx / 2) + 'px';
        el.style.width = wPx + 'px';
        // clip to this band; a strip may span several bands of one artwork
        const top = Math.max(0, ly0), bot = Math.min(1, ly1);
        el.style.top = (top * 100) + '%';
        el.style.height = ((bot - top) * 100) + '%';
        layer.el.appendChild(el);
      });
      if (stripMode.pending) {
        const lx = localX(stripMode.pending.x), ly = localY(stripMode.pending.y);
        if (lx >= 0 && lx <= 1 && ly >= 0 && ly <= 1) {
          const d = document.createElement('div');
          d.className = 'pv-pend';
          d.style.left = (lx * 100) + '%';
          d.style.top = (ly * 100) + '%';
          layer.el.appendChild(d);
        }
      }
    }
  }

  function renderStripPanel() {
    const area = document.getElementById('pv-bubble-area');
    if (!area || !stripMode) return;
    let h = '<div id="pv-strip-list"><b>' + stripMode.file + ' — ' + stripMode.strips.length + ' strip(s)</b>' +
      (stripMode.dirty ? '<div style="background:#fff3cd;color:#856404;padding:2px 4px;border-radius:3px">changes not in the image yet — press <b>Save + Apply</b></div>' : '') +
      (stripMode.pending ? '<div style="color:#c0392b">now click the bottom of the feet</div>' : '');
    // ink is decided per file: auto reads the ground under the strips (white
    // strip on colour art, dark strip on line art) — override when it misses
    const curInk = (stripMode.strips[0] && stripMode.strips[0].ink) || 'auto';
    h += '<div class="row">ink <select id="pv-sink">' +
      [['auto', 'auto (detect)'], ['white', 'white strip'], ['black', 'black strip']].map(v =>
        '<option value="' + v[0] + '"' + (curInk === v[0] ? ' selected' : '') + '>' + v[1] + '</option>').join('') +
      '</select></div>';
    const VARIANTS = [['auto', 'auto'], ['strip-c', 'c ·thinnest'], ['strip-a', 'a ·thin'], ['strip-b', 'b ·mid'], ['strip-d', 'd ·widest']];
    stripMode.strips.forEach((s, i) => {
      h += '<div class="row">#' + (i + 1) +
        ' x <input data-i="' + i + '" data-k="x" value="' + s.x.toFixed(2) + '">' +
        ' y0 <input data-i="' + i + '" data-k="y0" value="' + s.y0.toFixed(2) + '">' +
        ' y1 <input data-i="' + i + '" data-k="y1" value="' + s.y1.toFixed(2) + '">' +
        ' <select data-i="' + i + '" data-k="strip">' +
        VARIANTS.map(v => '<option value="' + v[0] + '"' + ((s.strip || 'auto') === v[0] ? ' selected' : '') + '>' + v[1] + '</option>').join('') +
        '</select> <a href="#" data-del="' + i + '">✕</a></div>';
    });
    h += '</div><div class="pv-btns">' +
      '<button id="pv-sundo">undo strip</button><button id="pv-sclear">clear (R)</button></div>' +
      '<div class="pv-btns"><button id="pv-ssave">Save + Apply (Enter)</button><button id="pv-scancel">Cancel (Esc)</button></div>' +
      '<div style="color:#777;font-size:11px;margin-top:4px">click 1 = top of head · click 2 = bottom of feet · x = mean of both clicks · strip runs through the body only</div>';
    area.innerHTML = h;
    area.querySelectorAll('#pv-strip-list input, #pv-strip-list select').forEach(inp => {
      inp.onchange = () => {
        const s = stripMode.strips[+inp.getAttribute('data-i')];
        const k = inp.getAttribute('data-k');
        s[k] = (k === 'strip') ? inp.value : Math.min(1, Math.max(0, parseFloat(inp.value) || 0));
        stripMode.dirty = true;
        renderStrips();
        renderStripPanel();
      };
    });
    area.querySelectorAll('[data-del]').forEach(a => {
      a.onclick = e => { e.preventDefault(); stripMode.strips.splice(+a.getAttribute('data-del'), 1); stripMode.dirty = true; renderStrips(); renderStripPanel(); };
    });
    const inkSel = document.getElementById('pv-sink');
    if (inkSel) inkSel.onchange = () => {
      // one ink per image, as NCTB-style artwork is uniform per picture
      stripMode.strips.forEach(s => { if (inkSel.value === 'auto') delete s.ink; else s.ink = inkSel.value; });
      stripMode.dirty = true;
      renderStrips();
      renderStripPanel();
    };
    document.getElementById('pv-sundo').onclick = () => { stripMode.strips.pop(); stripMode.pending = null; stripMode.dirty = true; renderStrips(); renderStripPanel(); };
    document.getElementById('pv-sclear').onclick = () => { stripMode.strips = []; stripMode.pending = null; stripMode.dirty = true; renderStrips(); renderStripPanel(); };
    document.getElementById('pv-scancel').onclick = () => endStripMode();
    document.getElementById('pv-ssave').onclick = saveStrips;
  }

  async function saveStrips() {
    try {
      const file = stripMode.file, strips = stripMode.strips;
      let r = await api('/api/strips', { file, strips });
      if (r.error) throw new Error(r.error);
      r = await api('/api/strips/apply', { file });
      if (r.error) throw new Error(r.error);
      endStripMode();
      location.reload(); // images changed on disk; book.json didn't — reload manually
    } catch (e) { alert('strips failed: ' + e.message); }
  }

  function endStripMode() {
    if (!stripMode) return;
    document.removeEventListener('keydown', stripKeys);
    stripMode.layers.forEach(l => l.el.remove());
    stripMode = null;
    suspendReload = false;
  }

  /* ---------- wire up ---------- */
  document.addEventListener('click', e => {
    if (bubbleMode || stripMode) return; // placement modes own clicks
    if (e.target.closest('#pv-panel') || e.target.closest('#pv-bar')) return;
    const rowEl = e.target.closest('[data-sb-lesson]');
    if (rowEl) selectRow(rowEl);
  });

  measure().then(() => {
    const sel = sessionStorage.getItem('pv-sel');
    if (sel) {
      const [l, r] = sel.split(':');
      const el = document.querySelector('[data-sb-lesson="' + l + '"][data-sb-row="' + r + '"]');
      if (el) { selectRow(el); el.scrollIntoView({ block: 'center' }); }
    }
  });
})();
