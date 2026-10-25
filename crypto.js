// 암호화 계층: PBKDF2 → KEK, 무작위 DEK(데이터 키)를 비밀번호/복구 키 두 곳에 각각 감싸 보관
const enc = new TextEncoder();
const dec = new TextDecoder();
export const PW_ITER = 600000;
export const RK_ITER = 150000;      // 복구 키는 160비트 무작위라 반복 횟수를 낮춰도 안전
export const CHUNK = 4 * 1024 * 1024;
const RK_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export function b64(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function kdf(secret, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const dekKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

function params(iv, i) { const p = { name: 'AES-GCM', iv }; if (i != null) p.additionalData = aad(i); return p; }
function aad(i) { return new Uint8Array([i >>> 24, i >>> 16, i >>> 8, i].map((x) => x & 255)); }
export async function seal(key, bytes, idx) {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt(params(iv, idx), key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
}
export async function open(key, bytes, idx) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.decrypt(params(u.subarray(0, 12), idx), key, u.subarray(12)));
}
export const sealJSON = (key, obj) => seal(key, enc.encode(JSON.stringify(obj)));
export async function openJSON(key, bytes) { return JSON.parse(dec.decode(await open(key, bytes))); }

// 큰 파일(녹음/영상)은 4MB 조각으로 나눠 암호화(메모리 절약, 조각 순서 변조 방지)
export async function sealBlob(key, blob) {
  const parts = []; let i = 0;
  for (let off = 0; off < blob.size || (off === 0 && i === 0); off += CHUNK, i++) {
    parts.push(await seal(key, new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer()), i));
    if (blob.size === 0) break;
  }
  return new Blob(parts);
}
export async function openBlob(key, blob, type) {
  const step = CHUNK + 28; const parts = []; let i = 0;
  for (let off = 0; off < blob.size; off += step, i++) parts.push(await open(key, await blob.slice(off, off + step).arrayBuffer(), i));
  return new Blob(parts, { type });
}

// ---- 복구 키 ----
export function newRecoveryKey() {
  const bytes = rand(20); let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += RK_ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return out.match(/.{4}/g).join('-');
}
export const normRK = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---- 메타(감싼 키) 생성/해제 ----
export async function createMeta(password, recoveryKey, rawDek) {
  const sp = rand(16), sr = rand(16);
  const kp = await kdf(password, sp, PW_ITER), kr = await kdf(normRK(recoveryKey), sr, RK_ITER);
  return { v: 1, pw: { salt: b64(sp), iter: PW_ITER, wrap: b64(await seal(kp, rawDek)) }, rk: { salt: b64(sr), iter: RK_ITER, wrap: b64(await seal(kr, rawDek)) } };
}
// 성공 시 raw DEK, 실패 시 null
export async function unwrap(meta, secret, kind) {
  const m = meta[kind]; if (!m) return null;
  try { return await open(await kdf(kind === 'rk' ? normRK(secret) : secret, unb64(m.salt), m.iter), unb64(m.wrap)); } catch { return null; }
}
export async function unwrapAny(meta, secret) {
  return (await unwrap(meta, secret, 'pw')) || (await unwrap(meta, secret, 'rk'));
}
export async function rewrapPw(meta, password, rawDek) {
  const sp = rand(16); const kp = await kdf(password, sp, PW_ITER);
  return { ...meta, pw: { salt: b64(sp), iter: PW_ITER, wrap: b64(await seal(kp, rawDek)) } };
}
export async function rewrapRk(meta, recoveryKey, rawDek) {
  const sr = rand(16); const kr = await kdf(normRK(recoveryKey), sr, RK_ITER);
  return { ...meta, rk: { salt: b64(sr), iter: RK_ITER, wrap: b64(await seal(kr, rawDek)) } };
}
