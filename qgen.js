// 예상질문 일괄 만들기: 프롬프트+활동 목록 복사 → (AI에서 생성) → 결과 붙여넣기/파일 → 활동별로 자동 배분
import { h, modal, toast, pickFile, confirmBox } from './util.js';
import * as S from './store.js';
import { tf } from './hl.js';
import { extractText } from './files.js';
import { getPrompt, copyText, packLocked, parseBatch } from './qa.js';
import { targets, targetText, guideText, openTargetPicker } from './target.js';
import { rerender } from './app.js';

const code6 = (a) => a.id.replace(/-/g, '').slice(0, 6);
const lim = (t, n) => (t.length > n ? t.slice(0, n) + '…(이하 생략)' : t);

export function block(a, opt) {
  const s = S.get(a.sub);
  const parts = [`[[#${code6(a)}]] ${s ? s.grade + '학년 · ' + s.name : ''} · ${a.title || '활동'}`];
  if (opt.mode === 'o') parts.push(`중요도: ${a.imp || 2}`);
  if (a.src.x.trim()) parts.push('<생기부 원문>\n' + a.src.x.trim());
  if (opt.extra) {
    if (a.desc && a.desc.x.trim()) parts.push('<활동 설명>\n' + lim(a.desc.x.trim(), 3000));
    if (a.rep && a.rep.x.trim()) parts.push('<보고서 원문>\n' + lim(a.rep.x.trim(), 4000));
  }
  return parts.join('\n');
}

