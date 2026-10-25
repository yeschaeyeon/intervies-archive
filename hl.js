// 글자 단위 형광펜(6색) + 편집 가능한 글 상자
import { h, icon, norm, debounce, toast } from './util.js';

export const COLORS = ['#7fe98d', '#fbe24d', '#f4a6ef', '#5fb6f2', '#6ee7c8', '#ff7b7b'];
export const COLOR_NAMES = ['초록', '노랑', '분홍', '파랑', '청록', '빨강'];
export const tf = (x = '') => ({ x, h: [] });

// ---- 범위 계산 ----
function cut(hs, s, e) {
  const out = [];
  for (const r of hs) {
    if (r.e <= s || r.s >= e) out.push(r);
    else { if (r.s < s) out.push({ s: r.s, e: s, c: r.c }); if (r.e > e) out.push({ s: e, e: r.e, c: r.c }); }
  }
  return out;
}
export function applyHL(hs, s, e, c) {
  const o = cut(hs, s, e); if (c != null) o.push({ s, e, c });
  return o.sort((a, b) => a.s - b.s);
}
export function remapHL(oldT, newT, hs) {
  if (!hs.length || oldT === newT) return hs;
  let p = 0; const m = Math.min(oldT.length, newT.length);
  while (p < m && oldT[p] === newT[p]) p++;
  let q = 0; while (q < m - p && oldT[oldT.length - 1 - q] === newT[newT.length - 1 - q]) q++;
  const oe = oldT.length - q, d = newT.length - oldT.length, out = [];
  for (const r of hs) {
    if (r.e <= p) out.push(r);
    else if (r.s >= oe) out.push({ s: r.s + d, e: r.e + d, c: r.c });
    else {
      if (r.s < p) out.push({ s: r.s, e: p, c: r.c });
      if (r.e > oe) out.push({ s: oe + d, e: r.e + d, c: r.c });
    }
  }
  return out.filter((r) => r.e > r.s);
}
// [s,e) 구간을 떼어낸 형광펜: ins는 구간 안(0 기준), outs는 구간을 뺀 나머지(이어 붙인 기준)
export function extractHL(hs, s, e) {
  const ins = [], outs = [], w = e - s;
  for (const r of hs) {
    const a = Math.max(r.s, s), b = Math.min(r.e, e);
    if (a < b) ins.push({ s: a - s, e: b - s, c: r.c });
    if (r.s < s) outs.push({ s: r.s, e: Math.min(r.e, s), c: r.c });
    if (r.e > e) outs.push({ s: Math.max(r.s, e) - w, e: r.e - w, c: r.c });
  }
  return { ins, outs };
}
export function partitionHL(hs, p) {
  const a = [], b = [];
  for (const r of hs) {
    if (r.s < p) a.push({ s: r.s, e: Math.min(r.e, p), c: r.c });
    if (r.e > p) b.push({ s: Math.max(r.s, p) - p, e: r.e - p, c: r.c });
  }
  return { a, b };
}

// ---- 검색어 위치 (공백·대소문자 무시) ----
export function findRanges(text, term) {
  const q = norm(term); if (!q) return [];
  const map = []; let n = '';
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    const c = text[i].toLowerCase(); for (const ch of c) { n += ch; map.push(i); }
  }
  const out = []; let from = 0;
  for (;;) { const k = n.indexOf(q, from); if (k < 0) break; out.push({ s: map[k], e: map[k + q.length - 1] + 1 }); from = k + q.length; }
  return out;
}

// ---- 렌더링 ----
export function renderRich(el, text, hs = [], finds = []) {
  while (el.firstChild) el.removeChild(el.firstChild);
  const cuts = new Set([0, text.length]);
  [...hs, ...finds].forEach((r) => { cuts.add(Math.max(0, r.s)); cuts.add(Math.min(text.length, r.e)); });
  const pts = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; if (a === b) continue;
    const hl = hs.find((r) => r.s <= a && r.e >= b); const fd = finds.some((r) => r.s <= a && r.e >= b);
    const t = text.slice(a, b);
    if (hl || fd) el.append(h('span', { class: 'mk' + (hl ? ' c' + hl.c : '') + (fd ? ' find' : '') }, t));
    else el.append(document.createTextNode(t));
  }
}

// ---- 선택 영역 → 글 상자 안의 위치 ----
function selInfo() {
  const sel = getSelection(); if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const n = r.commonAncestorContainer; const el = n.nodeType === 1 ? n : n.parentElement;
  const root = el && el.closest && el.closest('.rt');
  if (!root || !root._ctl) return null;
  const pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(r.startContainer, r.startOffset);
  const s = pre.toString().length; const e = s + r.toString().length;
  return { root, s, e, collapsed: r.collapsed };
}
export const lastSel = (root) => root._last || null;

