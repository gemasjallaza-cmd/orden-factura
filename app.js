/* Orden de Facturas · app.js — carpeta, lectura OCR, revisión y movimiento de archivos */
const $ = s => document.querySelector(s), EXT = /\.(png|jpe?g|webp|bmp)$/i;
let dir = null, items = [], worker = null;
const msg = t => $('#msg').textContent = t, bar = v => $('#bar i').style.width = Math.round(v * 100) + '%';
const isoOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ext = n => n.slice(n.lastIndexOf('.'));
const valid = it => it.tipo === 'Duplicado' || (it.tipo !== 'Omitir' && Parse.num(it.monto) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha));
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
const OCR = { async run(file) {
  if (!worker) { await new Promise((ok, ko) => { if (window.Tesseract) return ok(); const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'; s.onload = ok; s.onerror = () => ko(new Error('No se pudo cargar el lector. Conéctate a internet la primera vez.')); document.head.append(s); });
    worker = await Tesseract.createWorker('spa', 1, { logger: m => m.status && msg(`${m.status} ${Math.round((m.progress || 0) * 100)}%`) }); }
  return (await worker.recognize(file)).data.text; } };
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
    try { it.text = await OCR.run(it.file); } catch (e) { msg('⚠ ' + e.message); $('#scan').disabled = false; return; }
    it.tipo = Parse.tipo(it.text) || 'Omitir'; const m = Parse.monto(it.text); it.monto = m ? Parse.fmt(m) : '';
    const f = Parse.fecha(it.text); it.fecha = f || isoOf(it.file.lastModified); it.src = f ? 'documento' : 'captura';
  }
  bar(1); $('#scan').disabled = false; render();
};
function render() {
  $('#list').innerHTML = items.map((it, i) => `<div class="it" data-i="${i}"><img src="${URL.createObjectURL(it.file)}" alt="">
  <div class="f"><small>${esc(it.name)}</small><div class="r"><select data-k="tipo">${['Factura', 'Nota', 'Duplicado', 'Omitir'].map(t => `<option${t === it.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select>
  <input data-k="monto" inputmode="decimal" placeholder="Bs" value="${esc(it.monto)}"><input data-k="fecha" type="date" value="${it.fecha}"></div>
  <small class="pv"></small><small class="wn"></small><small class="mu">Fecha según ${it.src === "documento" ? "el documento" : "la captura"}</small></div></div>`).join('');
  $('#go').hidden = false; refresh();
}
function prev(i) { const it = items[i], el = document.querySelector(`.it[data-i="${i}"]`), ok = valid(it);
  el.classList.toggle('bad', it.tipo !== 'Omitir' && !ok); el.classList.toggle('skip', it.tipo === 'Omitir');
  const dup = it.tipo === 'Duplicado';
  el.querySelector('.pv').textContent = dup ? `→ Duplicados/${it.name}` : ok ? `→ ${it.fecha}/${newName(it)}` : it.tipo === 'Omitir' ? 'No se tocará' : '⚠ Falta el monto o la fecha: no se moverá';
  el.querySelector('.mu').textContent = dup ? (it.dupOf || 'Marcada como duplicado') : `Fecha según ${it.src === 'documento' ? 'el documento' : 'la captura'}`;
  el.querySelector('.wn').textContent = it.posible ? `⚠ Posible duplicado de ${it.posible} (mismo tipo, monto y fecha). Si no lo es, déjala así.` : ''; }
function sum() { const n = items.filter(i => valid(i) && i.tipo !== 'Duplicado').length, d = items.filter(i => i.tipo === 'Duplicado').length; msg(`${n} de ${items.length} se organizarán${d ? ` y ${d} irán a «Duplicados»` : ''}. Revisa los montos antes de aplicar.`); }
$('#list').oninput = e => { const row = e.target.closest('.it'); if (!row) return; const i = +row.dataset.i; items[i][e.target.dataset.k] = e.target.value; refresh(); };
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
