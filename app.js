/* Orden de Facturas · app.js — carpeta, lectura OCR, revisión y movimiento de archivos */
const $ = s => document.querySelector(s), EXT = /\.(png|jpe?g|webp|bmp)$/i;
let dir = null, items = [], worker = null;
const msg = t => $('#msg').textContent = t, bar = v => $('#bar i').style.width = Math.round(v * 100) + '%';
const isoOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ext = n => n.slice(n.lastIndexOf('.'));
const valid = it => it.tipo === 'Duplicado' || (['Factura', 'Nota'].includes(it.tipo) && Parse.num(it.monto) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha));
const sha = async f => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
/* Duplicados exactos: mismo contenido que otra imagen del lote o que un archivo ya organizado (carpetas AAAA-MM-DD) */
async function findDups() {
  const first = new Map(); items.forEach(i => delete i.dupOf);
  for (const it of items) { it.file = await it.handle.getFile(); it.hash = await sha(it.file); if (first.has(it.hash)) it.dupOf = `Idéntica a ${first.get(it.hash).name}`; else first.set(it.hash, it); }
  const sizes = new Set(items.map(i => i.file.size));
  for await (const [n, h] of dir.entries()) if (h.kind === 'directory' && /^\d{4}-\d{2}-\d{2}$/.test(n))
    for await (const [fn, fh] of h.entries()) { if (fh.kind !== 'file') continue; const f = await fh.getFile(); if (!sizes.has(f.size)) continue;
      const it = first.get(await sha(f)); if (it && !it.dupOf) it.dupOf = `Ya está organizada: ${n}/${fn}`; }
}
/* Posibles duplicados: mismo tipo, monto y fecha (puede ser legítimo: solo se avisa) */
function flagPossible() {
  const seen = new Map(); items.forEach(it => { delete it.posible; if (!$('#dup').checked || !valid(it) || it.tipo === 'Duplicado') return;
    const k = `${it.tipo}|${Parse.num(it.monto)}|${it.fecha}`; if (seen.has(k)) it.posible = seen.get(k); else seen.set(k, it.name); });
}
const refresh = () => { flagPossible(); items.forEach((_, i) => prev(i)); sum(); };
const newName = it => `${it.tipo}_${Parse.fmt(Parse.num(it.monto))}Bs${ext(it.name)}`;
/* Lectura: varias pasadas con distinto tratamiento de imagen; se combinan los resultados (ninguna configuración gana siempre) */
const PASSES = [{ psm: '6', mode: 'clean' }, { psm: '3', mode: 'raw' }, { psm: '6', mode: 'bin' }, { psm: '11', mode: 'clean' }];
async function prep(file, bin) { /* agranda, pasa a grises, estira el contraste, invierte capturas oscuras y (opcional) binariza con Otsu */
  const bm = await createImageBitmap(file); let sc = Math.min(3, Math.max(1, 1800 / bm.width)); if (bm.width * bm.height * sc * sc > 9e6) sc = Math.sqrt(9e6 / (bm.width * bm.height));
  const w = Math.round(bm.width * sc), h = Math.round(bm.height * sc), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, w, h);
  const im = x.getImageData(0, 0, w, h), d = im.data, n = w * h, g = new Uint8Array(n), hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; g[j] = v; hist[v]++; }
  let lo = 0, hi = 255, s = 0, sum = 0; while (lo < 255 && s + hist[lo] < n * .001) s += hist[lo++]; s = 0; while (hi > 0 && s + hist[hi] < n * .001) s += hist[hi--];
  if (hi - lo < 40) { lo = 0; hi = 255; } /* poco rango: no estirar (evita destruir imágenes con poco texto) */
  for (let v = 0; v < 256; v++) sum += v * hist[v]; const dark = sum / n < 110, rng = Math.max(1, hi - lo);
  for (let j = 0; j < n; j++) { let v = Math.max(0, Math.min(255, (g[j] - lo) * 255 / rng)); g[j] = dark ? 255 - v : v; }
  if (bin) { const H = new Uint32Array(256); for (let j = 0; j < n; j++) H[g[j]]++; let tot = 0, sB = 0, wB = 0, mx = 0, t = 128; for (let v = 0; v < 256; v++) tot += v * H[v];
    for (let v = 0; v < 256; v++) { wB += H[v]; if (!wB || wB === n) continue; sB += v * H[v]; const mB = sB / wB, mF = (tot - sB) / (n - wB), bv = wB * (n - wB) * (mB - mF) ** 2; if (bv > mx) { mx = bv; t = v; } }
    for (let j = 0; j < n; j++) g[j] = g[j] > t ? 255 : 0; }
  for (let i = 0, j = 0; j < n; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = g[j]; d[i + 3] = 255; } x.putImageData(im, 0, 0);
  return new Promise(o => c.toBlob(o));
}
const OCR = { async run(file, p = PASSES[0]) {
  if (!worker) { await new Promise((ok, ko) => { if (window.Tesseract) return ok(); const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = ok; s.onerror = () => ko(new Error('No se pudo cargar el lector. Conéctate a internet la primera vez.')); document.head.append(s); });
    worker = await Tesseract.createWorker('spa', 1, { logger: m => m.status && msg(`${m.status} ${Math.round((m.progress || 0) * 100)}%`) }); }
  await worker.setParameters({ tessedit_pageseg_mode: p.psm, preserve_interword_spaces: '1', user_defined_dpi: '300' });
  return (await worker.recognize(p.mode === 'raw' ? file : await prep(file, p.mode === 'bin'))).data.text; } };
