// 자료 탭: 자기소개 / 1·2·3학년 / 참고자료
import { h, icon, toast, modal, confirmBox, promptBox, pickFile, fmtDate } from './util.js';
import * as S from './store.js';
import { richField, tf, lastSel, extractHL, partitionHL, COLORS, COLOR_NAMES } from './hl.js';
import { extractText, pdfLines, parseSaenggibu, pdfPlainText, parseBulkText } from './files.js';
import { parseQA } from './qa.js';
import { ensureSubject, addActivity, applyEntries } from './intake.js';
import { openAIImport, openFilesBatch, openTour, openRefImport, openActAI } from './batch.js';
import { openQGen } from './qgen.js';
import { rerender, nav } from './app.js';

const GR = [['intro', '자기소개'], [1, '1학년'], [2, '2학년'], [3, '3학년'], ['ref', '참고자료']];

export function renderMat(root, st) {
  if (st.g == null) st.g = 1;
  if (S.pref('tour', 0) === 1) { S.setPref('tour', 2); setTimeout(openTour, 200); }
  if (st.sub) return subjectView(root, st);
  root.append(h('div', { class: 'seg', role: 'tablist' }, ...GR.map(([k, l]) => h('button', { class: st.g === k ? 'on' : '', onclick: () => { st.g = k; st.term = ''; rerender(); } }, l))));
  root.append(h('div', { class: 'stack mt' }, nudge(), st.g === 'intro' ? introView(st) : st.g === 'ref' ? refView(st) : gradeView(st)));
}

function nudge() {
  if (!S.hasData()) return null;
  const last = S.pref('lastBackup', 0); const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  if (last && days < 7) return null;
  return h('div', { class: 'note noprint' }, h('b', null, last ? `마지막 백업이 ${days}일 전이에요` : '아직 백업한 적이 없어요'),
    '브라우저 데이터는 사이트 데이터 삭제나 기기 문제로 사라질 수 있어요. 백업 파일을 만들어 두세요.',
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => nav('set', { focus: 'backup' }) }, '백업하러 가기')));
}

// ---------- 학년 화면 ----------
function gradeView(st) {
  const g = st.g;
  const subs = S.list('sub', (s) => s.grade === g);
  const wrap = h('div', { class: 'stack' });
  if (g === 3) wrap.append(h('div', { class: 'note' }, h('b', null, '3학년 생기부는 직접 입력이 필요할 수 있어요'),
    '3학년 생기부는 학교에서 공개되지 않는 경우가 많아요. 직접 입력하거나 활동 기록을 정리해 넣어 주세요.'));
  const tile = (title, desc, fn, solid) => h('button', { class: 'tile' + (solid ? ' solid' : ''), onclick: fn }, h('b', null, title), h('span', { class: 'd' }, desc));
  const ad = h('details', { class: 'adder', open: !subs.length },
    h('summary', null, `${g}학년 내용 추가하기`),
    h('div', { class: 'in' },
      h('div', { class: 'sech' }, '① 생기부 내용 넣기'),
      h('div', { class: 'tiles' },
        tile('생기부 PDF 올리기', '파일을 올리면 학년·과목·활동으로 자동 분류해요', () => importFlow(st), !subs.length),
        tile('글 붙여 넣기', '생기부 글을 통째로 붙여 넣으면 과목별로 나눠요 (3학년용)', () => bulkInput(st, g)),
        tile('과목 직접 만들기', '과목 이름을 정하고 원문을 직접 적어요', () => addSubject(st, g))),
      h('div', { class: 'sech' }, '② AI로 채우기'),
      h('div', { class: 'tiles' },
        tile('AI로 한 번에 입력', '내 활동 기록을 AI에 맡기고 코드를 붙여 넣어요', openAIImport),
        tile('예상질문 · 면접용 정리', '지원 대학·학과를 고르고 AI로 질문과 정리를 받아요', openQGen)),
      h('div', { class: 'sech' }, '③ 파일로 채우기'),
      h('div', { class: 'tiles' },
        tile('파일 여러 개 한꺼번에', '보고서·활동 설명 파일을 과목·활동에 나눠 넣어요', openFilesBatch))));
  wrap.append(ad);
  if (!subs.length) wrap.append(h('div', { class: 'empty' }, `${g}학년 과목이 아직 없어요. 생기부 파일(PDF)을 첨부하면 학년·과목으로 자동 분류하고, 파일이 없거나 비공개 학년이면 "직접 입력"으로 과목을 만들어 원문을 붙여 넣으세요.`));
  if (subs.length) wrap.append(h('div', { class: 'tiles' }, ...subs.map((s) => {
    const acts = S.list('act', (a) => a.sub === s.id);
    return h('button', { class: 'tile stile', onclick: () => { st.sub = s.id; st.act = null; window.scrollTo(0, 0); rerender(); } },
      h('span', { class: 'row tight' }, h('span', { class: 'dot c' + s.color }), h('b', null, s.name)),
      h('span', { class: 'sub' }, `활동 ${acts.length} · 완료 ${acts.filter((a) => a.done).length}`));
  })));
  return wrap;
}

