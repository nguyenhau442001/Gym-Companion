// Shared DOM + formatting helpers and the toast.
export const $ = id => document.getElementById(id);
export const fmt = n => Math.round(n).toLocaleString('vi-VN');
export const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
/** Up to 2 decimals, trailing zeros dropped, Vietnamese comma (62,5 · 61,25 · 60). */
export const fmtKg = n => String(Math.round(n * 100) / 100).replace('.', ',');
export const signed1 = n => (n >= 0 ? '+' : '−') + fmt1(Math.abs(n));
export const multLabel = m => String(m).replace('.', ',') + '×';
export const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0) + '%';
export const parseNum = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sortVi = (a, b) => a.name.localeCompare(b.name, 'vi');

/** Replace the leading text node (keeps the unit <span> that follows it in the design markup). */
export function setLead(id, text) {
  const el = $(id);
  if (el.firstChild && el.firstChild.nodeType === 3) el.firstChild.nodeValue = text;
  else el.insertBefore(document.createTextNode(text), el.firstChild);
}
export function setSeg(container, isOn, accent = false) {
  for (const b of $(container).querySelectorAll('button[data-value]')) {
    const on = isOn(b.dataset.value);
    b.style.background = on ? (accent ? 'var(--acc)' : 'var(--surface)') : 'transparent';
    b.style.color = on ? (accent ? 'var(--onacc)' : 'var(--text)') : 'var(--text2)';
    b.setAttribute('aria-pressed', on);
  }
}
export const setIfIdle = (el, v) => { if (document.activeElement !== el) el.value = v; };

// ---------- toast ----------
let toastTimer = null, undoFn = null;
export function showToast(text, undo) {
  clearTimeout(toastTimer);
  undoFn = undo || null;
  $('toast-text').textContent = text;
  $('toast-undo').hidden = !undo;
  $('toast').hidden = false;
  toastTimer = setTimeout(hideToast, 3800);
}
export function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; undoFn = null; }
export function initToast() {
  $('toast-undo').addEventListener('click', async () => { const fn = undoFn; hideToast(); if (fn) await fn(); });
}
