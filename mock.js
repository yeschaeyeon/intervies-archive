// 모의면접 탭: 면접 시작 / 모의면접 만들기 / 리포트
import { h, icon, toast, confirmBox, promptBox, pickFile, fmtDate, fmtDur, fmtSize, modal } from './util.js';
import * as S from './store.js';
import { tf, richField } from './hl.js';
import { rerender, setBusy, nav } from './app.js';
import { UNIS, targets } from './target.js';

const WEIGHT = { 3: 5, 2: 3, 1: 1, 0: 1 };
let session = null, ticker = null, rec = null; // rec: 진행 중 녹음 { r, mr, stream, chunks }

S.onLockChange((open) => { if (!open) abortSession(); });
function abortSession() {
  try { if (rec) { rec.mr.onstop = null; rec.mr.stop(); rec.stream.getTracks().forEach((t) => t.stop()); } } catch { /* 무시 */ }
  rec = null; session = null; clearInterval(ticker); setBusy(false);
}

export function renderMock(root, st) {
  if (session) return runView(root, st);
  st.m = st.m || 'start';
  root.append(h('div', { class: 'seg' }, ...[['start', '면접 시작'], ['make', '모의면접 만들기'], ['prof', '교수님'], ['rep', '리포트']].map(([k, l]) => h('button', { class: st.m === k ? 'on' : '', onclick: () => { st.m = k; st.rep = null; st.edit = null; rerender(); } }, l))));
  const body = h('div', { class: 'stack' });
  root.append(h('div', { class: 'stack' }, body));
  body.before(h('div', { class: 'row tight' }));
  (st.m === 'start' ? startView : st.m === 'make' ? makeView : st.m === 'prof' ? profView : reportView)(body, st);
}

// ================= 면접 시작 =================
function startView(root, st) {
  const f = st.f || (st.f = { imp: new Set([3, 2, 1, 0]), off: new Set(), n: 2, intro: true, introId: null });
  root.append(univCard());
  const subs = S.list('sub');
  const pool = () => S.list('act', (a) => {
    const s = S.get(a.sub); if (!s || f.off.has(s.id) || !f.imp.has(a.imp || 0)) return false;
    return S.list('q', (q) => q.act === a.id && q.q.x.trim()).length > 0;
  });
  const p = pool(); const qn = p.reduce((n, a) => n + S.list('q', (q) => q.act === a.id && q.q.x.trim()).length, 0);
  const intros = S.list('intro');

  root.append(h('div', { class: 'card' }, h('b', null, '중요도'),
    h('div', { class: 'chips' }, ...[[3, '3'], [2, '2'], [1, '1'], [0, '미지정']].map(([k, l]) => h('button', { class: 'chip' + (f.imp.has(k) ? ' on' : ''), onclick: () => { f.imp.has(k) ? f.imp.delete(k) : f.imp.add(k); rerender(); } }, l)))));
  const gcards = [];
  for (const g of [1, 2, 3]) {
    const gs = subs.filter((s) => s.grade === g); if (!gs.length) continue;
    gcards.push(h('div', null, h('div', { class: 'row tight' }, h('b', null, g + '학년'), h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: () => { const all = gs.every((s) => !f.off.has(s.id)); gs.forEach((s) => (all ? f.off.add(s.id) : f.off.delete(s.id))); rerender(); } }, '전체 선택/해제')),
      h('div', { class: 'chips' }, ...gs.map((s) => h('button', { class: 'chip' + (f.off.has(s.id) ? '' : ' on'), onclick: () => { f.off.has(s.id) ? f.off.delete(s.id) : f.off.add(s.id); rerender(); } }, h('span', { class: 'dot c' + s.color }), s.name)))));
  }
  root.append(h('div', { class: 'card stack' }, h('b', null, '학년 · 과목'), ...(gcards.length ? gcards : [h('div', { class: 'empty' }, '자료 탭에서 과목과 예상질문을 먼저 입력해 주세요.')])));
  root.append(h('div', { class: 'card' }, h('b', null, '활동당 질문 수'),
    h('div', { class: 'seg' }, ...[1, 2, 3, 4, 5].map((n) => h('button', { class: f.n === n ? 'on' : '', onclick: () => { f.n = n; rerender(); } }, n)))));
  const introSel = intros.length > 1 ? h('select', { class: 'inp', onchange: (e) => { f.introId = e.target.value; } }, ...intros.map((i) => h('option', { value: i.id, selected: f.introId === i.id }, i.univ))) : null;
  root.append(h('div', { class: 'card' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.intro, onchange: (e) => { f.intro = e.target.checked; } }), h('span', null, '자기소개부터 시작')), introSel));
  root.append(h('div', { class: 'note' }, `조건에 맞는 활동 ${p.length}개 · 질문 ${qn}개`, h('div', { class: 'sub' }, '출제 빈도는 중요도 3:2:1을 5:3:1 가중치로 섞고, 같은 활동이 연속되지 않아요.')));
  root.append(h('button', { class: 'btn solid block', disabled: !p.length, onclick: () => {
    const entries = p.map((a) => ({ act: a, qs: S.list('q', (q) => q.act === a.id && q.q.x.trim()) }));
    const intro = f.intro ? (intros.find((i) => i.id === f.introId) || intros[0] || { univ: '', body: tf() }) : null;
    beginSession({ kind: 'act', pool: entries, n: f.n, intro });
  } }, icon('mic', 18), '면접 시작'));
}

