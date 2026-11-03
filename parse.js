/* Orden de Facturas · parse.js — interpreta el texto leído, tolerante a errores de OCR (sin DOM, probado con Node) */
const Parse = (() => {
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const fixWords = s => s.replace(/(?<=[a-z])[0143](?=[a-z])/g, c => ({ 0: 'o', 1: 'i', 4: 'a', 3: 'e' }[c])); // F4CTURA, N0TA, V3NTA
  const fixNums = s => s.replace(/(?<=[\d.,])[Oo](?=[\d.,])/g, '0').replace(/(?<=\d)[lI](?=\d)/g, '1').replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3'); // 350 . 00
  const fz = w => new RegExp([w, ...[...w].map((_, i) => w.slice(0, i) + '.' + w.slice(i + 1))].join('|')).source;
  const RF = new RegExp('(' + fz('factura') + ')'), RN = new RegExp('(' + fz('nota') + ')\\s*(de|d.|.e)?\\s*(' + fz('venta') + '|vta)|nota\\s*(de)?\\s*(remision|entrega)');
  const MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const M3 = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
  function tipoInfo(t) {
    const n = fixWords(norm(t)), f = n.search(RF), v = n.search(RN);
    if (f >= 0 || v >= 0) return { t: v < 0 ? 'Factura' : f < 0 ? 'Nota' : f < v ? 'Factura' : 'Nota', how: 'palabra' };
    if (/codigo\s*de\s*control|autorizacion|\bcuf\b/.test(n)) return { t: 'Factura', how: 'deducido' };
    return { t: null, how: null };
  }
  const tipo = t => tipoInfo(t).t;
  function num(s) {
    s = String(s).replace(/[^\d.,]/g, ''); if (!s) return null;
    const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
    if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    else if (p >= 0) s = /\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, '');
    const v = parseFloat(s); return isNaN(v) ? null : v;
  }
  const NUM = /\d[\d.,]*\d|\d/g;
  function montoInfo(raw) {
    const L = fixNums(raw).split(/\r?\n/), nums = l => (l.replace(/total/ig, ' ').match(NUM) || []).map(num).filter(v => v > 0);
    const strong = /total\s*(a\s*)?(pagar|cancelar|general|venta|bs)|importe\s*(total|a\s*pagar)|monto\s*(total|a\s*pagar|pagado)|neto\s*a\s*pagar|a\s*pagar/i;
    const weak = /(^|[^a-z])total(?![a-z])/i, bad = /sub\s*-?\s*total|items|art[ií]culos|cantidad|productos|descuento|iva|fiscal|recargo|cambio|recibido/i;
    for (const re of [strong, weak]) for (let i = L.length - 1; i >= 0; i--) {
      const l = fixWords(L[i].toLowerCase()); if (!re.test(l) || (bad.test(l) && !strong.test(l))) continue;
      for (const s of [L[i], L[i + 1] || '']) { const m = nums(s); if (m.length) return { v: m[m.length - 1], how: 'total' }; }
    }
    const txt = L.join('\n'), bs = [...txt.matchAll(/bs\.?\s*(\d[\d.,]*)|(\d[\d.,]*)\s*bs/ig)].map(m => num(m[1] || m[2])).filter(v => v > 0);
    if (bs.length) return { v: Math.max(...bs), how: 'bs' };
    const dec = (txt.match(/\d[\d.,]*[.,]\d{2}(?!\d)/g) || []).map(num).filter(v => v > 0);
    return dec.length ? { v: Math.max(...dec), how: 'max' } : { v: null, how: null };
  }
  const monto = t => montoInfo(t).v;
  const iso = (y, m, d) => { if (y < 100) y += 2000; if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null; return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  function fecha(raw) {
    const n = norm(fixNums(raw)), k = fixWords(n).search(/fecha/), tail = k >= 0 ? n.slice(k) : '';
    for (const s of [tail, n]) {
      const re = [[/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g, m => iso(+m[3], +m[2], +m[1])], [/\b(\d{4})\s*[\/-]\s*(\d{2})\s*[\/-]\s*(\d{2})\b/g, m => iso(+m[1], +m[2], +m[3])],
        [/(\d{1,2})\s*de\s*([a-z]+)\s*(?:de|del)?\s*(\d{4})/g, m => MES[m[2]] ? iso(+m[3], MES[m[2]], +m[1]) : null],
        [/(\d{1,2})[\s\-\/.]*(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*[\s\-\/.,]*(?:de\s*)?(\d{4}|\d{2})\b/g, m => iso(+m[3], M3[m[2]], +m[1])]];
      const hits = []; for (const [r, f] of re) for (const m of s.matchAll(r)) { const v = f(m); if (v) hits.push([m.index, v]); }
      hits.sort((a, b) => a[0] - b[0]); if (hits.length) return hits[0][1];
    } return null;
  }
  const analyzeOne = t => { const r = tipoInfo(t), m = montoInfo(t); return { tipo: r.t, tipoHow: r.how, monto: m.v, how: m.how, fecha: fecha(t) }; };
  const RK = { total: 0, bs: 1, max: 2 };
  function analyze(x) { /* acepta un texto o una lista de textos (una por pasada) y combina lo mejor de cada una */
    const o = { tipo: null, tipoHow: null, monto: null, montoSrc: null, how: null, fecha: null, alts: [] };
    for (const r of (Array.isArray(x) ? x : [x]).map(analyzeOne)) {
      if (r.tipo && (!o.tipo || (o.tipoHow === 'deducido' && r.tipoHow === 'palabra'))) { o.tipo = r.tipo; o.tipoHow = r.tipoHow; }
      if (r.how === 'total' && !o.alts.includes(r.monto)) o.alts.push(r.monto);
      if (r.monto && (!o.monto || RK[r.how] < RK[o.montoSrc])) { o.monto = r.monto; o.montoSrc = o.how = r.how; }
      if (r.fecha && !o.fecha) o.fecha = r.fecha;
    } return o; }
  const fmt = v => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '');
  return { tipo, num, monto, montoInfo, fecha, fmt, analyze };
})();
if (typeof module !== 'undefined') module.exports = Parse;
