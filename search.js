// 검색: 글자 단위 부분 일치, 공백·대소문자 무시. 결과를 누르면 해당 화면으로 이동해 검색어를 표시
import { h, norm, debounce } from './util.js';
import * as S from './store.js';
import { findRanges } from './hl.js';
import { nav } from './app.js';

const text = (f) => (f && typeof f === 'object' ? f.x || '' : f || '');

function collect() {
  const out = []; // { cat, label, fields:[[name,text]], go(term) }
  for (const s of S.list('sub')) out.push({ cat: '과목', label: `${s.grade}학년 · 과목`, fields: [['과목 이름', s.name]], go: (term) => nav('mat', { g: s.grade, sub: null, term }) });
  for (const a of S.list('act')) {
    const s = S.get(a.sub); if (!s) continue;
    const label = `${s.grade}학년 · ${s.name} · ${a.title || '활동'}`;
    out.push({ cat: '생기부', label, fields: [['활동 제목', a.title], ['생기부 원문', text(a.src)], ['활동 설명', text(a.desc)], ['보고서 원문', text(a.rep)]], go: (term) => nav('mat', { g: s.grade, sub: s.id, act: a.id, term, pane: undefined }) });
    for (const q of S.list('q', (q) => q.act === a.id)) out.push({ cat: '질문', label: label + ' · 예상질문', fields: [['질문', text(q.q)], ['답변', text(q.a)]], go: (term) => nav('mat', { g: s.grade, sub: s.id, act: a.id, term, pane: 'mat' }) });
  }
  for (const i of S.list('intro')) out.push({ cat: '자기소개', label: '자기소개 · ' + i.univ, fields: [['대학', i.univ], ['자기소개', text(i.body)]], go: (term) => nav('mat', { g: 'intro', term }) });
  for (const r of S.list('ref')) out.push({ cat: '참고자료', label: '참고자료 · ' + r.title, fields: [['제목', r.title], ['종류', r.kind], ['설명', text(r.desc)], ['활용처', text(r.usage)], ['자료 내용', text(r.body)]], go: (term) => nav('mat', { g: 'ref', term }) });
  for (const g of S.list('guide')) out.push({ cat: '가이드', label: '가이드 · ' + g.univ, fields: [['대학', g.univ], ['면접 가이드', text(g.body)], ['메모', text(g.memo)]], go: (term) => nav('guide', { term }) });
  for (const m of S.list('mock')) out.push({ cat: '모의면접', label: '모의면접 · ' + m.name, fields: [['이름', m.name], ...m.qs.flatMap((q) => [['질문', q.q], ['모범답변', q.a]])], go: () => nav('mock', { m: 'make', edit: m.id }) });
  for (const r of S.list('rep')) out.push({ cat: '모의면접', label: '리포트 · ' + new Date(r.date).toLocaleDateString('ko-KR'), fields: r.items.flatMap((i) => [['질문', i.q], ['모범답변', i.a]]), go: () => nav('mock', { m: 'rep', rep: r.id }) });
  return out;
}

function snippet(t, term) {
  const r = findRanges(t, term)[0]; if (!r) return null;
  const a = Math.max(0, r.s - 24), b = Math.min(t.length, r.e + 48);
  return [a > 0 ? '…' : '', t.slice(a, r.s), h('span', { class: 'mk c1' }, t.slice(r.s, r.e)), t.slice(r.e, b), b < t.length ? '…' : ''];
}

const CATS = ['전체', '과목', '생기부', '질문', '참고자료', '자기소개', '가이드', '모의면접'];
export function renderSearch(root, st) {
  if (st.q == null) { st.q = ''; st.cat = '전체'; }
  const inp = h('input', { class: 'inp', type: 'search', value: st.q, placeholder: '과목·원문·활동 정리·질문·참고자료·가이드 검색', 'aria-label': '검색어' });
  const res = h('div', { class: 'stack' });
  const chips = h('div', { class: 'chips' });
  const drawChips = () => chips.replaceChildren(...CATS.map((c) => h('button', { class: 'chip' + (st.cat === c ? ' on' : ''), onclick: () => { st.cat = c; drawChips(); run(); } }, c)));
  const run = () => {
    const term = st.q = inp.value; res.replaceChildren();
    if (!norm(term)) return res.append(h('p', { class: 'sub' }, '공백과 대소문자는 무시하고, 글자 일부만 맞아도 찾아요. 모든 생기부 내용과 참고자료에서 한 번에 찾아요.'));
    const q = norm(term); let n = 0;
    for (const it of collect()) {
      if (st.cat !== '전체' && it.cat !== st.cat) continue;
      for (const [name, t] of it.fields) {
        if (!t || !norm(t).includes(q)) continue;
        const sn = snippet(t, term); if (!sn) continue;
        res.append(h('button', { class: 'card click', onclick: () => it.go(term) },
          h('div', { class: 'sub' }, `${it.label} · ${name}`), h('div', { class: 'pre' }, ...sn)));
        if (++n >= 60) break;
      }
      if (n >= 60) break;
    }
    if (!n) res.append(h('p', { class: 'sub' }, '결과가 없어요.'));
    else if (n >= 60) res.append(h('p', { class: 'sub' }, '결과가 많아 60개까지만 보여요. 검색어를 더 구체적으로 입력해 보세요.'));
  };
  inp.addEventListener('input', debounce(run, 150));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  drawChips();
  root.append(h('div', { class: 'stack' }, inp, chips, res)); run();
  if (!st.q) setTimeout(() => inp.focus(), 40);
}