// ================= 모의면접 만들기 =================
function makeView(root, st) {
  if (st.edit) return editMock(root, st);
  const ms = S.list('mock');
  root.append(univCard());
  root.append(h('button', { class: 'btn solid', onclick: () => { const m = S.create('mock', { name: '내 모의면접', qs: [{ q: '', a: '' }], shuffle: false, intro: true }); st.edit = m.id; rerender(); } }, icon('plus', 14), '새 모의면접 만들기'));
  if (!ms.length) root.append(h('div', { class: 'empty' }, '직접 질문(과 모범답변)을 입력해 나만의 면접을 만들어 연습해요. 여러 질문을 한 줄에 하나씩 붙여 넣을 수도 있어요.'));
  for (const m of ms) root.append(h('div', { class: 'card' }, h('div', { class: 'h-between' }, h('b', null, m.name), h('span', { class: 'sub' }, `질문 ${m.qs.filter((q) => q.q.trim()).length}개`)),
    h('div', { class: 'row' }, h('button', { class: 'btn sm solid', onclick: () => startCustom(m) }, '시작'), h('button', { class: 'btn sm', onclick: () => { st.edit = m.id; rerender(); } }, '편집'))));
}
function editMock(root, st) {
  const m = S.get(st.edit); if (!m) { st.edit = null; return rerender(); }
  const name = h('input', { class: 'inp', value: m.name, oninput: () => S.patch(m.id, { name: name.value }) });
  const bulk = h('textarea', { class: 'inp', rows: 4, placeholder: '질문을 한 줄에 하나씩 붙여 넣으세요' });
  root.append(h('button', { class: 'btn sm', onclick: () => { st.edit = null; rerender(); } }, icon('back', 14), '목록'), h('div', null, h('label', { class: 'lbl' }, '이름'), name));
  const save = () => S.patch(m.id, { qs: m.qs });
  m.qs.forEach((q, i) => {
    const qi = h('textarea', { class: 'inp', rows: 2, value: q.q, placeholder: '질문', oninput: () => { q.q = qi.value; save(); } });
    const ai = h('textarea', { class: 'inp', rows: 2, value: q.a, placeholder: '모범답변 (선택)', oninput: () => { q.a = ai.value; save(); } });
    root.append(h('div', { class: 'card' }, h('div', { class: 'h-between' }, h('b', null, '질문 ' + (i + 1)),
      h('span', { class: 'row tight' },
        h('button', { class: 'btn sm', disabled: i === 0, 'aria-label': '위로', onclick: () => { [m.qs[i - 1], m.qs[i]] = [m.qs[i], m.qs[i - 1]]; save(); rerender(); } }, icon('up', 14)),
        h('button', { class: 'btn sm', disabled: i === m.qs.length - 1, 'aria-label': '아래로', onclick: () => { [m.qs[i + 1], m.qs[i]] = [m.qs[i], m.qs[i + 1]]; save(); rerender(); } }, icon('down', 14)),
        h('button', { class: 'btn sm ghost-danger', onclick: () => { m.qs.splice(i, 1); if (!m.qs.length) m.qs.push({ q: '', a: '' }); save(); rerender(); } }, '삭제'))), qi, ai));
  });
  root.append(h('button', { class: 'btn', onclick: () => { m.qs.push({ q: '', a: '' }); save(); rerender(); } }, icon('plus', 14), '질문 한 개 추가'),
    h('div', { class: 'card' }, h('b', null, '여러 질문 한 번에 추가'), bulk,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => {
        const lines = bulk.value.split('\n').map((s) => s.trim()).filter(Boolean); if (!lines.length) return;
        m.qs = m.qs.filter((q) => q.q.trim() || q.a.trim()).concat(lines.map((q) => ({ q, a: '' }))); save(); rerender();
      } }, '붙여 넣은 질문 추가'))),
    h('div', { class: 'card' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: m.shuffle, onchange: (e) => S.patch(m.id, { shuffle: e.target.checked }) }), h('span', null, '질문 순서 섞기')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: m.intro, onchange: (e) => S.patch(m.id, { intro: e.target.checked }) }), h('span', null, '자기소개부터 시작'))),
    h('div', { class: 'row' },
      h('button', { class: 'btn solid', onclick: () => startCustom(m) }, icon('mic', 16), '이 면접 시작'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost-danger', onclick: async () => { if (await confirmBox('이 모의면접을 삭제할까요?', '삭제', true)) { S.remove(m.id); st.edit = null; rerender(); } } }, '삭제')));
}
function startCustom(m) {
  const qs = m.qs.filter((q) => q.q.trim());
  if (!qs.length) return toast('질문을 한 개 이상 입력해 주세요');
  const intros = S.list('intro');
  beginSession({ kind: 'custom', mock: m, intro: m.intro ? (intros[0] || { univ: '', body: tf() }) : null });
}

// ================= 면접 진행 =================
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const mkRec = (kind, label, q, a) => ({ kind, label, q, a: a || '', ms: 0, gaveUp: false, takes: [] });

function beginSession(cfg) {
  const pu = S.pref('mockUniv', '');
  session = { ...cfg, profs: pu && S.pref('mockProf', true) ? S.list('prof', (p) => p.univ === pu).slice(0, 3) : [], univ: pu, start: Date.now(), last: Date.now(), pi: cfg.intro ? -1 : 0, pages: [], recs: [], showIntro: false };
  if (cfg.intro) { session.introRec = mkRec('intro', '자기소개', '자기소개', cfg.intro.body && cfg.intro.body.x); session.recs.push(session.introRec); }
  if (cfg.kind === 'custom') {
    let qs = cfg.mock.qs.filter((q) => q.q.trim()); if (cfg.mock.shuffle) qs = shuffle(qs);
    const recs = qs.map((q) => mkRec('q', cfg.mock.name, q.q, q.a)); session.recs.push(...recs);
    session.pages.push({ label: cfg.mock.name, recs, ci: 0 });
  } else session.pages.push(makePage());
  setBusy(true);
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
  rerender();
}
function makePage() {
  const s = session; const lastId = s.pages.length ? s.pages[s.pages.length - 1].actId : null;
  const cand = s.pool.filter((p) => p.act.id !== lastId); const arr = cand.length ? cand : s.pool;
  const tot = arr.reduce((n, p) => n + WEIGHT[p.act.imp || 0], 0); let r = Math.random() * tot, pick = arr[0];
  for (const p of arr) { r -= WEIGHT[p.act.imp || 0]; if (r <= 0) { pick = p; break; } }
  const sub = S.get(pick.act.sub);
  const label = `${sub ? sub.grade + '학년 · ' + sub.name : ''} · ${pick.act.title || '활동'}`;
  const recs = shuffle(pick.qs).slice(0, s.n).map((q) => mkRec('q', label, q.q.x, q.a && q.a.x));
  s.recs.push(...recs);
  return { label, actId: pick.act.id, recs, ci: 0 };
}
const focusRec = () => { const s = session; if (!s) return null; if (s.pi === -1) return s.introRec; const p = s.pages[s.pi]; return p ? p.recs[p.ci] : null; };
let watchEl = null;
function tick() {
  if (!session) return;
  const now = Date.now(), d = now - session.last; session.last = now;
  const r = focusRec(); if (r) r.ms += d;
  if (watchEl && watchEl.isConnected) watchEl.textContent = fmtDur(now - session.start);
}

async function toggleRec(r) {
  if (rec && rec.r === r) return stopRec();
  await stopRec();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { return toast('마이크를 사용할 수 없어요. 브라우저의 마이크 권한을 확인해 주세요.'); }
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = []; const t0 = Date.now();
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec = { r, mr, stream, chunks, t0 };
  mr.start(1000);
  drawRun();
}
function stopRec() {
  return new Promise((res) => {
    if (!rec) return res();
    const cur = rec; rec = null;
    cur.mr.onstop = async () => {
      cur.stream.getTracks().forEach((t) => t.stop());
      try {
        const type = cur.mr.mimeType || 'audio/webm';
        const blob = new Blob(cur.chunks, { type });
        if (blob.size) { const id = await S.saveMedia(blob); cur.r.takes.push({ id, type, ms: Date.now() - cur.t0, size: blob.size }); }
      } catch (e) { console.error(e); toast('녹음을 저장하지 못했어요'); }
      drawRun(); res();
    };
    try { cur.mr.stop(); } catch { res(); }
  });
}

let runRoot = null;
function runView(root, st) { runRoot = root; drawRun(); }
function drawRun() {
  if (!session || !runRoot || !runRoot.isConnected) return;
  const s = session; const R = runRoot; R.replaceChildren();
  const root = { append: (...n) => R.append(...n.filter(Boolean)) };
  watchEl = h('div', { class: 'watch', 'aria-label': '경과 시간' }, fmtDur(Date.now() - s.start));
  root.append(h('div', { class: 'runbar' },
    h('button', { class: 'btn', onclick: endSession }, icon('stop', 14), '종료'), watchEl));
  const isRec = (r) => rec && rec.r === r;
  const recBtn = (r, big) => h('button', { class: 'btn' + (isRec(r) ? ' rec' : '') + (big ? ' solid' : ''), 'aria-pressed': isRec(r), onclick: () => toggleRec(r) },
    h('span', { class: isRec(r) ? 'rec-dot' : '' }, icon(isRec(r) ? 'stop' : 'rec', 14)), isRec(r) ? '녹음 중지' : '녹음', r.takes.length ? h('span', { class: 'sub' }, `(${r.takes.length})`) : null);

  if (s.pi === -1) {
    const r = s.introRec;
    root.append(profStage(s), h('div', { class: 'bigintro' }, '자기소개'),
      s.intro.body && s.intro.body.x ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { s.showIntro = !s.showIntro; drawRun(); } }, s.showIntro ? '내 자기소개 숨기기' : '내 자기소개 보기')) : null,
      s.showIntro ? h('div', { class: 'card pre' }, s.intro.body.x) : null,
      h('div', { class: 'row' }, recBtn(r, true), h('span', { class: 'grow' }), h('button', { class: 'btn solid', onclick: next }, '다음')));
    return;
  }
  const pg = s.pages[s.pi]; const cur = pg.recs[pg.ci];
  root.append(h('p', { class: 'sub' }, pg.label));
  root.append(profStage(s));
  root.append(h('div', { class: 'bigq pre' }, cur.q || '(빈 질문)'));
  root.append(h('div', { class: 'row' }, recBtn(cur, true),
    h('button', { class: 'btn', onclick: async () => { await stopRec(); cur.gaveUp = true; if (pg.ci < pg.recs.length - 1) pg.ci++; drawRun(); } }, '답변 포기'),
    h('button', { class: 'btn', 'aria-label': '다음 질문', disabled: pg.ci >= pg.recs.length - 1, onclick: async () => { await stopRec(); pg.ci++; drawRun(); } }, icon('down', 16))));
  pg.recs.forEach((r, i) => {
    if (i === pg.ci) return;
    const state = r.gaveUp ? '포기' : r.takes.length ? '녹음함' : '';
    root.append(h('div', { class: 'qrow' + (i < pg.ci ? ' past' : '') },
      h('div', { class: 'h-between' }, h('span', { class: 'pre' }, r.q || '(빈 질문)'), h('span', { class: 'row tight' }, state ? h('span', { class: 'tag' }, state) : null, recBtn(r)))));
  });
  const last = s.kind === 'custom';
  root.append(h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: last ? endSession : next }, last ? '면접 마치기' : '다음 (다른 생기부로)')));
}
async function next() {
  await stopRec();
  const s = session;
  if (s.pi === -1) { s.pi = 0; if (!s.pages.length) s.pages.push(makePage()); }
  else { s.pages.push(makePage()); s.pi = s.pages.length - 1; }
  drawRun(); window.scrollTo(0, 0);
}
async function endSession() {
  if (!(await confirmBox('면접을 종료하고 리포트를 만들까요?', '종료'))) return;
  await stopRec();
  const s = session; const total = Date.now() - s.start;
  const visited = new Set();
  if (s.introRec) visited.add(s.introRec);
  s.pages.forEach((p, i) => { if (i <= s.pi || s.kind === 'custom') p.recs.forEach((r) => visited.add(r)); });
  const items = [...visited].map((r) => ({ kind: r.kind, label: r.label, q: r.q, a: r.a, ms: Math.round(r.ms), gaveUp: r.gaveUp, skipped: !r.gaveUp && !r.takes.length && r.ms < 800, takes: r.takes }));
  // 쓰이지 않은 녹음은 없음. 다만 방문 안 한 질문에 걸린 녹음이 있으면 정리
  const keep = new Set(items.flatMap((i) => i.takes.map((t) => t.id)));
  s.recs.forEach((r) => r.takes.forEach((t) => { if (!keep.has(t.id)) S.deleteMedia(t.id); }));
  const rep = S.create('rep', { date: s.start, totalMs: total, kind: s.kind === 'custom' ? s.mock.name : '생기부 면접', items, rating: 0, media: [] });
  abortSession();
  nav('mock', { m: 'rep', rep: rep.id });
}

