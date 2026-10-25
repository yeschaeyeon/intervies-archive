import { h, $, clear, icon, toast } from './util.js';
import * as S from './store.js';
import { initHlBar } from './hl.js';
import { renderLock } from './lock.js';
import { renderMat } from './materials.js';
import { renderMock } from './mock.js';
import { renderGuide } from './guide.js';
import { renderAll } from './all.js';
import { renderSettings } from './settings.js';
import { renderSearch } from './search.js';

const TABS = [['mat', '자료', 'doc'], ['search', '검색', 'search'], ['mock', '모의면접', 'mic'], ['guide', '가이드', 'flag'], ['all', '전체 자료', 'stack'], ['set', '설정', 'gear']];
const VIEWS = { mat: renderMat, search: renderSearch, mock: renderMock, guide: renderGuide, all: renderAll, set: renderSettings };
export const routes = {};
let cur = 'mat', shell = null, busyFlag = false;
export const setBusy = (b) => { busyFlag = b; };

export function nav(tab, st = {}) { cur = tab; routes[tab] = st; render(); window.scrollTo(0, 0); }
export function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }

function build() {
  const title = h('span', { class: 'ttl' });
  const view = h('main', { id: 'view' });
  const bar = h('nav', { class: 'tabbar', 'aria-label': '메뉴' },
    ...TABS.map(([k, label, ic]) => h('button', { 'aria-label': label, title: label, data: { tab: k }, onclick: () => nav(k, k === cur ? {} : routes[k] || {}) }, icon(ic, 26))));
  const top = h('header', { class: 'topbar' }, title,
    h('button', { class: 'ibtn', 'aria-label': '지금 잠그기', onclick: () => S.lock() }, icon('lock', 22)));
  shell = h('div', { class: 'shell' }, top, view, bar);
  shell._title = title; shell._view = view;
  return shell;
}

function render() {
  const root = $('#app');
  if (!S.isUnlocked() || S.gate.hold) {
    shell = null;
    if (!root.firstChild || !root.querySelector('.gate')) renderLock(root);
    return;
  }
  if (!shell || !root.contains(shell)) { clear(root); root.append(build()); }
  const t = TABS.find((x) => x[0] === cur);
  shell._title.textContent = t[1];
  document.title = t[1] + ' · 생기부 아카이브';
  const v = shell._view; clear(v);
  const st = routes[cur] || (routes[cur] = {});
  try { VIEWS[cur](v, st); } catch (e) { console.error(e); v.append(h('div', { class: 'note' }, '화면을 그리다 문제가 생겼어요: ' + e.message)); }
}

// 잠금 상태가 바뀔 때
S.onLockChange((open) => {
  if (!open) { shell = null; clear($('#app')); }
  else if (S.gate.hold) return;
  render();
});
S.gate.release = () => { clear($('#app')); shell = null; render(); };

// 자동 잠금
let idleT;
function resetIdle() {
  clearTimeout(idleT);
  const m = S.pref('idleMin', 10);
  if (!m || !S.isUnlocked()) return;
  idleT = setTimeout(() => { if (busyFlag) return resetIdle(); S.lock(); toast('자동으로 잠겼어요'); }, m * 60000);
}
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((e) => addEventListener(e, resetIdle, { passive: true }));
S.onLockChange(resetIdle);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { S.setPref('hiddenAt', Date.now()); return; }
  const m = S.pref('idleMin', 10), at = S.pref('hiddenAt', 0);
  if (m && S.isUnlocked() && !busyFlag && at && Date.now() - at > m * 60000) S.lock();
});

(async function boot() {
  initHlBar();
  await S.loadMeta();
  render();
})();
