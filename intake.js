// 가져오기 공통: 과목/활동 만들기, 분류 결과 적용, AI 코드 해석, 활동 정리 프롬프트
import * as S from './store.js';
import { tf } from './hl.js';

function pickColor(grade) {
  const used = new Set(S.list('sub', (s) => s.grade === grade).map((s) => s.color));
  for (let i = 0; i < 6; i++) if (!used.has(i)) return i;
  return used.size % 6;
}
export function ensureSubject(grade, name) {
  name = name.trim();
  return S.list('sub', (s) => s.grade === grade && s.name === name)[0] || S.create('sub', { grade, name, color: pickColor(grade) });
}
export function addActivity(sub, props = {}) {
  const n = S.list('act', (a) => a.sub === sub).length + 1;
  return S.create('act', { sub, title: `활동 ${n}`, imp: 0, done: false, src: tf(), desc: tf(), rep: tf(), ...props });
}
export function autoTitle(piece) {
  const t = piece.replace(/^\s*(?:\(\s*\d\s*학기\s*\))?[^:\n]{1,18}:\s*/, '').trim() || piece.trim();
  return t.length > 16 ? t.slice(0, 16) + '…' : t || '활동';
}

// 분류 결과(rows: {grade,label,text}) → 과목/활동. split이면 문단마다 활동
export function applyEntries(rows, split = true) {
  let made = 0, skip = 0;
  for (const r of rows) {
    const s = ensureSubject(r.grade, r.label);
    const exist = S.list('act', (a) => a.sub === s.id);
    const paras = r.text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const pieces = split ? paras : [paras.join('\n')];
    let reuse = exist.length === 1 && !exist[0].src.x && !exist[0].desc.x && !exist[0].rep.x ? exist[0] : null;
    for (const piece of pieces) {
      if (S.list('act', (a) => a.sub === s.id).some((a) => a.src.x.trim() === piece)) { skip++; continue; }
      if (reuse) { S.patch(reuse.id, { src: tf(piece), title: autoTitle(piece) }); reuse = null; }
      else addActivity(s.id, { src: tf(piece), title: autoTitle(piece) });
      made++;
    }
  }
  return { made, skip };
}

// ---------- AI 코드 (@@ 표시) ----------
const KEYS = { 학년: 'grade', 과목: 'subject', 활동: 'title', 원문: 'src', 생기부: 'src', 설명: 'desc', 활동설명: 'desc', 보고서: 'rep', 질문: 'qs', 예상질문: 'qs', 중요도: 'imp' };
export function parseImportCode(text) {
  const acts = []; let grade = 0, subject = '', cur = null, field = null;
  const lines = String(text || '').replace(/＠/g, '@').split(/\r?\n/);
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) continue;
    const m = raw.match(/^\s*@@\s*([가-힣]+)\s*(.*)$/);
    if (m && KEYS[m[1].replace(/\s/g, '')]) {
      const k = KEYS[m[1].replace(/\s/g, '')], v = m[2].trim();
      if (k === 'grade') { grade = +(v.match(/[123]/) || [0])[0]; field = null; continue; }
      if (k === 'subject') { subject = v; field = null; cur = null; continue; }
      if (k === 'title') { cur = { grade, subject, title: v, src: '', desc: '', rep: '', qs: '', imp: 0 }; acts.push(cur); field = null; continue; }
      if (!cur) { cur = { grade, subject, title: '', src: '', desc: '', rep: '', qs: '', imp: 0 }; acts.push(cur); }
      if (k === 'imp') { cur.imp = Math.min(3, +(v.match(/[123]/) || [0])[0]); field = null; continue; }
      field = k; if (v) cur[k] += v + '\n';
      continue;
    }
    if (m && /^끝$/.test(m[1])) { field = null; continue; }
    if (cur && field) cur[field] += raw + '\n';
  }
  return acts.map((a) => ({ ...a, src: a.src.trim(), desc: a.desc.trim(), rep: a.rep.trim(), qsText: a.qs })).filter((a) => a.subject && (a.title || a.src || a.desc || a.rep || a.qs.trim()));
}

