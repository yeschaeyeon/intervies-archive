// 가이드 탭: 대학별 면접 가이드를 직접 정리 (내용은 사용자가 입력)
import { h, icon, confirmBox, promptBox } from './util.js';
import * as S from './store.js';
import { richField, tf } from './hl.js';
import { rerender } from './app.js';

export function renderGuide(root, st) {
  const items = S.list('guide');
  root.append(h('div', { class: 'stack' },
    h('div', { class: 'row tight' }, h('button', { class: 'btn solid', onclick: async () => {
      const u = await promptBox('대학 가이드 추가', '대학/전형 이름 (예: ○○대 학종)'); if (u == null) return;
      S.create('guide', { univ: u.trim() || '새 가이드', body: tf(), memo: tf() }); rerender();
    } }, icon('plus', 14), '대학 가이드 추가')),
    !items.length ? h('div', { class: 'empty' }, '지원하는 대학별로 평가 방식, 비중, 절차, 인재상, 기출·예시 질문을 정리해 두는 곳이에요. 내용은 직접 입력하거나 붙여 넣어 주세요.') : null,
    ...items.map((g) => {
      const t = h('input', { class: 'inp', value: g.univ, 'aria-label': '대학 이름', oninput: () => S.patch(g.id, { univ: t.value }) });
      return h('div', { class: 'card' },
        h('div', { class: 'row tight' }, h('div', { class: 'grow' }, t),
          h('button', { class: 'btn sm ghost-danger', onclick: async () => { if (await confirmBox('이 가이드를 삭제할까요?', '삭제', true)) { S.remove(g.id); rerender(); } } }, '삭제')),
        h('div', { class: 'sep' }),
        richField({ get: () => g.body || tf(), set: (v) => S.patch(g.id, { body: v }), label: '면접 가이드', placeholder: '평가 방식, 비중, 절차, 인재상, 기출·예시 질문 등', term: st.term }),
        richField({ get: () => g.memo || tf(), set: (v) => S.patch(g.id, { memo: v }), label: '메모', placeholder: '이 대학에 대한 나만의 메모', term: st.term }));
    })));
}
