// 처음 설정 직후: 예상질문 / 면접 자료 만들기 (생기부 전체를 한 번에 프롬프트로 복사 → AI 결과 붙여 넣기)
import { h, clear, modal, toast } from './util.js';
import * as S from './store.js';
import { tf } from './hl.js';
import { getPrompt, copyText, packLocked, parseBatch } from './qa.js';
import { block } from './qgen.js';
import { targets, targetText, guideText, openTargetPicker } from './target.js';
import { parseBulkText } from './files.js';
import { applyEntries } from './intake.js';
import { openFilesBatch } from './batch.js';

const code6 = (a) => a.id.replace(/-/g, '').slice(0, 6);
const NOTE = '[답변 방식 — 꼭 지켜]\n전체 답변을 코드 블록(```) 하나 안에 넣어서 출력해. 코드 블록 밖에는 아무 글도 쓰지 마. 활동 줄 [[#코드]]는 한 글자도 바꾸지 말고 그대로 써.\n';

// AI 결과를 활동별로 나눠 넣기
export function distribute(text, mode) {
  const acts = S.list('act'); const known = new Set(acts.map(code6));
  const rows = [];
  for (const b of parseBatch(text, known, mode)) {
    const a = acts.find((x) => code6(x) === b.code.slice(0, 6)); if (a) rows.push({ a, notes: b.notes, items: b.items });
  }
  return rows;
}
export function applyRows(rows, withNotes) {
  let q = 0, n = 0;
  for (const r of rows) {
    const a = S.get(r.a.id); if (!a) continue;
    if (withNotes && r.notes && !a.desc.x.includes('【면접용 정리】')) { S.patch(a.id, { desc: { x: (a.desc.x.trim() ? a.desc.x.trim() + '\n\n' : '') + '【면접용 정리】\n' + r.notes, h: a.desc.h || [] } }); n++; }
    const have = new Set(S.list('q', (x) => x.act === a.id).map((x) => x.q.x.trim()));
    for (const it of r.items) { if (have.has(it.q.trim())) continue; S.create('q', { act: a.id, q: tf(it.q.trim()), a: tf(it.a || '') }); q++; }
  }
  return { q, n };
}