async function addSubject(st, g) {
  const name = await promptBox(`${g}학년 과목 추가`, '과목명 (예: 국어, 동아리활동, 행동특성 및 종합의견)');
  if (!name || !name.trim()) return;
  const s = ensureSubject(g, name);
  if (!S.list('act', (a) => a.sub === s.id).length) addActivity(s.id);
  st.sub = s.id; st.act = null; rerender();
}

// ---------- 생기부 파일 첨부 → 분류 확인 ----------
async function importFlow(st) {
  const [f] = await pickFile('.pdf,.docx,.txt,.md,application/pdf');
  if (!f) return;
  toast('읽는 중…');
  let entries = [], note = '';
  try {
    if (f.name.toLowerCase().endsWith('.pdf')) {
      const pages = await pdfLines(f);
      entries = parseSaenggibu(pages);
      if (!entries.length) {
        const t = pdfPlainText(pages);
        if (!t) return toast('글자를 읽지 못했어요. 스캔(이미지) PDF는 지원하지 않아요. 텍스트가 들어 있는 PDF를 올려 주세요.');
        entries = [{ grade: typeof st.g === 'number' ? st.g : 1, label: '', kind: '', text: t }];
        note = '자동 분류에 실패해서 전체 글을 한 덩어리로 가져왔어요. 학년·과목을 정하고, 가져온 뒤 "활동 나누기"로 나눠 주세요.';
      }
    } else {
      const t = await extractText(f);
      if (!t) return toast('글자를 찾지 못했어요');
      entries = [{ grade: typeof st.g === 'number' ? st.g : 1, label: '', kind: '', text: t }];
      note = 'PDF가 아닌 파일은 자동 분류하지 않아요. 학년·과목을 정해 주세요.';
    }
  } catch (e) { console.error(e); return toast('파일을 읽지 못했어요: ' + e.message); }
  reviewImport(entries, note, st);
}

// 한꺼번에 입력: 3학년처럼 파일이 없을 때 생기부 글을 통째로 붙여 넣어 과목별로 나눈다
function bulkInput(st, g) {
  const gsel = h('select', { class: 'inp' }, ...[1, 2, 3].map((n) => h('option', { value: n, selected: n === (typeof st.g === 'number' ? st.g : g) }, n + '학년')));
  const ta = h('textarea', { class: 'inp', rows: 12, placeholder: '국어: 수업 시간에 ... 내용\n수학: 함수의 그래프를 ... 내용\n\n[동아리활동]\n활동 내용...' });
  const m = modal('생기부 한꺼번에 입력', h('div', null,
    h('div', { class: 'note' }, h('b', null, '이렇게 붙여 넣으세요'), '과목마다 "국어: 내용" 처럼 시작하거나, "[국어]" 같은 제목 줄을 따로 적으면 과목별로 나뉘어요. 엔터로 줄을 나눈 한 줄이 활동 하나가 돼요. 자율·동아리·진로활동, 행동특성도 같은 방식이에요.'),
    h('label', { class: 'lbl' }, '학년'), gsel, h('label', { class: 'lbl' }, '생기부 내용'), ta,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: () => {
      if (!ta.value.trim()) return toast('내용을 붙여 넣어 주세요');
      const entries = parseBulkText(ta.value, +gsel.value);
      m.close(); reviewImport(entries, `${entries.length}개 과목·영역으로 나눴어요. 이름과 내용을 확인하고 고쳐 주세요.`, st);
    } }, '나누기'))), { wide: true });
}

