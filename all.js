// 전체 자료 탭: 표지 · 목차 · 본문을 A4 문서로 보여주고 PDF(인쇄) / HTML 파일로 내보내기
import { h, download, confirmBox, toast } from './util.js';
import * as S from './store.js';
import { renderRich, COLORS } from './hl.js';

const rich = (cls, f) => { const d = h('div', { class: cls || 'blk' }); renderRich(d, f.x, f.h || []); return d; };
const sec = (label, f) => (f && f.x && f.x.trim() ? [h('div', { class: 'lbl2' }, label), rich('blk', f)] : []);

function buildDoc() {
  const pages = [];
  const nInt = S.list('intro').length, subs = S.list('sub'), acts = S.list('act', (a) => S.get(a.sub)), refs = S.list('ref'), guides = S.list('guide');
  const toc = [];
  const body = [];

  // 자기소개
  const intros = S.list('intro');
  if (intros.length) {
    toc.push(['sec-intro', '자기소개']);
    body.push(h('section', { class: 'a4', id: 'sec-intro' }, h('h2', null, '자기소개'),
      ...intros.flatMap((i) => [h('h3', null, i.univ || '자기소개'), ...sec('', i.body)])));
  }
  for (const g of [1, 2, 3]) {
    const gs = subs.filter((s) => s.grade === g); if (!gs.length) continue;
    toc.push([`sec-g${g}`, `${g}학년`]);
    const nodes = [h('h2', null, `${g}학년`)];
    for (const s of gs) {
      toc.push([`sub-${s.id}`, s.name, 1]);
      nodes.push(h('h3', { id: 'sub-' + s.id }, h('span', { class: 'mk c' + s.color }, s.name)));
      for (const a of S.list('act', (x) => x.sub === s.id)) {
        const qs = S.list('q', (q) => q.act === a.id);
        nodes.push(h('div', { class: 'actb' },
          h('h4', null, a.title || '활동', a.imp ? `  ·  중요도 ${a.imp}` : '', a.done ? h('span', { class: 'mk c' + s.color }, '  완료') : null),
          ...sec('생기부 원문', a.src), ...sec('활동 설명', a.desc), ...sec('보고서 원문', a.rep),
          ...(qs.length ? [h('div', { class: 'lbl2' }, '예상질문'), ...qs.map((q, i) => h('div', { class: 'blk' }, h('b', null, `Q${i + 1}. `), rich('', q.q), q.a && q.a.x ? h('div', null, h('b', null, 'A. '), rich('', q.a)) : null))] : [])));
      }
    }
    body.push(h('section', { class: 'a4', id: `sec-g${g}` }, ...nodes));
  }
  if (refs.length) {
    toc.push(['sec-ref', '참고자료']);
    body.push(h('section', { class: 'a4', id: 'sec-ref' }, h('h2', null, '참고자료'),
      ...refs.flatMap((r) => [h('h3', null, r.title, h('span', { class: 'sub' }, `  ${r.grade ? r.grade + '학년' : '공통'}${r.kind ? ' · ' + r.kind : ''}`)), ...sec('설명', r.desc), ...sec('활용처', r.usage), ...sec('자료 내용', r.body)])));
  }
  if (guides.length) {
    toc.push(['sec-guide', '대학별 가이드·메모']);
    body.push(h('section', { class: 'a4', id: 'sec-guide' }, h('h2', null, '대학별 가이드·메모'),
      ...guides.flatMap((g) => [h('h3', null, g.univ), ...sec('면접 가이드', g.body), ...sec('메모', g.memo)])));
  }
  const d = new Date(); const ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  pages.push(h('section', { class: 'a4' }, h('div', { class: 'cover' }, h('div', { class: 'lbl2' }, 'INTERVIEW ARCHIVE'), h('h1', null, '생기부 면접 자료'),
    h('p', null, `${ds} 출력`), h('p', { class: 'sub' }, `과목 ${subs.length}개 · 활동 ${acts.length}개 · 예상질문 ${S.list('q', (q) => S.get(q.act)).length}개`))));
  pages.push(h('section', { class: 'a4' }, h('h2', null, '목차'),
    h('ul', { class: 'toc' }, ...toc.map(([id, l, lv]) => h('li', { class: lv ? 'l2' : 'l1' }, h('a', { href: '#' + id }, l)))),
    toc.length ? null : h('p', { class: 'sub' }, '아직 입력된 자료가 없어요.')));
  return h('div', { class: 'a4wrap' }, ...pages, ...body);
}

export function renderAll(root) {
  const doc = buildDoc();
  root.append(h('div', { class: 'row tight noprint' },
    h('button', { class: 'btn solid', onclick: () => window.print() }, 'PDF로 저장(인쇄)'),
    h('button', { class: 'btn', onclick: () => saveHtml(doc) }, 'HTML 파일 다운로드')),
    h('p', { class: 'sub noprint' }, '인쇄 창에서 "PDF로 저장"을 고르면 PDF가 돼요. 내가 칠한 형광펜과 수정한 원문이 그대로 들어가요.'), doc);
  // 목차 이동은 해시 변경 없이 스크롤만
  doc.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    e.preventDefault(); const t = doc.querySelector(CSS.escape ? '#' + CSS.escape(a.getAttribute('href').slice(1)) : a.getAttribute('href'));
    t && t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function saveHtml(doc) {
  if (!(await confirmBox('다운로드한 HTML 파일은 암호화되지 않아요. 생기부가 그대로 들어 있으니 보관과 공유에 주의하세요.', '다운로드'))) return;
  let css = '';
  try { css = await (await fetch(new URL('./style.css', import.meta.url))).text(); } catch { /* 글꼴 외 스타일 없이 저장 */ }
  css = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>생기부 면접 자료</title><style>${css}\nbody{padding:16px}.noprint{display:none}</style></head><body><main>${doc.outerHTML}</main></body></html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), '생기부-면접자료.html');
  toast('HTML 파일을 저장했어요');
}