export function renderPrep(box, onEnter) {
  const done = { q: false, o: false };
  const hub = () => {
    clear(box); box.classList.remove('wide');
    const tile = (k, title, desc) => h('button', { class: 'tile big' + (done[k] ? '' : ' solid'), onclick: () => page(k) },
      h('b', null, (done[k] ? '✓ ' : '') + title), h('span', { class: 'd' }, done[k] ? '완료했어요. 눌러서 다시 할 수도 있어요.' : desc));
    const all = done.q && done.o;
    box.append(h('p', { class: 'sub' }, '5 / 5'), h('h1', null, '면접 준비 만들기'),
      h('p', null, '생기부 전체를 한 번에 AI에 맡겨서 예상질문과 면접 자료를 만들어요. 두 가지를 끝내면 준비가 끝난 채로 아카이브에 들어가요.'),
      h('div', { class: 'tiles two' },
        tile('q', '예상질문', '생기부 전체에서 면접관이 물을 만한 질문을 활동별로 받아요'),
        tile('o', '면접 자료 생성', '보고서 파일을 넣고, 활동마다 풀이·약점 점검·답변 초안을 받아요')),
      h('div', { class: 'stack mt' },
        h('button', { class: 'btn block' + (all ? ' solid' : ''), onclick: onEnter }, all ? '아카이브 입장' : '나중에 하고 입장')));
  };

  function page(kind) {
    clear(box);
    const q = kind === 'q';
    const opt = { n: 5, ans: !q, grade: 'all' };
    const code = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드' });
    const tgt = h('div', { class: 'stack' }); const stat = h('div', { class: 'stack' }); const copies = h('div', { class: 'stack' });
    const res = h('textarea', { class: 'inp tall', rows: 9, placeholder: 'AI가 준 코드 블록을 통째로 붙여 넣으세요. 나눠서 받았다면 이어서 계속 붙여 넣으면 돼요.' });
    const found = h('p', { class: 'sub' });
    const acts = () => S.list('act', (a) => { const s = S.get(a.sub); return s && (a.src.x.trim() || a.desc.x.trim()) && (opt.grade === 'all' || s.grade === opt.grade); });
    const batches = () => {
      const per = q ? Math.max(4, Math.floor(9000 / (opt.n * (opt.ans ? 430 : 110)))) : 4;
      const out = []; let cur = [], size = 0;
      for (const a of acts()) { const len = block(a, { mode: kind === 'o' ? 'o' : 'q', extra: true }).length; if (cur.length && (cur.length >= per || size + len > 16000)) { out.push(cur); cur = []; size = 0; } cur.push(a); size += len; }
      if (cur.length) out.push(cur); return out;
    };
    const drawT = () => tgt.replaceChildren(h('b', null, '1. 지원 대학·학과'),
      targets().length ? h('div', { class: 'pre' }, targets().map((t) => `${t.univ} ${t.dept}`).join('\n')) : h('p', { class: 'sub' }, '고르면 안내문에 자동으로 들어가요. 여러 곳도 괜찮아요.'),
      h('div', { class: 'row' }, h('button', { class: 'btn' + (targets().length ? '' : ' solid'), onclick: () => openTargetPicker(() => { drawT(); drawCopies(); }) }, targets().length ? '바꾸기 · 추가' : '대학·학과 선택')));
    const inspect = () => {
      const rows = distribute(res.value, kind); const qn = rows.reduce((n, r) => n + r.items.length, 0);
      found.textContent = res.value.trim() ? (rows.length ? `활동 ${rows.length}개 · 질문 ${qn}개를 찾았어요` : '아직 활동 코드를 찾지 못했어요. 코드 블록 전체를 붙여 넣었는지 확인해 주세요.') : '';
      drawCopies();
    };
    const drawCopies = () => {
      const bs = batches(); const txt = res.value.toLowerCase();
      copies.replaceChildren(
        h('p', { class: 'sub' }, `내 생기부 활동 ${acts().length}개를 ${bs.length}번에 나눠 복사해요. AI는 한 번에 쓸 수 있는 답변 길이가 정해져 있어서 자동으로 나눠요.`),
        h('div', { class: 'chips' }, ...bs.map((b, i) => {
          const hit = b.filter((a) => txt.includes(code6(a))).length;
          return h('button', { class: 'btn' + (hit === b.length ? '' : hit ? '' : ' solid'), disabled: !targets().length, onclick: () => copyBatch(b, i) },
            `${i + 1}번 복사${hit === b.length ? ' ✓' : hit ? ` (${hit}/${b.length})` : ''}`);
        })));
    };
    async function copyBatch(b, i) {
      try {
        const ok = await copyText(async () => {
          const cnt = `활동마다 ${opt.n}개${opt.ans ? '' : ' (답변 초안은 쓰지 말고 A. 줄은 생략)'}`;
          const p = await getPrompt(q ? 'questions' : 'organize', code.value, { 지원: targetText(), 개수: cnt, 가이드: guideText() });
          return `${p}\n${NOTE}\n[활동 목록]\n${b.map((a) => block(a, { mode: kind, extra: true })).join('\n\n-----\n\n')}\n`;
        });
        toast(ok ? `${i + 1}번을 복사했어요. AI에 붙여 넣으세요.` : '복사하지 못했어요. 클립보드 권한을 확인해 주세요.');
      } catch (e) { toast(e.message || '복사하지 못했어요'); }
    }
    const grades = h('div', { class: 'chips' }, ...[['all', '전체'], [1, '1학년'], [2, '2학년'], [3, '3학년']].map(([k, l]) => h('button', { class: 'chip' + (opt.grade === k ? ' on' : ''), onclick: () => { opt.grade = k; page(kind); } }, l)));
    const missing = h('button', { class: 'btn', onclick: () => pasteGrade(drawCopies) }, '파일에 없는 학년 글 붙여 넣기 (3학년 등)');
    clear(box); box.classList.add('wide');
    const left = h('div', { class: 'col' }), right = h('div', { class: 'col' });
    left.append(h('div', { class: 'note' }, h('b', null, q ? '예상질문이란?' : '면접 자료 생성이란?'),
        q ? '생기부 문장을 인용해 면접관이 물을 만한 질문을 활동별로 골라 줘요. 올린 생기부를 글로 바꿔 안내문에 담았으니 복사해서 AI에 붙여 넣기만 하면 돼요.'
          : '생기부 한 줄이 실제로 어떤 활동이었는지 풀어 주는 설명자료예요. 요약·단계별 풀이·약점 점검·질문과 답변 초안이 활동 설명 칸에 들어가요. 보고서 파일을 먼저 넣으면 더 정확해져요.',
        h('div', { class: 'sub' }, '선정 조건은 양질의 자료를 위해 많은 자료를 참고해서 만들었어요. 복사한 내용은 AI 서비스로 전송되니 믿을 수 있는 서비스에서만 쓰세요.')));
    if (!q) left.append(h('div', { class: 'card stack' }, h('b', null, '보고서 파일 수동 입력'), h('p', { class: 'sub' }, '보고서·활동 설명 파일(PDF·docx·txt)을 여러 개 올리고 파일마다 학년·과목·활동을 골라요. 없으면 건너뛰어도 돼요.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openFilesBatch(drawCopies) }, '보고서 파일 넣기'))));
    left.append(h('div', { class: 'card stack' }, tgt),
      h('div', { class: 'card stack' }, h('b', null, '2. 범위와 옵션'), grades, missing,
        q ? h('div', { class: 'row tight' }, h('span', null, '활동당 질문'), h('select', { class: 'inp', onchange: (e) => { opt.n = +e.target.value; drawCopies(); } }, ...[3, 4, 5, 6, 7].map((n) => h('option', { value: n, selected: n === opt.n }, n + '개')))) : null,
        q ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { opt.ans = e.target.checked; drawCopies(); } }), h('span', null, '답변 초안도 함께 받기 (복사 횟수가 늘어요)')) : null,
        packLocked() ? code : null));
    right.append(h('div', { class: 'card stack' }, h('b', null, '3. 프롬프트 복사 → AI에 붙여 넣기'), copies),
      h('div', { class: 'card stack' }, h('b', null, '4. AI가 준 코드 붙여 넣기'), res, found,
        h('button', { class: 'btn solid block', onclick: () => {
          const rows = distribute(res.value, kind);
          if (!rows.length) return toast('활동 코드를 찾지 못했어요. AI가 준 코드 블록 전체를 붙여 넣어 주세요.');
          const r = applyRows(rows, !q); done[kind] = true;
          toast(q ? `예상질문 ${r.q}개를 활동별로 넣었어요` : `활동 ${r.n}개 정리, 질문 ${r.q}개를 넣었어요`); hub();
        } }, '완료')));
    box.append(h('div', { class: 'prephead' }, h('button', { class: 'btn sm', onclick: hub }, '← 돌아가기'), h('h1', null, q ? '예상질문' : '면접 자료 생성')),
      h('div', { class: 'prepgrid' }, left, right));
    res.addEventListener('input', inspect);
    drawT(); drawCopies();
  }

  function pasteGrade(after) {
    const g = h('select', { class: 'inp' }, ...[1, 2, 3].map((n) => h('option', { value: n, selected: n === 3 }, n + '학년')));
    const ta = h('textarea', { class: 'inp', rows: 10, placeholder: '국어: 수업 시간에 ... 내용\n수학: 확률 단원에서 ... 내용\n\n[동아리활동]\n활동 내용...' });
    const m = modal('생기부 글 붙여 넣기', h('div', null,
      h('div', { class: 'note' }, '과목마다 "국어: 내용"처럼 시작하거나 "[국어]" 제목 줄을 적으면 과목별로 나뉘고, 엔터로 나눈 한 줄이 활동 하나가 돼요.'),
      h('label', { class: 'lbl' }, '학년'), g, ta,
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: () => {
        if (!ta.value.trim()) return toast('내용을 붙여 넣어 주세요');
        const es = parseBulkText(ta.value, +g.value); if (!es.length) return toast('과목을 나누지 못했어요');
        const r = applyEntries(es, true); m.close(); after(); toast(`활동 ${r.made}개를 만들었어요`);
      } }, '넣기'))), { wide: true });
  }
  hub();
}