function reviewImport(entries, note, st) {
  const rows = entries.map((e) => ({ ...e, on: true }));
  let split = true;
  const list = h('div', { class: 'stack' });
  const draw = () => {
    list.replaceChildren(...rows.map((r) => {
      const n = r.text.split(/\n+/).filter((x) => x.trim()).length;
      const chk = h('input', { type: 'checkbox', checked: r.on, onchange: () => { r.on = chk.checked; } });
      const gsel = h('select', { class: 'inp', onchange: () => { r.grade = +gsel.value; } }, ...[1, 2, 3].map((k) => h('option', { value: k, selected: r.grade === k }, k + '학년')));
      const lab = h('input', { class: 'inp', value: r.label, placeholder: '과목/영역 이름', oninput: () => { r.label = lab.value; } });
      const ta = h('textarea', { class: 'inp', rows: 6, value: r.text, oninput: () => { r.text = ta.value; } });
      return h('div', { class: 'card' },
        h('label', { class: 'check' }, chk, h('b', null, `가져오기${r.kind ? ' · ' + r.kind : ''} · 문단 ${n}개`)),
        h('div', { class: 'row tight' }, h('div', { class: 'grow' }, gsel), h('div', { class: 'grow' }, lab)), h('label', { class: 'lbl' }, `원문 (${r.text.length.toLocaleString()}자 · 줄바꿈이 문단 경계)`), ta);
    }));
  };
  draw();
  const splitChk = h('input', { type: 'checkbox', checked: true, onchange: () => { split = splitChk.checked; } });
  const m = modal('분류 결과 확인', h('div', { class: 'stack' },
    h('div', { class: 'note' }, h('b', null, `${rows.length}개 항목을 찾았어요`), note || '자동 분류는 초안이에요. 학년과 과목 이름을 확인하고 필요하면 고쳐 주세요. 가져온 뒤에도 원문은 수정할 수 있어요.'),
    h('label', { class: 'check' }, splitChk, h('span', null, '문단마다 활동으로 나누기 (끄면 과목당 활동 하나)')),
    list,
    h('div', { class: 'row end' },
      h('button', { class: 'btn', onclick: () => m.close() }, '취소'),
      h('button', { class: 'btn solid', onclick: () => {
        const use = rows.filter((r) => r.on);
        if (!use.length) return toast('가져올 항목을 선택해 주세요');
        if (use.some((r) => !r.label.trim())) return toast('과목/영역 이름을 모두 입력해 주세요');
        const { made, skip } = applyEntries(use, split);
        m.close(); toast(`활동 ${made}개를 만들었어요${skip ? ` (중복 ${skip}개 건너뜀)` : ''}`);
        st.sub = null; if (use[0]) st.g = use[0].grade; rerender();
      } }, '가져오기'))), { wide: true });
}