export function openQGen() {
  const f = { mode: 'q', grade: 'all', onlyEmpty: true, n: 5, ans: true, extra: true, replace: false, code: '' };
  const body = h('div', { class: 'stack' });
  const m = modal('예상질문 일괄 만들기', body, { wide: true });

  const eligible = () => S.list('act', (a) => {
    const s = S.get(a.sub); if (!s || (f.grade !== 'all' && s.grade !== f.grade)) return false;
    if (!(a.src.x.trim() || (a.desc && a.desc.x.trim()))) return false;
    if (!f.onlyEmpty) return true;
    return f.mode === 'o' ? !(a.desc && a.desc.x.includes('【면접용 정리】')) : !S.list('q', (q) => q.act === a.id && q.q.x.trim()).length;
  });
  const batches = () => {
    const out = []; let cur = [], size = 0;
    for (const a of eligible()) {
      const len = block(a, f).length;
      if (cur.length && (size + len > (f.mode === 'o' ? 10000 : 16000) || cur.length >= (f.mode === 'o' ? 5 : 10))) { out.push(cur); cur = []; size = 0; }
      cur.push(a); size += len;
    }
    if (cur.length) out.push(cur);
    return out;
  };

  function draw() {
    const bs = batches(); const total = bs.reduce((n, b) => n + b.length, 0);
    const codeIn = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드', value: f.code, oninput: (e) => { f.code = e.target.value; } });
    body.replaceChildren(
      h('div', { class: 'note' }, h('b', null, f.mode === 'o' ? '활동 정리란?' : '예상질문 뽑기란?'),
        f.mode === 'o'
          ? '생기부 한 줄이 실제로 어떤 활동이었는지 면접용으로 풀어 주는 설명자료예요. 요약, 단계별 풀이, 핵심 용어, 다른 활동과의 연결, 약점 점검, 예상 질문과 답변 초안이 만들어지고, 결과는 각 활동의 "활동 설명" 칸에 들어가요.'
          : '지원 대학·학과에 맞춰 면접관이 물을 만한 활동을 고르고 질문과 답변 초안을 만들어요. 결과는 활동별 "예상질문" 칸에 나눠 들어가요.',
        h('div', { class: 'sub' }, '어떤 활동을 고르고 어떤 질문을 만들지의 선정 조건은 양질의 자료를 위해 많은 자료를 참고해서 만들었어요.')),
      h('div', { class: 'note' }, h('b', null, '이 기능은 AI 서비스를 직접 이용해요'),
        '앱은 서버와 통신하지 않아요. ① 아래 버튼으로 복사한 내용을 평소 쓰는 AI(ChatGPT·Claude 등)에 붙여 넣고 ② AI가 만든 답을 ③ 아래 칸에 붙여 넣으면 활동별로 자동 배분돼요. 복사하는 내용에는 생기부 원문이 들어가니, 믿을 수 있는 AI 서비스에서만 쓰세요.'),
      h('div', { class: 'chips' }, ...[['q', '예상질문 뽑기'], ['o', '활동 면접용 정리']].map(([k, l]) => h('button', { class: 'chip' + (f.mode === k ? ' on' : ''), onclick: () => { f.mode = k; draw(); } }, l))),
      h('div', { class: 'card stack' }, h('b', null, '지원 대학·학과'),
        targets().length ? h('div', { class: 'pre' }, targets().map((t) => `${t.univ} ${t.dept}`).join('\n')) : h('p', { class: 'sub' }, '아직 선택하지 않았어요. 고르면 안내문에 자동으로 들어가요.'),
        h('div', { class: 'row' }, h('button', { class: 'btn' + (targets().length ? '' : ' solid'), onclick: () => openTargetPicker(draw) }, targets().length ? '바꾸기 · 추가' : '대학·학과 선택'))),
      h('div', { class: 'card stack' }, h('b', null, '1. 범위와 옵션'),
        h('div', { class: 'chips' }, ...[['all', '전체'], [1, '1학년'], [2, '2학년'], [3, '3학년']].map(([k, l]) => h('button', { class: 'chip' + (f.grade === k ? ' on' : ''), onclick: () => { f.grade = k; draw(); } }, l))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.onlyEmpty, onchange: (e) => { f.onlyEmpty = e.target.checked; draw(); } }), h('span', null, f.mode === 'o' ? '아직 정리하지 않은 활동만' : '예상질문이 아직 없는 활동만')),
        f.mode === 'o' ? h('p', { class: 'sub' }, '정리 깊이는 활동의 중요도(1~3)를 따라요. 중요도를 정하지 않은 활동은 2로 처리해요.') : h('div', { class: 'row tight' }, h('span', null, '활동당 질문'), h('select', { class: 'inp', onchange: (e) => { f.n = +e.target.value; } }, ...[3, 4, 5, 6, 7, 8].map((n) => h('option', { value: n, selected: f.n === n }, n + '개')))),
        f.mode === 'o' ? null : h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.ans, onchange: (e) => { f.ans = e.target.checked; } }), h('span', null, '모범답변(답변 방향)도 받기')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.extra, onchange: (e) => { f.extra = e.target.checked; draw(); } }), h('span', null, '활동 설명·보고서 원문도 함께 보내기')),
        packLocked() ? h('div', null, h('label', { class: 'lbl' }, '이용 코드 (제작자에게 받은 코드)'), codeIn) : null),
      h('div', { class: 'card stack' }, h('b', null, `2. 복사해서 AI에 붙여 넣기 · 활동 ${total}개`),
        !bs.length ? h('p', { class: 'sub' }, '조건에 맞는 활동이 없어요. 원문이 있는 활동이 필요해요.') : h('p', { class: 'sub' }, '활동이 많으면 여러 번으로 나눠서 복사해요. 번호 순서대로 각각 AI에 붙여 넣으세요.'),
        h('div', { class: 'chips' }, ...bs.map((b, i) => h('button', { class: 'btn', disabled: !targets().length, onclick: () => copyBatch(b, i) }, `${i + 1}번 복사 (활동 ${b.length}개)`)))),
      resultCard());
  }

  async function copyBatch(b, i) {
    if (!targets().length) return toast('먼저 지원 대학·학과를 선택해 주세요');
    try {
      const ok = await copyText(async () => {
        const kind = f.mode === 'o' ? 'organize' : 'questions';
        const cnt = `활동마다 ${f.n}개${f.ans ? '' : ' (답변 초안은 쓰지 말고 A. 줄은 생략)'}`;
        const p = await getPrompt(kind, f.code, { 지원: targetText(), 개수: cnt, 가이드: guideText() });
        return `${p}\n[활동 목록]\n${b.map((a) => block(a, f)).join('\n\n-----\n\n')}\n`;
      });
      toast(ok ? `${i + 1}번을 복사했어요. AI에 붙여 넣으세요.` : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.');
    } catch (e) { toast(e.message || '복사하지 못했어요'); }
  }

  function resultCard() {
    const ta = h('textarea', { class: 'inp', rows: 8, placeholder: 'AI가 만든 결과를 여기에 붙여 넣으세요 (여러 번 나눠 받았으면 이어서 붙여 넣어도 돼요)' });
    const prev = h('div', { class: 'stack' });
    let parsed = [];
    const analyze = () => {
      parsed = parseBatch(ta.value);
      const acts = S.list('act'); const rows = []; let miss = 0;
      for (const p of parsed) {
        const a = acts.find((x) => code6(x) === p.code.slice(0, 6) || x.id.replace(/-/g, '').startsWith(p.code));
        if (!a) { miss++; continue; }
        rows.push({ a, items: p.items, notes: p.notes });
      }
      parsed = rows;
      prev.replaceChildren(
        h('p', null, `활동 ${rows.length}개에 질문 ${rows.reduce((n, r) => n + r.items.length, 0)}개를 배분해요.` + (miss ? ` (맞는 활동을 찾지 못한 묶음 ${miss}개는 제외)` : '')),
        ...rows.slice(0, 40).map((r) => { const s = S.get(r.a.sub); return h('div', { class: 'list-item' }, h('span', { class: 'grow' }, `${s ? s.grade + '학년 · ' + s.name : ''} · ${r.a.title}`), h('span', { class: 'tag' }, (r.notes ? '정리·' : '') + r.items.length + '개')); }),
        rows.length ? h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { f.replace = e.target.checked; } }), h('span', null, '기존 질문은 지우고 새 질문으로 교체')) : null,
        rows.length ? h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: apply }, '활동에 적용')) : h('p', { class: 'sub' }, '[[#코드]] 표시가 있는 결과를 붙여 넣어 주세요. 코드는 복사한 활동 목록에 들어 있어요.'));
    };
    async function apply() {
      if (f.replace && !(await confirmBox('선택한 활동의 기존 예상질문이 모두 삭제돼요.', '교체', true))) return;
      let n = 0;
      for (const r of parsed) {
        if (f.mode === 'o' && r.notes && !r.a.desc.x.includes('【면접용 정리】')) S.patch(r.a.id, { desc: { x: (r.a.desc.x.trim() ? r.a.desc.x.trim() + '\n\n' : '') + '【면접용 정리】\n' + r.notes, h: r.a.desc.h || [] } });
        const old = S.list('q', (q) => q.act === r.a.id);
        if (f.replace) old.forEach((q) => S.remove(q.id));
        const have = new Set(f.replace ? [] : old.map((q) => q.q.x.trim()));
        for (const it of r.items) { if (have.has(it.q.trim())) continue; S.create('q', { act: r.a.id, q: tf(it.q.trim()), a: tf((it.a || '').trim()) }); n++; }
      }
      m.close(); toast(`예상질문 ${n}개를 활동별로 넣었어요` + (f.mode === 'o' ? ' (정리는 활동 설명 칸에 들어갔어요)' : '')); rerender();
    }
    return h('div', { class: 'card stack' }, h('b', null, '3. AI 결과 붙여 넣기'), ta,
      h('div', { class: 'row tight' },
        h('button', { class: 'btn', onclick: async () => { const [file] = await pickFile('.txt,.md,.docx,.pdf'); if (!file) return; try { const t = await extractText(file); ta.value = ta.value ? ta.value + '\n' + t : t; analyze(); } catch (e) { toast('파일을 읽지 못했어요: ' + e.message); } } }, '파일로 넣기'),
        h('button', { class: 'btn solid', onclick: analyze }, '분석하기')), prev);
  }
  draw();
}
