// 상태 저장소: 모든 데이터는 항목(item) 단위로 보관하고, 암호화해서 IndexedDB에만 저장한다.
import * as C from './crypto.js';
import { dbGet, dbPut, dbDel, dbKeys, dbClearAll } from './db.js';
import { uid, debounce } from './util.js';

export let items = {};
let rawDek = null, key = null, meta = null;
const lockListeners = new Set();
export const onLockChange = (f) => lockListeners.add(f);
export const isUnlocked = () => !!key;
export const gate = { hold: false, release: () => {} }; // 복구 키 확인 전에는 앱 화면을 열지 않기 위한 장치

export const pref = (k, d) => { try { const v = localStorage.getItem('sgb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const setPref = (k, v) => { try { localStorage.setItem('sgb.' + k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } };

export async function loadMeta() { meta = (await dbGet('meta', 'meta')) || null; return meta; }
export const hasMeta = () => !!meta;

async function adopt(raw, m, loaded) {
  rawDek = raw; key = await C.dekKey(raw); meta = m; items = loaded || {};
  lockListeners.forEach((f) => f(true));
}
// 최초 설정: 새 데이터 키 + 비밀번호 + 복구 키
export async function setup(password, recoveryKey) {
  const raw = C.rand(32);
  const m = await C.createMeta(password, recoveryKey, raw);
  await dbPut('meta', 'meta', m);
  await adopt(raw, m, {});
  await saveNow();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* 무시 */ }
}
async function loadState(k) {
  const b = await dbGet('kv', 'state');
  if (!b) return {};
  return (await C.openJSON(k, new Uint8Array(await b.arrayBuffer()))).items || {};
}
export async function unlock(secret) {
  if (!meta) return false;
  const raw = await C.unwrapAny(meta, secret);
  if (!raw) return false;
  const loaded = await loadState(await C.dekKey(raw));
  await adopt(raw, meta, loaded);
  return true;
}
// 복구 키로 열고 새 비밀번호 설정
export async function unlockWithRecovery(rk, newPassword) {
  const raw = await C.unwrap(meta, rk, 'rk');
  if (!raw) return false;
  const loaded = await loadState(await C.dekKey(raw));
  const m = await C.rewrapPw(meta, newPassword, raw);
  await dbPut('meta', 'meta', m);
  await adopt(raw, m, loaded);
  return true;
}
export async function verifyPassword(pw) { return !!(await C.unwrap(meta, pw, 'pw')); }
export async function changePassword(oldPw, newPw) {
  if (!(await verifyPassword(oldPw))) return false;
  meta = await C.rewrapPw(meta, newPw, rawDek); await dbPut('meta', 'meta', meta); return true;
}
export async function reissueRecoveryKey(pw) {
  if (!(await verifyPassword(pw))) return null;
  const rk = C.newRecoveryKey();
  meta = await C.rewrapRk(meta, rk, rawDek); await dbPut('meta', 'meta', meta); return rk;
}
export function lock() {
  if (!key) return;
  saveNow.flush && saveNow.flush();
  rawDek = null; key = null; items = {};
  lockListeners.forEach((f) => f(false));
}
export async function wipeAll() { rawDek = null; key = null; meta = null; items = {}; await dbClearAll(); lockListeners.forEach((f) => f(false)); }

// ---- 저장 ----
let dirty = false;
async function saveNow() {
  if (!key) return;
  dirty = false;
  const bytes = await C.sealJSON(key, { v: 1, items });
  await dbPut('kv', 'state', new Blob([bytes]));
}
const saveSoon = debounce(() => { saveNow().catch(console.error); }, 350);
export function flushSave() { if (dirty) { saveSoon.flush(); } }
saveNow.flush = () => { if (dirty) saveNow(); };
const touch = () => { dirty = true; saveSoon(); };
addEventListener('pagehide', () => { if (dirty) saveNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveNow(); });

// ---- 항목 API ----
export const get = (id) => { const i = items[id]; return i && !i.del ? i : null; };
export function create(t, props = {}) {
  const it = { id: uid(), t, u: Date.now(), o: nextOrder(t, props), ...props };
  items[it.id] = it; touch(); return it;
}
function nextOrder(t, p) {
  let m = 0; for (const i of Object.values(items)) if (i.t === t && !i.del && (p.sub == null || i.sub === p.sub) && (p.act == null || i.act === p.act) && (p.grade == null || i.grade === p.grade)) m = Math.max(m, (i.o ?? 0) + 1);
  return m;
}
export function patch(id, props) { const it = items[id]; if (!it) return null; Object.assign(it, props); it.u = Date.now(); touch(); return it; }
export function list(t, f) {
  return Object.values(items).filter((i) => i.t === t && !i.del && (!f || f(i))).sort((a, b) => (a.o ?? 0) - (b.o ?? 0) || a.u - b.u);
}
export function remove(id) {
  const it = items[id]; if (!it || it.del) return;
  const kids = it.t === 'sub' ? list('act', (a) => a.sub === id) : it.t === 'act' ? list('q', (q) => q.act === id) : [];
  kids.forEach((k) => remove(k.id));
  const m = it.t === 'rep' ? (it.media || []).map((x) => x.id) : [];
  if (it.t === 'rep') (it.items || []).forEach((r) => (r.takes || []).forEach((t) => m.push(t.id)));
  m.forEach((x) => deleteMedia(x));
  items[id] = { id, t: it.t, u: Date.now(), del: true, m };
  touch();
}
export function reorder(arr, i, d) {
  const j = i + d; if (j < 0 || j >= arr.length) return;
  const a = arr[i], b = arr[j]; const oa = a.o ?? i, ob = b.o ?? j;
  patch(a.id, { o: ob === oa ? ob + d : ob }); patch(b.id, { o: oa });
}
export const subOf = (a) => get(a.sub);
export const gradeActs = (grade) => list('act', (a) => { const s = get(a.sub); return s && s.grade === grade; });
export const hasData = () => Object.values(items).some((i) => !i.del);

// ---- 병합: 항목별로 수정 시각이 더 최근인 쪽을 살린다 (삭제도 기록으로 남김) ----
export function mergeItems(remote) {
  let n = 0;
  for (const [id, r] of Object.entries(remote)) {
    const l = items[id];
    if (!l || r.u > l.u) { items[id] = r; n++; if (r.del && r.m) r.m.forEach((x) => deleteMedia(x)); }
  }
  if (n) touch();
  return n;
}

// ---- 미디어(녹음/영상) ----
export async function saveMedia(blob) {
  const id = uid(); await dbPut('media', id, await C.sealBlob(key, blob)); return id;
}
export async function loadMedia(id, type) {
  const b = await dbGet('media', id); if (!b) return null; return C.openBlob(key, b, type);
}
export const hasMedia = async (id) => !!(await dbGet('media', id));
export async function deleteMedia(id) { try { await dbDel('media', id); } catch { /* 무시 */ } }
export const mediaKeys = () => dbKeys('media');

// ---- 백업 파일 (.saenggibu): [매직][헤더 길이][헤더 JSON][상태 암호문][미디어 암호문...] ----
const MAGIC = new TextEncoder().encode('SGBK1\n');
export async function exportBackup(withMedia) {
  saveNow.flush && saveNow.flush();
  const state = await C.sealJSON(key, { v: 1, items });
  const ids = []; const blobs = [];
  if (withMedia) {
    const used = new Set();
    for (const r of list('rep')) { (r.media || []).forEach((x) => used.add(x.id)); (r.items || []).forEach((q) => (q.takes || []).forEach((x) => used.add(x.id))); }
    for (const id of used) { const b = await dbGet('media', id); if (b) { ids.push({ id, len: b.size }); blobs.push(b); } }
  }
  const head = new TextEncoder().encode(JSON.stringify({ v: 1, created: Date.now(), meta, stateLen: state.length, media: ids }));
  const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length);
  return { blob: new Blob([MAGIC, len, head, state, ...blobs], { type: 'application/octet-stream' }), mediaCount: ids.length };
}
export async function readBackupHeader(file) {
  const top = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (top.length < MAGIC.length + 4 || MAGIC.some((b, i) => top[i] !== b)) throw new Error('백업 파일이 아니에요');
  const hl = new DataView(top.buffer).getUint32(MAGIC.length);
  if (hl > 5e6) throw new Error('손상된 파일이에요');
  const start = MAGIC.length + 4;
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(await file.slice(start, start + hl).arrayBuffer())));
  return { header, dataStart: start + hl };
}
// 비밀번호/복구 키로 백업을 열어 { items, media(로더) } 반환. 틀리면 null
export async function openBackup(file, secret) {
  const { header, dataStart } = await readBackupHeader(file);
  const raw = await C.unwrapAny(header.meta, secret);
  if (!raw) return null;
  const k = await C.dekKey(raw);
  const st = await C.openJSON(k, new Uint8Array(await file.slice(dataStart, dataStart + header.stateLen).arrayBuffer()));
  return { header, raw, k, items: st.items || {}, dataStart };
}
// 현재 기기에 병합(이미 데이터가 있어도 그대로 합쳐짐). 미디어는 현재 키로 다시 암호화해 저장
export async function mergeBackup(file, opened) {
  const before = Object.keys(items).length;
  const n = mergeItems(opened.items);
  let mediaIn = 0; let off = opened.dataStart + opened.header.stateLen;
  for (const m of opened.header.media || []) {
    const part = file.slice(off, off + m.len); off += m.len;
    if (await hasMedia(m.id)) continue;
    const plain = await C.openBlob(opened.k, part, 'application/octet-stream');
    await dbPut('media', m.id, await C.sealBlob(key, plain)); mediaIn++;
  }
  return { changed: n, added: Object.keys(items).length - before, mediaIn };
}
// 새 기기에서 백업으로 시작: 백업의 비밀번호/복구 키를 그대로 이어서 사용
export async function startFromBackup(file, opened) {
  await dbPut('meta', 'meta', opened.header.meta);
  await adopt(opened.raw, opened.header.meta, {});
  const r = await mergeBackup(file, opened);
  await saveNow();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* 무시 */ }
  return r;
}
