// 한 번에 입력: AI 코드 붙여넣기 / 파일 여러 개 / 첫 안내
import { h, modal, toast, pickFile, confirmBox } from './util.js';
import * as S from './store.js';
import { extractText } from './files.js';
import { parseQA, getPrompt, copyText, packLocked } from './qa.js';
import { parseRefCode, applyRefCode, parseImportCode, applyImportCode, ensureSubject, addActivity } from './intake.js';
import { tf } from './hl.js';
import { rerender } from './app.js';
import { parseBatch } from './qa.js';
import { block } from './qgen.js';
import { targets, targetText, openTargetPicker } from './target.js';


// ---------- AI로 한 번에 입력 ----------
export function openAIImport() {
  const mine = h('textarea', { class: 'inp', rows: 6, placeholder: '내 활동 기록을 여기에 붙여 넣으세요 (생기부 문장, 활동 설명, 보고서 글, 예상질문 등 아무거나, 과목이 섞여 있어도 돼요)' });
  const res = h('textarea', { class: 'inp', rows: 8, placeholder: 'AI가 준 코드를 여기에 붙여 넣으세요 (@@학년, @@과목 … 으로 된 글)' });
  const prev = h('div', { class: 'stack' });
  const code = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드' });
  let acts = [];
  const analyze = () => {
    acts = parseImportCode(res.value);
    if (!acts.length) { prev.replaceChildren(h('p', { class: 'err' }, '코드를 찾지 못했어요. AI가 준 코드 블록 전체를 붙여 넣어 주세요.')); return; }
    const qn = acts.reduce((n, a) => n + parseQA(a.qsText).length, 0);
    prev.replaceChildren(
      h('p', null, `활동 ${acts.length}개 · 예상질문 ${qn}개를 찾았어요.`),
      ...acts.slice(0, 40).map((a) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, `${a.grade ? a.grade + '학년' : '학년 미정(1학년)'} · ${a.subject} · ${a.title || '(제목 없음)'}`), h('span', { class: 'tag' }, [a.src && '원문', a.desc && '설명', a.rep && '보고서', parseQA(a.qsText).length && '질문'].filter(Boolean).join('·')))),
      h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: () => {
        const r = applyImportCode(acts, parseQA); m.close(); rerender();
        toast(`활동 ${r.made}개 추가${r.merged ? `, ${r.merged}개는 기존 활동에 합침` : ''}, 질문 ${r.qn}개`);
      } }, '앱에 넣기')));
  };
  const m = modal('AI로 한 번에 입력', h('div', { class: 'stack' },
    h('div', { class: 'note' }, h('b', null, '이렇게 하세요'),
      h('div', { class: 'pre' }, '① 아래에 내 활동 기록을 붙여 넣고 "프롬프트 복사"를 눌러요. (비워 두면 안내문만 복사돼요)\n② 복사한 내용을 평소 쓰는 AI(ChatGPT·Claude 등)에 붙여 넣어요. AI가 설명 없이 코드만 줘요.\n③ AI가 준 코드를 ③번 칸에 붙여 넣고 "분석하기"를 눌러요. 학년·과목·활동·질문이 자동으로 들어가요.\n※ 이 앱은 서버가 없어서 AI와 직접 연결되지 않아요. 내 기록이 AI 서비스로 전송되니 믿을 수 있는 서비스에서만 쓰세요.')),
    h('div', { class: 'card stack' }, h('b', null, '1. 내 활동 기록 (선택)'), mine, packLocked() ? code : null,
      h('div', { class: 'row' }, h('button', { class: 'btn solid', onclick: async () => {
        try {
          const ok = await copyText(async () => (await getPrompt('imp', code.value)) + (mine.value.trim() ? `\n[내 활동 기록]\n${mine.value.trim()}\n` : '\n[내 활동 기록]\n(이 메시지에 기록이 없으면 "준비됐어요"라고만 답하고, 내가 다음 메시지로 보내는 내용을 위 규칙대로 처리해 줘)\n'));
          toast(ok ? '복사했어요. AI에 붙여 넣으세요.' : '복사하지 못했어요. 클립보드 권한을 확인해 주세요.');
        } catch (e) { toast(e.message || '복사하지 못했어요'); }
      } }, '2. 프롬프트 복사'))),
    h('div', { class: 'card stack' }, h('b', null, '3. AI가 준 코드 붙여 넣기'), res,
      h('div', { class: 'row tight' }, h('button', { class: 'btn', onclick: async () => { const [f] = await pickFile('.txt,.md'); if (!f) return; res.value = await f.text(); analyze(); } }, '파일로 넣기'), h('button', { class: 'btn solid', onclick: analyze }, '분석하기')), prev)), { wide: true });
}