// ================= 리포트 =================
function stars(val, onSet) {
  return h('span', { class: 'stars', role: 'group', 'aria-label': '별점' }, ...[1, 2, 3, 4, 5].map((n) => h('button', { class: n <= val ? 'on' : '', 'aria-label': n + '점', onclick: (e) => { e.stopPropagation(); onSet(n === val ? 0 : n); } }, icon('star', 22))));
}
function reportView(root, st) {
  if (st.rep) return reportDetail(root, st);
  const reps = S.list('rep').sort((a, b) => b.date - a.date);
  if (!reps.length) return root.append(h('div', { class: 'empty' }, '아직 리포트가 없어요. 면접을 시작해서 종료하면 여기에 쌓여요.'));
  for (const r of reps) root.append(h('div', { class: 'card' },
    h('div', { class: 'h-between' }, h('b', null, fmtDate(r.date)), h('span', { class: 'sub' }, `${r.kind} · ${fmtDur(r.totalMs)}`)),
    h('div', { class: 'row' }, stars(r.rating || 0, (n) => { S.patch(r.id, { rating: n }); rerender(); }), h('span', { class: 'grow' }),
      h('span', { class: 'sub' }, `질문 ${r.items.filter((i) => i.kind === 'q').length}개`),
      h('button', { class: 'btn sm solid', onclick: () => { st.rep = r.id; rerender(); window.scrollTo(0, 0); } }, '열기'))));
}
function audioPlayer(take) {
  const box = h('div', null);
  const btn = h('button', { class: 'btn sm', onclick: async () => {
    btn.disabled = true;
    const b = await S.loadMedia(take.id, take.type);
    if (!b) { btn.disabled = false; return toast('이 기기에 녹음 파일이 없어요 (백업에 포함되지 않았을 수 있어요)'); }
    btn.remove(); box.append(h('audio', { controls: true, src: URL.createObjectURL(b), autoplay: true }));
  } }, `녹음 듣기 (${fmtDur(take.ms || 0)})`);
  box.append(btn); return box;
}
function reportDetail(root, st) {
  const r = S.get(st.rep); if (!r) { st.rep = null; return rerender(); }
  root.append(h('div', { class: 'h-between' }, h('button', { class: 'btn sm', onclick: () => { st.rep = null; rerender(); } }, icon('back', 14), '목록'),
    h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox('이 리포트와 녹음·영상을 삭제할까요?', '삭제', true)) { S.remove(r.id); st.rep = null; rerender(); } } }, '리포트 삭제')));
  root.append(h('div', { class: 'card' }, h('h3', null, fmtDate(r.date) + ' · ' + r.kind),
    h('div', { class: 'row' }, h('span', null, `총 시간 ${fmtDur(r.totalMs)}`), h('span', { class: 'grow' }), stars(r.rating || 0, (n) => { S.patch(r.id, { rating: n }); rerender(); }))));
  r.items.forEach((it, i) => root.append(h('div', { class: 'card' },
    h('div', { class: 'h-between' }, h('span', { class: 'sub' }, it.label || ''), h('span', { class: 'row tight' },
      it.gaveUp ? h('span', { class: 'tag' }, '답변 포기') : null, it.skipped ? h('span', { class: 'tag' }, '건너뜀') : null, h('span', { class: 'tag' }, '머문 시간 ' + fmtDur(it.ms)))),
    h('p', { class: 'pre' }, h('b', null, `${i + 1}. ${it.q}`)),
    ...(it.takes || []).map((t) => audioPlayer(t)),
    (it.takes || []).length ? null : h('p', { class: 'sub' }, '녹음 없음'),
    h('div', { class: 'sep' }), h('div', { class: 'lbl' }, '모범답변'),
    it.a ? h('div', { class: 'pre' }, it.a) : h('div', { class: 'sub' }, '입력한 모범답변이 없어요'))));
  // 영상 첨부
  const vids = r.media || [];
  const vbox = h('div', { class: 'stack' });
  vids.forEach((v) => vbox.append(h('div', { class: 'list-item' }, h('span', { class: 'grow' }, `${v.name} (${fmtSize(v.size)})`),
    h('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; const b = await S.loadMedia(v.id, v.type); if (!b) { e.target.disabled = false; return toast('이 기기에 영상 파일이 없어요'); } e.target.replaceWith(h('video', { controls: true, src: URL.createObjectURL(b) })); } }, '재생'),
    h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (!(await confirmBox('이 영상을 삭제할까요?', '삭제', true))) return; S.deleteMedia(v.id); S.patch(r.id, { media: vids.filter((x) => x.id !== v.id) }); rerender(); } }, '삭제'))));
  root.append(h('div', { class: 'card' }, h('b', null, '영상 첨부'),
    h('p', { class: 'sub' }, '면접 연습 영상을 붙여 두세요. 이 기기에 암호화되어 저장되고, 백업 파일에 포함할 수 있어요.'), vbox,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async (e) => {
      const [f] = await pickFile('video/*'); if (!f) return;
      if (f.size > 1.5e9 && !(await confirmBox(`영상이 ${fmtSize(f.size)}로 매우 커요. 저장과 백업에 시간이 오래 걸리고 브라우저 저장 공간이 부족할 수 있어요. 계속할까요?`, '계속'))) return;
      e.target.disabled = true; toast('암호화해서 저장하는 중…');
      try { const id = await S.saveMedia(f); S.patch(r.id, { media: [...vids, { id, name: f.name, type: f.type || 'video/mp4', size: f.size }] }); rerender(); }
      catch (err) { console.error(err); toast('저장 공간이 부족하거나 저장에 실패했어요'); e.target.disabled = false; }
    } }, '영상 파일 선택'))));
}

