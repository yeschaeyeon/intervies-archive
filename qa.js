// 예상질문 텍스트 분석 + 숨김 프롬프트 열기
import { PACK } from './qprompt.js';
import { kdf, open, unb64 } from './crypto.js';

export const packLocked = () => !!PACK.locked;

let cached = null;
// 프롬프트 묶음은 화면에 보이지 않고, 복사할 때만 메모리에서 풀어 쓴다 (실패하면 null)
async function openPack(code) {
  if (cached) return cached;
  try {
    const key = await kdf(PACK.locked ? String(code || '') : 'sgb-pack-v1', unb64(PACK.salt), 150000);
    const t = new TextDecoder().decode(await open(key, unb64(PACK.ct)));
    cached = t.startsWith('{') ? JSON.parse(t) : { questions: t };
    return cached;
  } catch { return null; }
}
// kind: 'imp' | 'organize' | 'questions', vars: {{이름}} 치환 값
export async function getPrompt(kind, code, vars = {}) {
  const pk = await openPack(code); if (!pk || !pk[kind]) throw new Error(packLocked() ? '이용 코드가 맞지 않아요.' : '프롬프트를 열 수 없어요.');
  return pk[kind].replace(/\{\{([^}]+)\}\}/g, (m, k) => (k in vars ? vars[k] : ''));
}
// 클릭 직후의 복사 권한을 지키려고 Promise를 그대로 넘긴다. 실패하면 null (프롬프트를 화면에 보여주지 않는다)
export async function copyText(getText) {
  const tp = Promise.resolve().then(() => (typeof getText === 'function' ? getText() : getText)); tp.catch(() => {});
  try {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': tp.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return true;
    }
  } catch { /* 아래에서 다시 시도 */ }
  const t = await tp; // 프롬프트를 못 열었으면 여기서 오류가 그대로 나간다
  try { await navigator.clipboard.writeText(t); return true; } catch { /* 아래로 */ }
  const ta = document.createElement('textarea'); ta.value = t; ta.className = 'hidden'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
  return ok;
}

const QRE = /^\s*(?:[-•·]\s*)?(?:Q|질문)\s*\d*\s*[.:：)\]]\s*(.*)$/i;
const ARE = /^\s*(?:[-•·]\s*)?(?:A|답변(?:\s*초안)?|모범\s*답변|답)\s*\d*\s*[.:：)\]]\s*(.*)$/i;
// "Q."가 빠져도 질문 형식(【1학년】 …, (공통) 【…)으로 시작하면 질문으로 본다
const QSTART = /^\s*(?:[-•·]|\d+[.)])?\s*(?:\([^)]{1,14}\)\s*)?【\s*\d\s*학년\s*】/;
const strip = (t) => t.replace(/^\s*(?:[-•·]|\d+[.)])\s*/, '').trim();
// "Q. 질문 / A. 답변" 형식. 표시가 하나도 없으면 한 줄에 질문 하나로 본다
export function parseQA(text) {
  const lines = String(text || '').replace(/\*\*|__/g, '').split(/\r?\n/);
  const marked = lines.some((l) => QRE.test(l) || QSTART.test(l));
  const out = []; let cur = null, field = 'q';
  for (const line of lines) {
    const t = line.trim(); if (!t) continue;
    if (!marked) { out.push({ q: strip(t), a: '' }); continue; }
    let m;
    if ((m = line.match(QRE))) { cur = { q: m[1].trim(), a: '' }; out.push(cur); field = 'q'; }
    else if (QSTART.test(line)) { cur = { q: strip(t), a: '' }; out.push(cur); field = 'q'; }
    else if (cur && (m = line.match(ARE))) { cur.a = m[1].trim(); field = 'a'; }
    else if (cur) cur[field] += (cur[field] ? '\n' : '') + t;
  }
  return out.filter((x) => x.q).map((x) => ({ q: x.q, a: x.a.trim().replace(/^\[([\s\S]*)\]$/, '$1').trim() }));
}

// AI 결과 전체: 활동 코드(6자리)가 있는 줄로 나뉜 블록 → [{ code, notes, items }]
// known(활동 코드 모음)을 주면 [[#코드]] 모양이 조금 달라져도(역슬래시, 대괄호 하나, 굵게 표시 등) 코드가 줄 안에 있기만 하면 찾는다
export function parseBatch(text, known, mode) {
  const clean = String(text || '').replace(/\\([\[\]#_*`])/g, '$1').replace(/［/g, '[').replace(/］/g, ']').replace(/\*\*|__/g, '').replace(/^\s*```.*$/gm, '');
  const blocks = []; let cur = null;
  for (const line of clean.split(/\r?\n/)) {
    let code = null;
    const m = line.match(/\[\[\s*#?\s*([0-9a-fA-F]{4,})\s*\]\]/);
    if (m && (!known || known.has(m[1].toLowerCase().slice(0, 6)))) code = m[1].toLowerCase();
    else if (known && line.length < 200 && !QRE.test(line) && !ARE.test(line)) {
      for (const t of line.match(/(?<![0-9a-zA-Z])[0-9a-fA-F]{6}(?![0-9a-zA-Z])/g) || []) if (known.has(t.toLowerCase())) { code = t.toLowerCase(); break; }
    }
    if (code) { cur = { code, lines: [] }; blocks.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return blocks.map((b) => {
    const i = b.lines.findIndex((l) => QRE.test(l) || QSTART.test(l));
    if (i < 0 && mode === 'q') return { code: b.code, notes: '', items: parseQA(b.lines.filter((l) => !/^\s*@/.test(l)).join('\n')) };
    const head = i < 0 ? b.lines : b.lines.slice(0, i);
    const notes = head.join('\n').replace(/^\s*@\s*(요약|풀이|용어|연결|점검)\s*[:：]?\s*/gm, '【$1】\n').trim();
    return { code: b.code, notes, items: parseQA(i < 0 ? '' : b.lines.slice(i).join('\n')) };
  }).filter((b) => b.items.length || b.notes);
}