// ---------- 파일 여러 개 한꺼번에 ----------
const FIELDS = [['rep', '보고서 원문'], ['desc', '활동 설명'], ['src', '생기부 원문']];
export function openFilesBatch(onDone) {
  const rows = []; const list = h('div', { class: 'stack' });
  const subNames = (g) => [...new Set(S.list('sub', (s) => s.grade === g).map((s) => s.name))];
  const draw = () => {
    list.replaceChildren(...rows.map((r, i) => {
      const gsel = h('select', { class: 'inp', onchange: () => { r.grade = +gsel.value; r.sub = ''; r.act = ''; draw(); } }, ...[1, 2, 3].map((k) => h('option', { value: k, selected: r.grade === k }, k + '학년')));
      const dl = h('datalist', { id: 'dl' + i }, ...subNames(r.grade).map((n) => h('option', { value: n })));
      const sub = h('input', { class: 'inp', list: 'dl' + i, value: r.sub, placeholder: '과목 (고르거나 새로 입력)', oninput: () => { r.sub = sub.value; }, onchange: () => { r.act = ''; draw(); } });
      const ex = S.list('sub', (s) => s.grade === r.grade && s.name === r.sub.trim())[0];
      const acts = ex ? S.list('act', (a) => a.sub === ex.id) : [];
      const asel = h('select', { class: 'inp', onchange: () => { r.act = asel.value; } }, h('option', { value: '' }, '새 활동으로 만들기'), ...acts.map((a) => h('option', { value: a.id, selected: r.act === a.id }, a.title)));
      const fsel = h('select', { class: 'inp', onchange: () => { r.field = fsel.value; } }, ...FIELDS.map(([k, l]) => h('option', { value: k, selected: r.field === k }, l + '(으)로')));
      return h('div', { class: 'card stack' }, h('div', { class: 'h-between' }, h('b', null, r.file.name), h('button', { class: 'btn sm', onclick: () => { rows.splice(i, 1); draw(); } }, '빼기')),
        h('div', { class: 'row tight' }, h('div', { class: 'grow' }, gsel), h('div', { class: 'grow' }, sub, dl)),
        h('div', { class: 'row tight' }, h('div', { class: 'grow' }, asel), h('div', { class: 'grow' }, fsel)));
    }));
    if (!rows.length) list.append(h('p', { class: 'sub' }, '파일을 여러 개 골라 주세요. 파일마다 어느 학년·과목·활동에 넣을지 정할 수 있어요.'));
  };
  const add = async () => {
    const fs = await pickFile('.pdf,.docx,.txt,.md,application/pdf', true);
    const last = rows[rows.length - 1];
    for (const file of fs) rows.push({ file, grade: last ? last.grade : 1, sub: last ? last.sub : '', act: '', field: last ? last.field : 'rep' });
    draw();
  };
  const go = h('button', { class: 'btn solid', onclick: async () => {
    if (!rows.length) return toast('파일을 먼저 골라 주세요');
    if (rows.some((r) => !r.sub.trim())) return toast('모든 파일의 과목을 입력해 주세요');
    go.disabled = true; let n = 0, bad = 0;
    for (const r of rows) {
      try {
        const t = await extractText(r.file); if (!t) { bad++; continue; }
        const s = ensureSubject(r.grade, r.sub);
        let a = r.act && S.get(r.act);
        if (!a) a = addActivity(s.id, { title: r.file.name.replace(/\.[^.]+$/, '').slice(0, 30) });
        const cur = a[r.field] || tf();
        S.patch(a.id, { [r.field]: { x: cur.x ? cur.x + '\n\n' + t : t, h: cur.h || [] } }); n++;
      } catch (e) { console.error(e); bad++; }
    }
    m.close(); rerender(); if (typeof onDone === 'function') onDone(); toast(`파일 ${n}개를 넣었어요${bad ? ` (${bad}개는 읽지 못함)` : ''}`);
  } }, '모두 넣기');
  const m = modal('파일 여러 개 한꺼번에', h('div', { class: 'stack' },
    h('div', { class: 'note' }, '보고서·활동 설명 파일을 한 번에 올려요. 같은 과목이면 위 파일의 선택이 다음 파일에 이어져요. 사진·스캔 파일은 읽을 수 없어요.'),
    list, h('div', { class: 'row tight' }, h('button', { class: 'btn', onclick: add }, '+ 파일 고르기'), go)), { wide: true });
  draw();
}