// ================= 교수님 사진 =================
function univCard() {
  const univs = [...new Set(S.list('prof').map((p) => p.univ))];
  const cur = S.pref('mockUniv', '');
  if (cur && !univs.includes(cur)) S.setPref('mockUniv', '');
  return h('div', { class: 'card stack' }, h('b', null, '면접 대학'),
    univs.length ? h('div', { class: 'chips' }, ...[['', '선택 안 함'], ...univs.map((u) => [u, u])].map(([k, l]) => h('button', { class: 'chip' + ((S.pref('mockUniv', '') === k) ? ' on' : ''), onclick: () => { S.setPref('mockUniv', k); rerender(); } }, l)))
      : h('p', { class: 'sub' }, '"교수님" 탭에서 대학별로 교수님 사진을 넣어 두면, 면접할 때 사진이 크게 떠요.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.pref('mockProf', true), disabled: !univs.length, onchange: (e) => { S.setPref('mockProf', e.target.checked); rerender(); } }), h('span', null, '교수님 사진 포함')),
    univs.length ? h('p', { class: 'sub' }, S.pref('mockProf', true) && S.pref('mockUniv', '') ? '면접 중 교수님 사진이 크게 떠요.' : '사진 없이 질문만 크게 나와요.') : null);
}
function profStage(s) {
  if (!s.profs || !s.profs.length) return null;
  return h('div', { class: 'profs n' + s.profs.length, 'aria-label': (s.univ || '') + ' 면접관' },
    ...s.profs.map((p) => h('figure', { class: 'prof' }, h('img', { src: p.photo, alt: p.name || '면접관' }), p.name ? h('figcaption', null, p.name) : null)));
}
// 사진을 줄여서(긴 변 900px) 글자로 바꿔 저장 — 앱 데이터와 함께 암호화돼요
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 읽지 못했어요')); i.src = url; });
    const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
function profView(root, st) {
  const have = [...new Set(S.list('prof').map((p) => p.univ))];
  const extra = st.pu || (st.pu = []);
  const univs = [...new Set([...targets().map((t) => t.univ), ...have, ...extra])];
  if (!st.pcur || !univs.includes(st.pcur)) st.pcur = univs[0] || '';
  root.append(h('div', { class: 'note' }, '대학마다 교수님(면접관) 사진을 3명까지 넣을 수 있어요. 면접 시작 화면에서 대학을 고르면 면접 중에 사진이 크게 떠요. 사진은 이 기기 안에서만 암호화되어 저장돼요.'));
  root.append(h('div', { class: 'chips' }, ...univs.map((u) => h('button', { class: 'chip' + (st.pcur === u ? ' on' : ''), onclick: () => { st.pcur = u; rerender(); } }, u)),
    h('button', { class: 'chip', onclick: () => addUniv(st) }, '+ 대학 추가')));
  if (!st.pcur) return root.append(h('div', { class: 'empty' }, '먼저 대학을 추가해 주세요.'));
  const ps = S.list('prof', (p) => p.univ === st.pcur);
  const slots = h('div', { class: 'profs n3 edit' });
  ps.forEach((p) => {
    const nm = h('input', { class: 'inp', value: p.name || '', placeholder: '이름·별칭 (선택)', oninput: () => S.patch(p.id, { name: nm.value }) });
    slots.append(h('div', { class: 'stack' }, h('figure', { class: 'prof' }, h('img', { src: p.photo, alt: p.name || '면접관' })), nm,
      h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox('이 사진을 삭제할까요?', '삭제', true)) { S.remove(p.id); rerender(); } } }, '삭제')));
  });
  if (ps.length < 3) slots.append(h('button', { class: 'tile add', onclick: async () => {
    const [f] = await pickFile('image/*'); if (!f) return;
    try { S.create('prof', { univ: st.pcur, photo: await shrink(f), name: '' }); rerender(); } catch (e) { toast(e.message); }
  } }, h('b', null, '+ 사진 추가'), h('span', { class: 'd' }, `${ps.length}/3`)));
  root.append(slots);
  if (S.pref('mockUniv', '') !== st.pcur && ps.length) root.append(h('button', { class: 'btn solid block', onclick: () => { S.setPref('mockUniv', st.pcur); toast(`${st.pcur}로 면접해요`); rerender(); } }, `${st.pcur} 면접관으로 면접하기`));
}
function addUniv(st) {
  const sel = h('select', { class: 'inp' }, ...[...UNIS, '직접 입력…'].map((u) => h('option', { value: u }, u)));
  const other = h('input', { class: 'inp hidden', placeholder: '대학 이름' });
  sel.addEventListener('change', () => other.classList.toggle('hidden', sel.value !== '직접 입력…'));
  const m = modal('대학 추가', h('div', null, sel, other, h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: () => {
    const u = (sel.value === '직접 입력…' ? other.value : sel.value).trim(); if (!u) return toast('대학을 골라 주세요');
    (st.pu = st.pu || []).push(u); st.pcur = u; m.close(); rerender();
  } }, '추가'))));
}