// 해석한 활동을 앱에 넣기. 같은 과목의 같은 제목 활동이 있으면 비어 있는 칸과 새 질문만 채운다
export function applyImportCode(acts, parseQA) {
  let made = 0, merged = 0, qn = 0;
  for (const a of acts) {
    const sub = ensureSubject(a.grade || 1, a.subject);
    const title = a.title || autoTitle(a.src || a.desc || a.rep);
    let act = S.list('act', (x) => x.sub === sub.id && x.title === title)[0];
    if (!act) {
      const only = S.list('act', (x) => x.sub === sub.id);
      const blank = only.length === 1 && !only[0].src.x && !only[0].desc.x && !only[0].rep.x ? only[0] : null;
      if (blank) { act = blank; S.patch(act.id, { title }); } else act = addActivity(sub.id, { title });
      made++;
    } else merged++;
    const patch = {};
    if (a.src && !act.src.x.trim()) patch.src = tf(a.src);
    if (a.desc && !act.desc.x.trim()) patch.desc = tf(a.desc);
    if (a.rep && !act.rep.x.trim()) patch.rep = tf(a.rep);
    if (a.imp && !act.imp) patch.imp = a.imp;
    if (Object.keys(patch).length) S.patch(act.id, patch);
    const have = new Set(S.list('q', (q) => q.act === act.id).map((q) => q.q.x.trim()));
    for (const it of parseQA(a.qsText)) { if (have.has(it.q)) continue; S.create('q', { act: act.id, q: tf(it.q), a: tf(it.a) }); qn++; }
  }
  return { made, merged, qn };
}

// ---------- 참고자료 AI 코드 ----------
const RK = { 종류: 'kind', 학년: 'grade', 설명: 'desc', 활용처: 'usage', 내용: 'body', 면접문장: 'line' };
export function parseRefCode(text) {
  const out = []; let cur = null, field = null;
  for (const raw of String(text || '').replace(/＠/g, '@').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) continue;
    const m = raw.match(/^\s*@@\s*([가-힣]+)\s*(.*)$/);
    if (m && m[1] === '참고') { cur = { title: m[2].trim(), kind: '', grade: 0, desc: '', usage: '', body: '', line: '' }; out.push(cur); field = null; continue; }
    if (m && cur && RK[m[1]]) {
      const k = RK[m[1]], v = m[2].trim();
      if (k === 'grade') { cur.grade = +(v.match(/[123]/) || [0])[0]; field = null; }
      else if (k === 'kind') { cur.kind = v; field = null; }
      else { field = k; if (v) cur[k] += v + '\n'; }
      continue;
    }
    if (cur && field) cur[field] += raw + '\n';
  }
  return out.map((r) => ({ ...r, desc: r.desc.trim(), usage: r.usage.trim(), line: r.line.trim(), body: (r.body.trim() + (r.line.trim() ? '\n\n【면접 문장】\n' + r.line.trim() : '')).trim() })).filter((r) => r.title);
}
export function applyRefCode(refs) {
  let made = 0, merged = 0;
  for (const r of refs) {
    const ex = S.list('ref', (x) => x.title === r.title)[0];
    if (ex) { merged++; const p = {}; if (!(ex.desc && ex.desc.x.trim()) && r.desc) p.desc = tf(r.desc); if (!(ex.usage && ex.usage.x.trim()) && r.usage) p.usage = tf(r.usage); if (!(ex.body && ex.body.x.trim()) && r.body) p.body = tf(r.body); if (Object.keys(p).length) S.patch(ex.id, p); continue; }
    S.create('ref', { title: r.title, kind: r.kind, grade: r.grade, desc: tf(r.desc), usage: tf(r.usage), body: tf(r.body) }); made++;
  }
  return { made, merged };
}