// ---------- 처음 들어왔을 때 안내 ----------
export function openTour() {
  const m = modal('이제 기록을 채워 볼까요?', h('div', { class: 'stack' },
    h('div', { class: 'note' }, h('b', null, '3학년 기록 · 예상질문 · 보고서 · 활동 설명'), '하나씩 입력하지 않아도 돼요. 아래 방법으로 한 번에 넣을 수 있어요.'),
    h('div', { class: 'card' }, h('b', null, '① AI로 한 번에 입력'), h('p', { class: 'sub' }, '안내문을 내 AI에 붙여 넣고 활동 기록을 보내면, AI가 코드를 줘요. 그 코드를 앱에 붙여 넣으면 학년·과목·활동·질문이 자동으로 채워져요.')),
    h('div', { class: 'card' }, h('b', null, '② 파일 여러 개 한꺼번에'), h('p', { class: 'sub' }, '보고서나 활동 설명 파일을 여러 개 올리고, 파일마다 학년·과목·활동을 골라요.')),
    h('div', { class: 'card' }, h('b', null, '③ 예상질문 일괄 만들기'), h('p', { class: 'sub' }, '내 생기부 전체의 예상질문을 AI로 한 번에 뽑아 활동별로 나눠 넣어요.')),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '나중에'), h('button', { class: 'btn solid', onclick: () => { m.close(); openAIImport(); } }, 'AI로 한 번에 입력'))));
}

// ---------- 참고자료 AI 정리 ----------
export function openRefImport() {
  const mine = h('textarea', { class: 'inp', rows: 8, placeholder: '정리할 참고자료를 붙여 넣으세요 (책·기사·논문 내용, 읽고 쓴 메모 등). 여러 개면 사이에 줄 하나(-----)를 넣어 주세요' });
  const res = h('textarea', { class: 'inp', rows: 8, placeholder: 'AI가 준 코드를 여기에 붙여 넣으세요 (@@참고, @@종류 … 으로 된 글)' });
  const code = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드' });
  const withActs = h('input', { type: 'checkbox', checked: true });
  const prev = h('div', { class: 'stack' }); const tgt = h('div', { class: 'stack' });
  const drawT = () => tgt.replaceChildren(h('b', null, '지원 대학·학과'),
    targets().length ? h('div', { class: 'pre' }, targets().map((t) => `${t.univ} ${t.dept}`).join('\n')) : h('p', { class: 'sub' }, '고르지 않아도 되지만, 고르면 전공 연결이 더 정확해져요.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openTargetPicker(drawT) }, targets().length ? '바꾸기 · 추가' : '대학·학과 선택')));
  drawT();
  const actList = () => S.list('act', (a) => S.get(a.sub) && a.src.x.trim()).map((a) => { const s = S.get(a.sub); return `${s.grade}학년 · ${s.name} · ${a.title}: ${a.src.x.trim().slice(0, 200)}`; }).join('\n');
  let refs = [];
  const analyze = () => {
    refs = parseRefCode(res.value);
    if (!refs.length) return prev.replaceChildren(h('p', { class: 'err' }, '코드를 찾지 못했어요. AI가 준 코드 블록 전체를 붙여 넣어 주세요.'));
    prev.replaceChildren(h('p', null, `참고자료 ${refs.length}개를 찾았어요.`),
      ...refs.slice(0, 40).map((r) => h('div', { class: 'list-item' }, h('span', { class: 'grow' }, r.title), h('span', { class: 'tag' }, (r.grade ? r.grade + '학년' : '공통') + (r.kind ? ' · ' + r.kind : '')))),
      h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: () => { const r = applyRefCode(refs); m.close(); rerender(); toast(`참고자료 ${r.made}개 추가${r.merged ? `, ${r.merged}개는 기존 자료에 합침` : ''}`); } }, '앱에 넣기')));
  };
  const m = modal('AI로 참고자료 정리', h('div', { class: 'stack' },
    h('div', { class: 'note' }, h('b', null, '이렇게 하세요'),
      h('div', { class: 'pre' }, '① 정리할 자료를 붙여 넣고 "복사"를 눌러요.\n② 복사한 내용을 평소 쓰는 AI에 붙여 넣어요. AI가 설명 없이 코드만 줘요.\n③ AI가 준 코드를 아래 칸에 붙여 넣고 "분석하기"를 눌러요.\n※ 자료가 AI 서비스로 전송되니 믿을 수 있는 서비스에서만 쓰세요.')),
    h('div', { class: 'card stack' }, tgt),
    h('div', { class: 'card stack' }, h('b', null, '1. 정리할 참고자료'), mine, packLocked() ? code : null,
      h('label', { class: 'check' }, withActs, h('span', null, '내 생기부 활동도 함께 보내서 연결하기')),
      h('div', { class: 'row' }, h('button', { class: 'btn solid', onclick: async () => {
        if (!mine.value.trim()) return toast('정리할 자료를 붙여 넣어 주세요');
        try {
          const ok = await copyText(async () => (await getPrompt('ref', code.value, { 지원: targetText() || '(선택 안 함)' })) + `\n[참고자료]\n${mine.value.trim()}\n` + (withActs.checked && actList() ? `\n[내 생기부 활동]\n${actList()}\n` : ''));
          toast(ok ? '복사했어요. AI에 붙여 넣으세요.' : '복사하지 못했어요. 클립보드 권한을 확인해 주세요.');
        } catch (e) { toast(e.message || '복사하지 못했어요'); }
      } }, '2. 복사'))),
    h('div', { class: 'card stack' }, h('b', null, '3. AI가 준 코드 붙여 넣기'), res,
      h('div', { class: 'row tight' }, h('button', { class: 'btn', onclick: async () => { const [f] = await pickFile('.txt,.md'); if (!f) return; res.value = await f.text(); analyze(); } }, '파일로 넣기'), h('button', { class: 'btn solid', onclick: analyze }, '분석하기')), prev)), { wide: true });
}