// ---------- 과목 화면 ----------
function subjectView(root, st) {
  const sub = S.get(st.sub);
  if (!sub) { st.sub = null; return rerender(); }
  const acts = S.list('act', (a) => a.sub === sub.id);
  if (!acts.length) { addActivity(sub.id); return rerender(); }
  let act = acts.find((a) => a.id === st.act) || acts[0]; st.act = act.id;
  const idx = acts.indexOf(act);
  const subs = S.list('sub', (s) => s.grade === sub.grade);
  const si = subs.findIndex((s) => s.id === sub.id);

  root.append(h('div', { class: 'h-between' },
    h('button', { class: 'btn sm', onclick: () => { st.sub = null; st.term = ''; rerender(); } }, icon('back', 14), `${sub.grade}학년`),
    h('span', { class: 'row tight' },
      h('button', { class: 'btn sm', 'aria-label': '과목 위로', disabled: si === 0, onclick: () => { S.reorder(subs, si, -1); rerender(); } }, icon('up', 14)),
      h('button', { class: 'btn sm', 'aria-label': '과목 아래로', disabled: si === subs.length - 1, onclick: () => { S.reorder(subs, si, 1); rerender(); } }, icon('down', 14)))));
  root.append(h('div', { class: 'row' },
    h('h2', null, h('span', { class: 'dot c' + sub.color }), ' ', sub.name),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn sm', onclick: async () => { const n = await promptBox('과목 이름', '과목명', sub.name); if (n && n.trim()) { S.patch(sub.id, { name: n.trim() }); rerender(); } } }, '이름 수정'),
    h('button', { class: 'btn sm', onclick: () => colorPicker(sub) }, '색'),
    h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox(`"${sub.name}" 과목과 안의 모든 활동·질문이 삭제돼요.`, '삭제', true)) { S.remove(sub.id); st.sub = null; rerender(); } } }, '과목 삭제')));

  // 활동 선택줄
  root.append(h('div', { class: 'act-chips', style: null },
    ...acts.map((a, i) => h('button', { class: 'achip' + (a.id === act.id ? ' on' : ''), onclick: () => { st.act = a.id; st.term = ''; rerender(); } },
      h('span', { class: a.done ? 'donemark c' + sub.color : '' , style: null }, a.title || `활동 ${i + 1}`), a.imp ? h('span', { class: 'star' }, `★${a.imp}`) : null)),
    h('button', { class: 'achip', onclick: () => { const n = addActivity(sub.id); st.act = n.id; rerender(); } }, icon('plus', 14), '활동 추가')));

  root.append(actHeader(act, sub, acts, idx, st));

  const pane = st.pane || 'src';
  root.append(h('div', { class: 'seg only-m', style: null }, h('button', { class: pane === 'src' ? 'on' : '', onclick: () => { st.pane = 'src'; rerender(); } }, '생기부 원문'), h('button', { class: pane === 'mat' ? 'on' : '', onclick: () => { st.pane = 'mat'; rerender(); } }, '면접 준비 자료')));
  const mk = (key, label, ph, extra) => richField({ get: () => act[key] || tf(), set: (v) => S.patch(act.id, { [key]: v }), label, placeholder: ph, term: st.term, extra });

  // 왼쪽: 원문
  const srcField = mk('src', null, '생기부 원문을 붙여 넣거나 직접 입력하세요 (3학년은 직접 입력)', []);
  srcField.querySelector('.fhead').classList.remove('hidden');
  const left = h('div', { class: 'pane stickyl' + (pane === 'src' ? '' : ' hide-m') },
    h('div', { class: 'pane-title' }, '생기부 원문'), srcField,
    h('div', { class: 'srcbtns' },
      h('button', { class: 'btn', onmousedown: (e) => e.preventDefault(), onpointerdown: (e) => e.preventDefault(), onclick: () => splitActivity(act, srcField, st) }, '활동 나누기'),
      h('button', { class: 'btn', onclick: () => attachText(act, 'src', '생기부 원문') }, '원문 파일 첨부')),
    h('p', { class: 'sub', style: null }, '한 원문에 활동이 둘 이상이면: 나눌 위치를 한 번 누르거나(그 뒤를 새 활동으로), 따로 떼어낼 부분을 드래그한 뒤 "활동 나누기"를 누르세요.'));

  // 오른쪽: 활동 설명 · 보고서 원문(항상 펼쳐 보임) · 예상질문
  const attachBtn = h('button', { class: 'btn sm', onclick: () => attachText(act, 'rep', '보고서 원문') }, '파일 첨부');
  const right = h('div', { class: 'pane' + (pane === 'mat' ? '' : ' hide-m') },
    h('div', { class: 'pane-title' }, '면접 준비 자료'),
    h('div', { class: 'note' }, h('b', null, '활동 설명이 뭔가요?'),
      '면접관은 생기부 한 줄만 봐요. 그 한 줄이 실제로 어떤 활동이었는지 풀어 둔 설명자료를 첨부해 주세요. 방법은 세 가지예요.',
      h('div', { class: 'pre' }, '① 설명자료 제작 프롬프트를 복사해 AI에 넣고, 나온 결과를 붙여 넣기\n② 가지고 있는 보고서 원문을 아래 "보고서 원문" 칸에 넣기 (PDF·docx도 가능)\n③ 직접 정리해서 적기'),
      h('div', { class: 'sub' }, '활동 정리의 선정 조건은 양질의 자료를 위해 많은 자료를 참고해서 만들었어요.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => openActAI(act) }, '설명자료 프롬프트 복사 · 결과 붙여 넣기'))),
    mk('desc', '활동 설명', '활동 내용을 정리해서 적어 두세요', []),
    mk('rep', '보고서 원문', '보고서 원문을 붙여 넣거나 파일(PDF·docx·txt)로 첨부하면 여기에 바로 보여요', [attachBtn]),
    questions(act, st));
  root.append(h('div', { class: 'panes' }, left, right));
}

function actHeader(act, sub, acts, idx, st) {
  const title = h('input', { class: 'inp', value: act.title || '', placeholder: '활동 제목', 'aria-label': '활동 제목', oninput: () => S.patch(act.id, { title: title.value }) });
  title.addEventListener('change', () => rerender());
  const imp = h('div', { class: 'imp', role: 'group', 'aria-label': '중요도' }, ...[1, 2, 3].map((n) => h('button', { class: act.imp === n ? 'on' : '', 'aria-label': '중요도 ' + n, onclick: () => { S.patch(act.id, { imp: act.imp === n ? 0 : n }); rerender(); } }, n)));
  return h('div', { class: 'card', style: null },
    h('div', { class: 'row tight' }, h('div', { class: 'grow' }, title)),
    h('div', { class: 'row' },
      h('span', { class: 'sub' }, '중요도'), imp,
      h('button', { class: 'btn sm', 'aria-pressed': !!act.done, onclick: () => { S.patch(act.id, { done: !act.done }); rerender(); } },
        act.done ? h('span', { class: 'donemark c' + sub.color }, '완료됨') : '완료 표시'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', disabled: idx === 0, 'aria-label': '활동 앞으로', onclick: () => { S.reorder(acts, idx, -1); rerender(); } }, icon('up', 14)),
      h('button', { class: 'btn sm', disabled: idx === acts.length - 1, 'aria-label': '활동 뒤로', onclick: () => { S.reorder(acts, idx, 1); rerender(); } }, icon('down', 14)),
      h('button', { class: 'btn sm ghost-danger', onclick: async () => {
        if (!(await confirmBox(`"${act.title}" 활동과 예상질문이 삭제돼요.`, '삭제', true))) return;
        S.remove(act.id); st.act = null; rerender();
      } }, '삭제')));
}

function colorPicker(sub) {
  const m = modal('형광펜 색', h('div', { class: 'row' }, ...COLORS.map((c, i) => h('button', { class: 'btn c' + i, 'aria-label': COLOR_NAMES[i], onclick: () => { S.patch(sub.id, { color: i }); m.close(); rerender(); } }, (sub.color === i ? '✓ ' : '') + COLOR_NAMES[i]))));
}

async function attachText(act, key, label) {
  const [f] = await pickFile('.pdf,.docx,.txt,.md,application/pdf');
  if (!f) return;
  toast('읽는 중…');
  try {
    const t = await extractText(f);
    if (!t) return toast('글자를 찾지 못했어요. 스캔(이미지) 파일은 읽을 수 없어요.');
    const cur = act[key] || tf();
    if (cur.x && !(await confirmBox(`${label}에 이미 내용이 있어요. 기존 내용 뒤에 이어 붙일까요?`, '이어 붙이기'))) return;
    S.patch(act.id, { [key]: { x: cur.x ? cur.x + '\n\n' + t : t, h: cur.h || [] } });
    toast(`${label}을 넣었어요 (${t.length.toLocaleString()}자)`); rerender();
  } catch (e) { console.error(e); toast('파일을 읽지 못했어요: ' + e.message); }
}

// ---------- 활동 나누기 ----------
const trimHL = (hs, from, to) => hs.map((r) => ({ s: Math.max(r.s, from) - from, e: Math.min(r.e, to) - from, c: r.c })).filter((r) => r.e > r.s);
function splitActivity(act, field, st) {
  const rt = field.querySelector('.rt');
  const ls = rt && lastSel(rt);
  if (!ls) return toast('원문에서 나눌 위치를 누르거나, 떼어낼 부분을 드래그한 뒤 눌러 주세요.');
  const { x, h: hs } = act.src; const L = x.length;
  let keepX, keepH, newX, newH;
  const norm1 = (txt, hl) => { const lead = txt.length - txt.trimStart().length; const t = txt.trim(); return { x: t, h: trimHL(hl, lead, lead + t.length) }; };
  if (ls.s === ls.e) {
    if (ls.s <= 0 || ls.s >= L) return toast('원문 중간 위치를 눌러 주세요.');
    const { a, b } = partitionHL(hs, ls.s);
    const A = norm1(x.slice(0, ls.s), a), B = norm1(x.slice(ls.s), b);
    if (!A.x || !B.x) return toast('나눌 위치 앞뒤에 글자가 있어야 해요.');
    ({ x: keepX, h: keepH } = A); ({ x: newX, h: newH } = B);
  } else {
    const { ins, outs } = extractHL(hs, ls.s, ls.e);
    const piece = norm1(x.slice(ls.s, ls.e), ins);
    const rest = norm1(x.slice(0, ls.s) + x.slice(ls.e), outs);
    if (!piece.x) return toast('선택한 부분에 글자가 없어요.');
    ({ x: keepX, h: keepH } = rest); ({ x: newX, h: newH } = piece);
  }
  S.patch(act.id, { src: { x: keepX, h: keepH } });
  const n = addActivity(act.sub, { imp: act.imp, src: { x: newX, h: newH } });
  // 새 활동을 현재 활동 바로 뒤로
  const arr = S.list('act', (a) => a.sub === act.sub).filter((a) => a.id !== n.id);
  arr.splice(arr.findIndex((a) => a.id === act.id) + 1, 0, n);
  arr.forEach((a, i) => { if (a.o !== i) S.patch(a.id, { o: i }); });
  st.act = n.id; toast('새 활동으로 나눴어요');
  rerender();
}

// ---------- 예상질문 ----------
function questions(act, st) {
  const qs = S.list('q', (q) => q.act === act.id);
  st.rev = st.rev || new Set();
  const hide = S.pref('hideAns', false);
  const head = h('div', { class: 'h-between' }, h('b', null, `예상질문 ${qs.length}`),
    h('span', { class: 'row tight' },
      h('button', { class: 'btn sm', onclick: () => { S.setPref('hideAns', !hide); st.rev.clear(); rerender(); } }, hide ? '답변 보이기' : '답변 가리기'),
      h('button', { class: 'btn sm', onclick: () => textQuestions(act) }, '텍스트로 추가'),
      h('button', { class: 'btn sm', onclick: () => { S.create('q', { act: act.id, q: tf(), a: tf() }); rerender(); } }, icon('plus', 14), '질문 추가')));
  const box = h('div', { style: null });
  const wrap = h('section', { class: 'stack' }, head, box);
  if (!qs.length) box.append(h('div', { class: 'empty' }, '예상질문을 직접 적어 두세요. 모의면접에서 이 질문으로 연습해요.'));
  qs.forEach((q, i) => {
    const qf = richField({ get: () => q.q || tf(), set: (v) => S.patch(q.id, { q: v }), label: `질문 ${i + 1}`, placeholder: '예상질문', term: st.term });
    const shown = !hide || st.rev.has(q.id) || (q.a && !q.a.x && !st.term);
    const af = richField({ get: () => q.a || tf(), set: (v) => S.patch(q.id, { a: v }), label: '답변', placeholder: '답변을 적어 두세요', term: st.term });
    const ans = hide && !st.rev.has(q.id) && !(st.term && q.a && q.a.x && 0)
      ? h('button', { class: 'mask', 'aria-label': '답변 보기', onclick: () => { st.rev.add(q.id); rerender(); } }, h('span', null, '답변 가림 · 눌러서 확인'))
      : af;
    box.append(h('div', { class: 'q' },
      qf, ans,
      h('div', { class: 'qtools' },
        hide && st.rev.has(q.id) ? h('button', { class: 'btn sm', onclick: () => { st.rev.delete(q.id); rerender(); } }, '다시 가리기') : null,
        h('button', { class: 'btn sm', disabled: i === 0, 'aria-label': '위로', onclick: () => { S.reorder(qs, i, -1); rerender(); } }, icon('up', 14)),
        h('button', { class: 'btn sm', disabled: i === qs.length - 1, 'aria-label': '아래로', onclick: () => { S.reorder(qs, i, 1); rerender(); } }, icon('down', 14)),
        h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox('이 질문을 삭제할까요?', '삭제', true)) { S.remove(q.id); rerender(); } } }, '삭제'))));
  });
  return wrap;
}

