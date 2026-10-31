/* Orden de Facturas · parse.js — interpreta el texto leído (sin DOM, probado con Node) */
const Parse = (() => {
  const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  function tipo(t) {
    const n = norm(t), f = n.indexOf('factura'), v = n.search(/nota\s*(de)?\s*(venta|vta|remision|entrega)/);
    if (f < 0 && v < 0) return null; if (v < 0) return 'Factura'; if (f < 0) return 'Nota'; return f < v ? 'Factura' : 'Nota';
  }
  function num(s) {
    s = String(s).replace(/[^\d.,]/g, ''); if (!s) return null;
    const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
    if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    else if (p >= 0) s = /\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, '');
    const v = parseFloat(s); return isNaN(v) ? null : v;
  }
  const NUM = /\d[\d.,]*\d|\d/g;
  function monto(t) {
    const L = t.split(/\r?\n/), pri = [/total\s*a\s*pagar|importe\s*total|monto\s*total/i, /(^|[^a-z])total(?!\s*(descuento|iva))/i];
    for (const re of pri) for (let i = L.length - 1; i >= 0; i--) {
      if (!re.test(L[i]) || /sub\s*-?\s*total/i.test(L[i]) && !/total\s*a\s*pagar/i.test(L[i])) continue;
      for (const l of [L[i], L[i + 1] || '']) { const m = (l.replace(/total/ig, ' ').match(NUM) || []).map(num).filter(v => v > 0); if (m.length) return m[m.length - 1]; }
    }
    const b = [...t.matchAll(/bs\.?\s*(\d[\d.,]*)/ig)].map(m => num(m[1])).filter(v => v > 0); return b.length ? Math.max(...b) : null;
  }
  const iso = (y, m, d) => { if (y < 100) y += 2000; if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null; return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  function fecha(t) {
    const n = norm(t), k = n.search(/fecha/), tail = k >= 0 ? n.slice(k) : '', out = [];
    for (const s of [tail, n]) {
      const re = [[/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g, m => iso(+m[3], +m[2], +m[1])], [/\b(\d{4})-(\d{2})-(\d{2})\b/g, m => iso(+m[1], +m[2], +m[3])], [/(\d{1,2})\s*de\s*([a-z]+)\s*(?:de|del)?\s*(\d{4})/g, m => MES[m[2]] ? iso(+m[3], MES[m[2]], +m[1]) : null]];
      const hits = []; for (const [r, f] of re) for (const m of s.matchAll(r)) { const v = f(m); if (v) hits.push([m.index, v]); }
      hits.sort((a, b) => a[0] - b[0]); if (hits.length) return hits[0][1];
    } return null;
  }
  const fmt = v => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '');
  return { tipo, num, monto, fecha, fmt };
})();
if (typeof module !== 'undefined') module.exports = Parse;
