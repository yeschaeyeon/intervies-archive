// 프롬프트(입력 정리·활동 정리·예상질문)를 암호화해서 js/qprompt.js 로 만드는 도구 (브라우저/Node 공용)
const enc = new TextEncoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const PACK_ITER = 150000;
export async function buildPack(text, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', enc.encode(code || 'sgb-pack-v1'), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PACK_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return { v: 1, locked: !!code, salt: b64(salt), ct: b64(out) };
}
export const toModule = (pack) => `// 자동 생성 파일 (tools/prompt-pack.html 로 만든 암호화된 프롬프트 묶음). 직접 수정하지 마세요.\nexport const PACK = ${JSON.stringify(pack)};\n`;