// ---------- 자기소개 ----------
function introView(st) {
  const items = S.list('intro');
  const wrap = h('div', { class: 'stack' },
    h('div', { class: 'row tight' }, h('button', { class: 'btn solid', onclick: async () => {
      const u = await promptBox('자기소개 추가', '대학/전형 이름 (예: ○○대 학종)'); if (u == null) return;
      S.create('intro', { univ: u.trim() || '새 자기소개', body: tf() }); rerender();
    } }, icon('plus', 14), '자기소개 추가')));
  if (!items.length) wrap.append(h('div', { class: 'empty' }, '대학별로 자기소개를 따로 작성해 저장해요. 모의면접을 시작하면 첫 화면에 자기소개가 나와요.'));
  for (const it of items) {
    const title = h('input', { class: 'inp', value: it.univ, 'aria-label': '대학 이름', oninput: () => S.patch(it.id, { univ: title.value }) });
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'row tight' }, h('div', { class: 'grow' }, title),
        h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox('이 자기소개를 삭제할까요?', '삭제', true)) { S.remove(it.id); rerender(); } } }, '삭제')),
      h('div', { class: 'sep' }),
      richField({ get: () => it.body || tf(), set: (v) => S.patch(it.id, { body: v }), label: '자기소개', placeholder: '자기소개를 작성하세요', term: st.term })));
  }
  return wrap;
}

