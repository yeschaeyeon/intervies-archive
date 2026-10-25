// 공통 유틸: DOM 헬퍼, 아이콘, 토스트, 모달
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'data') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k in el && k !== 'list' && k !== 'type' && k !== 'for') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
export const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = () => { clearTimeout(t); fn(); }; return f; };
export const fmtDate = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const fmtDur = (ms) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + 'GB' : b > 1e6 ? (b / 1e6).toFixed(1) + 'MB' : Math.ceil(b / 1e3) + 'KB';

// 아이콘: 1.5px 선, 모서리 각진 형태
const ICONS = {
  doc: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8 12h8M8 16h8"/>',
  mic: '<path d="M9 3h6v10a3 3 0 0 1-6 0z"/><path d="M5 11v2a7 7 0 0 0 14 0v-2"/><path d="M12 20v2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h14l-3 4 3 4H5"/>',
  stack: '<path d="M7 3h12v14H7z"/><path d="M4 7v14h12"/><path d="M10 8h6M10 12h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l6 6"/>',
  back: '<path d="M15 4l-8 8 8 8"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  down: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  up: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  rec: '<circle cx="12" cy="12" r="6"/>',
  lock: '<path d="M5 11h14v10H5z"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eraser: '<path d="M4 16l9-10 7 6-7 8H7z"/><path d="M9 20h11"/>',
  star: '<path d="M12 3l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.2 1.4-6.3L3 9.6 9.4 9z"/>',
  check: '<path d="M4 12l5 5 11-11"/>',
};
export function icon(name, size = 22) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}

export function toast(msg, ms = 2600) {
  let box = $('#toasts');
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

// 모달: 내용 노드를 받아 닫기 함수를 돌려줌
export function modal(title, body, { wide = false, onClose } = {}) {
  const root = $('#modals');
  const ov = h('div', { class: 'overlay' });
  const close = () => { ov.remove(); onClose && onClose(); };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-head' }, h('b', null, title), h('button', { class: 'ibtn', 'aria-label': '닫기', onclick: close }, icon('close', 20))),
    h('div', { class: 'modal-body' }, body));
  ov.append(box);
  root.append(ov);
  return { close, box };
}
export function confirmBox(msg, okText = '확인', danger = false) {
  return new Promise((res) => {
    const m = modal('확인', h('div', null,
      h('p', { class: 'pre' }, msg),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => { res(false); m.close(); } }, '취소'),
        h('button', { class: 'btn solid' + (danger ? ' danger' : ''), onclick: () => { res(true); m.close(); } }, okText))), { onClose: () => res(false) });
  });
}
export function promptBox(title, label, value = '', multiline = false) {
  return new Promise((res) => {
    const inp = multiline ? h('textarea', { class: 'inp', rows: 6, value }) : h('input', { class: 'inp', value });
    const done = (v) => { res(v); m.close(); };
    const m = modal(title, h('div', null, h('label', { class: 'lbl' }, label), inp,
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => done(null) }, '취소'),
        h('button', { class: 'btn solid', onclick: () => done(inp.value) }, '확인'))), { onClose: () => res(null) });
    setTimeout(() => inp.focus(), 30);
  });
}
export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept, multiple, class: 'hidden' });
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    i.addEventListener('cancel', () => { res([]); i.remove(); });
    document.body.append(i); i.click();
  });
}
export const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
export const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