async function analyze(it, force) {
  const texts = [];
  for (let k = 0; k < PASSES.length; k++) { msg(`Leyendo ${it.name} (pasada ${k + 1}/${PASSES.length})…`); texts.push(await OCR.run(it.file, PASSES[k]));
    const r = Parse.analyze(texts); if (!force && r.tipo && r.montoSrc === 'total') break; }
  it.text = texts.map((t, i) => `── pasada ${i + 1} ──\n${t.trim()}`).join('\n'); return Parse.analyze(texts);
}
function fill(it, r) { it.tipo = r.tipo || 'Revisar'; it.monto = r.monto ? Parse.fmt(r.monto) : ''; it.deducido = r.tipoHow === 'deducido';
  it.aviso = [r.monto && r.montoSrc !== 'total' ? '⚠ Monto estimado (no se vio una línea de total): verifícalo.' : '', r.alts.length > 1 ? `⚠ Las lecturas dieron montos distintos (${r.alts.map(Parse.fmt).join(' / ')}): verifica.` : '', it.deducido ? 'Tipo deducido por el código de control: confírmalo.' : ''].filter(Boolean).join(' ');
  it.fecha = r.fecha || isoOf(it.file.lastModified); it.src = r.fecha ? 'documento' : 'captura'; }
$('#pick').onclick = async () => {
  if (!window.showDirectoryPicker) return msg('Este navegador no permite elegir carpetas. Usa Chrome o Edge en la PC.');
  try { dir = await showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
  items = []; for await (const [n, h] of dir.entries()) if (h.kind === 'file' && EXT.test(n)) items.push({ name: n, handle: h });
  items.sort((a, b) => a.name.localeCompare(b.name)); $('#list').innerHTML = ''; $('#go').hidden = true;
  msg(`Carpeta «${dir.name}»: ${items.length} imágenes.`); $('#scan').hidden = !items.length;
};
$('#scan').onclick = async () => {
  $('#scan').disabled = true;
  if ($('#dup').checked) { msg('Buscando duplicados…'); await findDups(); } else items.forEach(i => delete i.dupOf);
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; bar(i / items.length); msg(`Leyendo ${i + 1}/${items.length}: ${it.name}`);
    it.file = it.file || await it.handle.getFile();
    if (it.dupOf) { it.tipo = 'Duplicado'; it.monto = ''; it.fecha = isoOf(it.file.lastModified); it.src = 'captura'; continue; }
    try { fill(it, await analyze(it)); } catch (e) { msg('⚠ ' + e.message); $('#scan').disabled = false; return; }
  }
  bar(1); $('#scan').disabled = false; render();
};
function render() {
  $('#list').innerHTML = items.map((it, i) => `<div class="it" data-i="${i}"><img src="${URL.createObjectURL(it.file)}" alt="">
  <div class="f"><small>${esc(it.name)}</small><div class="r"><select data-k="tipo">${['Factura', 'Nota', 'Duplicado', 'Revisar', 'Omitir'].map(t => `<option${t === it.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select>
  <input data-k="monto" inputmode="decimal" placeholder="Bs" value="${esc(it.monto)}"><input data-k="fecha" type="date" value="${it.fecha}"></div>
  <small class="pv"></small><small class="wn"></small><small class="mu"></small>${it.text ? `<details><summary>Texto leído</summary><pre class="tx">${esc(it.text)}</pre></details><button class="rt">🔁 Reintentar con más detalle</button>` : ''}</div></div>`).join('');
  $('#go').hidden = false; refresh();
}
function prev(i) { const it = items[i], el = document.querySelector(`.it[data-i="${i}"]`), ok = valid(it);
  el.classList.toggle('rev', it.tipo === 'Revisar'); el.classList.toggle('bad', ['Factura', 'Nota'].includes(it.tipo) && !ok); el.classList.toggle('skip', it.tipo === 'Omitir');
  const dup = it.tipo === 'Duplicado';
  el.querySelector('.pv').textContent = dup ? `→ Duplicados/${it.name}` : ok ? `→ ${it.fecha}/${newName(it)}` : it.tipo === 'Omitir' ? 'No se tocará' : it.tipo === 'Revisar' ? '⚠ No se reconoció: toca la miniatura y elige Factura o Nota (u Omitir)' : '⚠ Falta el monto o la fecha: no se moverá';
  el.querySelector('.mu').textContent = dup ? (it.dupOf || 'Marcada como duplicado') : `Fecha según ${it.src === 'documento' ? 'el documento' : 'la captura'}`;
  el.querySelector('.wn').textContent = [it.aviso, it.posible ? `⚠ Posible duplicado de ${it.posible} (mismo tipo, monto y fecha). Si no lo es, déjala así.` : ''].filter(Boolean).join(' '); }
function sum() { const n = items.filter(i => valid(i) && i.tipo !== 'Duplicado').length, d = items.filter(i => i.tipo === 'Duplicado').length, r = items.filter(i => i.tipo === 'Revisar').length; msg(`${n} de ${items.length} se organizarán${d ? ` y ${d} irán a «Duplicados»` : ''}. ${r ? ` ${r} sin reconocer: toca su miniatura para verlas y elige Factura o Nota.` : ''} Revisa los montos antes de aplicar.`); }
$('#list').oninput = e => { const row = e.target.closest('.it'); if (!row) return; const i = +row.dataset.i; items[i][e.target.dataset.k] = e.target.value; refresh(); };
$('#lb').onclick = () => $('#lb').hidden = true;
$('#list').onclick = async e => { if (e.target.tagName === 'IMG') { $('#lbi').src = e.target.src; $('#lb').hidden = false; return; } const b = e.target.closest('.rt'); if (!b) return; const it = items[+b.closest('.it').dataset.i], old = { tipo: it.tipo, monto: it.monto }; b.disabled = true;
  try { fill(it, await analyze(it, true)); if ((it.tipo === 'Omitir' || it.tipo === 'Revisar') && !['Omitir', 'Revisar'].includes(old.tipo)) it.tipo = old.tipo; if (!it.monto) it.monto = old.monto; } catch (err) { msg('⚠ ' + err.message); } render(); };
const exists = async (d, n) => { try { await d.getFileHandle(n); return true; } catch { return false; } };
$('#apply').onclick = async () => {
  const mv = $('#mv').checked, log = [['original', 'nuevo']]; let ok = 0, sk = 0, er = 0; $('#apply').disabled = true;
  for (const it of items) {
    if (!valid(it)) { sk++; continue; }
    try {
      const dp = it.tipo === 'Duplicado', fol = dp ? 'Duplicados' : it.fecha, d = await dir.getDirectoryHandle(fol, { create: true }), base = (dp ? it.name : newName(it)).slice(0, -ext(it.name).length); let n = base + ext(it.name), k = 2;
      while (await exists(d, n)) n = `${base}_${k++}${ext(it.name)}`;
      const fh = await d.getFileHandle(n, { create: true }), w = await fh.createWritable(); await w.write(it.file); await w.close();
      if ((await fh.getFile()).size !== it.file.size) throw new Error('el tamaño no coincide');
      if (mv) await dir.removeEntry(it.name); log.push([it.name, `${fol}/${n}`]); ok++;
    } catch (e) { er++; log.push([it.name, 'ERROR ' + e.message]); }
  }
  const csv = log.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  $('#msg').innerHTML = `✔ ${ok} ${mv ? 'movidas' : 'copiadas'} · ${sk} sin tocar · ${er} con error. <a id="csv" download="registro-orden.csv" href="${URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))}">Descargar registro</a>`;
  $('#apply').disabled = false; $('#list').innerHTML = ''; $('#go').hidden = true; $('#scan').hidden = true;
};
let dp; addEventListener('beforeinstallprompt', e => { e.preventDefault(); dp = e; $('#inst').hidden = false; });
$('#inst').onclick = async () => { if (dp) { dp.prompt(); await dp.userChoice; $('#inst').hidden = true; } };
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