// ---------- 참고자료 ----------
function refView(st) {
  st.rf = st.rf || { grade: 'all', kind: 'all', q: '' };
  const all = S.list('ref');
  const kinds = [...new Set(all.map((r) => r.kind).filter(Boolean))];
  const f = st.rf;
  const shown = all.filter((r) => (f.grade === 'all' || r.grade === f.grade) && (f.kind === 'all' || r.kind === f.kind) );
  const wrap = h('div', { class: 'stack' },
    h('div', { class: 'tiles' },
      h('button', { class: 'tile', onclick: () => editRef(null, st) }, h('b', null, '직접 추가'), h('span', { class: 'd' }, '제목·종류를 적고 내용을 직접 입력해요')),
      h('button', { class: 'tile solid', onclick: openRefImport }, h('b', null, 'AI 프롬프트로 한 번에 추가'), h('span', { class: 'd' }, '자료를 붙여 넣고 프롬프트를 복사해 AI로 정리해요'))),
    h('div', { class: 'chips' },
      ...[['all', '전체'], [0, '공통'], [1, '1학년'], [2, '2학년'], [3, '3학년']].map(([k, l]) => h('button', { class: 'chip' + (f.grade === k ? ' on' : ''), onclick: () => { f.grade = k; rerender(); } }, l))),
    kinds.length ? h('div', { class: 'chips' }, ...[['all', '모든 종류'], ...kinds.map((k) => [k, k])].map(([k, l]) => h('button', { class: 'chip' + (f.kind === k ? ' on' : ''), onclick: () => { f.kind = k; rerender(); } }, l))) : null,
    null);
  if (!shown.length) wrap.append(h('div', { class: 'empty' }, all.length ? '조건에 맞는 참고자료가 없어요.' : '논문, 책, 기사, 보고서 등 활동에 쓴 참고자료를 모아 두는 곳이에요. 종류와 활용처를 함께 적어 두면 면접 때 찾기 쉬워요.'));
  for (const r of shown) {
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'h-between' }, h('b', null, r.title || '(제목 없음)'),
        h('span', { class: 'row tight' }, h('button', { class: 'btn sm', onclick: () => editRef(r, st) }, '정보 수정'),
          h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox('이 참고자료를 삭제할까요?', '삭제', true)) { S.remove(r.id); rerender(); } } }, '삭제'))),
      h('div', { class: 'chips' }, h('span', { class: 'tag' }, r.grade ? r.grade + '학년' : '공통'), r.kind ? h('span', { class: 'tag' }, r.kind) : null),
      h('div', { class: 'sep' }),
      ...[['desc', '설명', '자료가 어떤 내용인지'], ['usage', '활용처', '어느 활동·면접 질문에 쓰는지'], ['body', '자료 내용', '원문이나 요약을 붙여 넣으세요']].map(([k, l, p]) =>
        richField({ get: () => r[k] || tf(), set: (v) => S.patch(r.id, { [k]: v }), label: l, placeholder: p, term: st.term }))));
  }
  return wrap;
}
function editRef(r, st) {
  const title = h('input', { class: 'inp', value: r ? r.title : '', placeholder: '제목' });
  const kind = h('input', { class: 'inp', value: r ? r.kind || '' : '', placeholder: '종류 (예: 논문, 도서, 기사)' });
  const gr = h('select', { class: 'inp' }, ...[[0, '공통'], [1, '1학년'], [2, '2학년'], [3, '3학년']].map(([v, l]) => h('option', { value: v, selected: r ? r.grade === v : v === 0 }, l)));
  const m = modal(r ? '참고자료 정보' : '참고자료 추가', h('div', null,
    r ? null : h('button', { class: 'tile solid', onclick: () => { m.close(); openRefImport(); } }, h('b', null, 'AI 프롬프트로 한 번에 추가'), h('span', { class: 'd' }, '자료를 붙여 넣고 프롬프트를 복사해 AI로 정리해요')),
    h('label', { class: 'lbl' }, '제목'), title, h('label', { class: 'lbl' }, '종류'), kind, h('label', { class: 'lbl' }, '학년'), gr,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: () => {
      if (!title.value.trim()) return toast('제목을 입력해 주세요');
      const p = { title: title.value.trim(), kind: kind.value.trim(), grade: +gr.value };
      if (r) S.patch(r.id, p); else S.create('ref', { ...p, desc: tf(), usage: tf(), body: tf() });
      m.close(); rerender();
    } }, '저장'))));
}

function textQuestions(act) {
  const ta = h('textarea', { class: 'inp', rows: 9, placeholder: '질문을 한 줄에 하나씩 붙여 넣거나,\nQ. 질문\nA. 답변\n형식으로 붙여 넣으세요' });
  const info = h('p', { class: 'sub' });
  ta.addEventListener('input', () => { const n = parseQA(ta.value).length; info.textContent = n ? `질문 ${n}개를 찾았어요` : ''; });
  const m = modal('텍스트로 질문 추가', h('div', null, ta, info,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: () => {
      const items = parseQA(ta.value); if (!items.length) return toast('질문을 찾지 못했어요');
      const have = new Set(S.list('q', (q) => q.act === act.id).map((q) => q.q.x.trim()));
      let n = 0; for (const it of items) { if (have.has(it.q)) continue; S.create('q', { act: act.id, q: tf(it.q), a: tf(it.a) }); n++; }
      m.close(); toast(`질문 ${n}개를 추가했어요`); rerender();
    } }, '추가'))));
  setTimeout(() => ta.focus(), 30);
}