const code6a = (a) => a.id.replace(/-/g, '').slice(0, 6);
// ---------- 활동 하나의 설명자료 만들기 (프롬프트 복사 → AI → 결과 붙여 넣기) ----------
export function openActAI(act) {
  const code = h('input', { class: 'inp', type: 'password', placeholder: '이용 코드' });
  const tgt = h('div', { class: 'stack' });
  const drawT = () => tgt.replaceChildren(h('b', null, '지원 대학·학과'),
    targets().length ? h('div', { class: 'pre' }, targets().map((t) => `${t.univ} ${t.dept}`).join('\n')) : h('p', { class: 'sub' }, '먼저 지원 대학·학과를 골라 주세요.'),
    h('div', { class: 'row' }, h('button', { class: 'btn' + (targets().length ? '' : ' solid'), onclick: () => openTargetPicker(drawT) }, targets().length ? '바꾸기 · 추가' : '대학·학과 선택')));
  drawT();
  const res = h('textarea', { class: 'inp', rows: 8, placeholder: 'AI가 준 결과를 여기에 붙여 넣으세요' });
  const copy = h('button', { class: 'btn solid', onclick: async () => {
    if (!targets().length) return toast('먼저 지원 대학·학과를 선택해 주세요');
    try {
      const a = S.get(act.id);
      const ok = await copyText(async () => (await getPrompt('organize', code.value, { 지원: targetText(), 개수: '', 가이드: '' })) + `\n[활동 목록]\n${block(a, { mode: 'o', extra: true })}\n`);
      toast(ok ? '복사했어요. AI에 붙여 넣으세요.' : '복사하지 못했어요. 클립보드 권한을 확인해 주세요.');
    } catch (e) { toast(e.message || '복사하지 못했어요'); }
  } }, '1. 프롬프트 복사');
  const m = modal('설명자료 만들기', h('div', { class: 'stack' },
    h('div', { class: 'note' }, h('b', null, '이렇게 하세요'),
      h('div', { class: 'pre' }, '① 대학·학과를 고르고 "프롬프트 복사"를 눌러요. 이 활동의 생기부 원문이 함께 복사돼요.\n② 자기 AI에 붙여 넣고, AI가 만든 결과를 아래 칸에 붙여 넣어요.\n③ "활동에 넣기"를 누르면 설명은 활동 설명 칸에, 질문은 예상질문 칸에 들어가요.\n※ 생기부 내용이 AI 서비스로 전송되니 믿을 수 있는 서비스에서만 쓰세요.')),
    h('div', { class: 'card stack' }, tgt),
    h('div', { class: 'card stack' }, packLocked() ? code : null, copy),
    h('div', { class: 'card stack' }, h('b', null, '2. AI 결과 붙여 넣기'), res,
      h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: () => {
        const blocks = parseBatch(res.value, new Set([code6a(act)]));
        if (!blocks.length) return toast('결과를 찾지 못했어요. AI가 만든 답 전체를 붙여 넣어 주세요.');
        const a = S.get(act.id); const notes = blocks.map((b) => b.notes).filter(Boolean).join('\n\n');
        if (notes && !a.desc.x.includes('【면접용 정리】')) S.patch(a.id, { desc: { x: (a.desc.x.trim() ? a.desc.x.trim() + '\n\n' : '') + '【면접용 정리】\n' + notes, h: a.desc.h || [] } });
        const have = new Set(S.list('q', (q) => q.act === a.id).map((q) => q.q.x.trim())); let n = 0;
        for (const b of blocks) for (const it of b.items) { if (have.has(it.q.trim())) continue; S.create('q', { act: a.id, q: tf(it.q.trim()), a: tf(it.a || '') }); n++; }
        m.close(); rerender(); toast(`설명자료를 넣었어요${n ? ` (질문 ${n}개)` : ''}`);
      } }, '활동에 넣기')))), { wide: true });
}