let bar;
export function initHlBar() {
  bar = h('div', { id: 'hlbar', class: 'hlbar hidden', role: 'toolbar', 'aria-label': '형광펜' },
    ...COLORS.map((c, i) => h('button', { class: 'sw c' + i, 'aria-label': COLOR_NAMES[i] + ' 형광펜', 'data-c': i })),
    h('button', { class: 'sw er', 'aria-label': '형광펜 지우기', 'data-c': -1 }, icon('eraser', 18)));
  bar.addEventListener('pointerdown', (e) => e.preventDefault());
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const info = selInfo() || null;
    const root = info ? info.root : (bar._root || null);
    const s = info ? info.s : bar._s, en = info ? info.e : bar._e;
    if (!root || en <= s) return;
    const c = +b.dataset.c; const cur = root._ctl.get();
    root._ctl.set({ ...cur, h: applyHL(cur.h || [], s, en, c < 0 ? null : c) });
    getSelection().removeAllRanges(); bar.classList.add('hidden');
  });
  document.body.append(bar);
  document.addEventListener('selectionchange', () => {
    const i = selInfo();
    if (i) i.root._last = { s: Math.min(i.s, i.e), e: Math.max(i.s, i.e) };
    if (i && !i.collapsed && i.e > i.s) { bar._root = i.root; bar._s = i.s; bar._e = i.e; bar.classList.remove('hidden'); }
    else bar.classList.add('hidden');
  });
}

function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(110, t.scrollHeight + 4) + 'px'; }

// ---- 글 상자: 보기(형광펜 가능) ↔ 수정 ----
// opts: { get:()=>{x,h}, set:(tf)=>void, label, placeholder, term, extra:[nodes], startEdit }
export function richField(opts) {
  const body = h('div', { class: 'fbody' });
  const wrap = h('section', { class: 'field' });
  let editing = false;
  const view = h('div', { class: 'rt', tabindex: -1 });
  view._ctl = { get: opts.get, set: (v) => { opts.set(v); paint(); } };
  const toggleBtn = h('button', { class: 'btn sm', onclick: () => (editing ? done() : startEdit()) }, '수정');
  const pasteBtn = h('button', { class: 'btn sm', onclick: async () => {
    try { const t = await navigator.clipboard.readText(); if (!t) return toast('클립보드가 비어 있어요'); const cur = opts.get(); const nx = cur.x ? cur.x + '\n' + t : t; opts.set({ x: nx, h: cur.h || [] }); paint(); }
    catch { startEdit(); toast('붙여넣기 권한이 없어요. 수정 창에 직접 붙여넣어 주세요.'); }
  } }, '붙여넣기');
  const head = h('div', { class: 'fhead' }, opts.label ? h('b', null, opts.label) : null, h('span', { class: 'grow' }), ...(opts.extra || []), pasteBtn, toggleBtn);
  if (opts.noHead) head.classList.add('hidden');
  wrap.append(head, body);

  function startEdit() {
    editing = true; toggleBtn.textContent = '완료';
    const cur = opts.get();
    const ta = h('textarea', { class: 'inp area', value: cur.x || '', placeholder: opts.placeholder || '', spellcheck: false });
    let base = cur.x || '';
    const push = () => { const c = opts.get(); const nx = ta.value; if (nx === base) return; opts.set({ x: nx, h: remapHL(base, nx, c.h || []) }); base = nx; };
    const pd = debounce(push, 500);
    ta.addEventListener('input', () => { autosize(ta); pd(); });
    ta.addEventListener('blur', push);
    ta._push = push; body._ta = ta;
    body.replaceChildren(ta); autosize(ta); ta.focus();
  }
  function done() {
    if (body._ta) body._ta._push();
    editing = false; body._ta = null; toggleBtn.textContent = '수정'; paint();
  }
  function paint() {
    if (editing) return;
    const cur = opts.get();
    if (!cur.x) {
      body.replaceChildren(h('button', { class: 'empty', onclick: startEdit }, opts.placeholder || '눌러서 입력하세요'));
      return;
    }
    const finds = opts.term ? findRanges(cur.x, opts.term) : [];
    renderRich(view, cur.x, cur.h || [], finds);
    body.replaceChildren(view);
    if (finds.length && !wrap._scrolled) { wrap._scrolled = true; setTimeout(() => { const m = view.querySelector('.find'); m && m.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 80); }
  }
  wrap.repaint = paint; wrap.edit = startEdit; wrap.view = view;
  paint();
  if (opts.startEdit) startEdit();
  return wrap;
}
