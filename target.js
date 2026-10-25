// 지원 대학·학과 선택 (프롬프트에 자동으로 들어가서, 사용자가 프롬프트를 직접 만질 일이 없게 한다)
import { h, modal, toast } from './util.js';
import * as S from './store.js';

const UNIS = ['서울대', '연세대', '고려대', '서강대', '성균관대', '한양대', '중앙대', '경희대', '한국외대', '서울시립대', '이화여대', '건국대', '동국대', '홍익대', '숙명여대', '국민대', '숭실대', '세종대', '단국대', '광운대', '인하대', '아주대', '가톨릭대', '부산대', '경북대', '전남대', '충남대', '충북대', '전북대', '경상국립대', '강원대', '제주대', 'KAIST', 'UNIST', 'GIST', 'DGIST'];
const DEPTS = ['경영학과', '경영학부', '글로벌경영학과', '경제학과', '경제학부', '국제통상학과', '무역학과', '회계학과', '소비자학과', '광고홍보학과', '미디어커뮤니케이션학과', '심리학과', '통계학과', '건축학과', '건축공학과', '도시공학과', '산업디자인학과', '컴퓨터공학과', '산업공학과'];
const FACTORS = ['학업역량', '진로(전공적합)역량', '공동체역량', '발전가능성', '인성'];
const TIMES = ['모름', '5분 안팎', '10분 안팎', '15분 안팎', '20분 이상'];
const OTHER = '직접 입력…';

export const targets = () => S.list('tgt').filter((t) => t.on !== false);

// 프롬프트의 {{지원}} 자리에 들어갈 글
export function targetText() {
  const ts = targets(); if (!ts.length) return '';
  return ts.map((t, i) => `(${i + 1}) 대학: ${t.univ} / 학과: ${t.dept} / 평가요소: ${t.factors.length ? t.factors.join(', ') : '모름'} / 면접 형식: ${t.blind ? '블라인드(이름·학교명·부모 직업 언급 금지)' : '블라인드 아님'}, 시간 ${t.time}`).join('\n');
}
// {{가이드}}: 가이드 탭에 적어 둔 같은 대학의 면접 가이드
export function guideText() {
  const out = [];
  for (const t of targets()) for (const g of S.list('guide')) {
    if (g.univ && g.univ.includes(t.univ) && g.body && g.body.x.trim()) out.push(`<${g.univ}>\n${g.body.x.trim().slice(0, 2500)}`);
  }
  return out.length ? out.join('\n\n') : '(없음)';
}

function select(options, value, onchange) {
  return h('select', { class: 'inp', onchange: (e) => onchange(e.target.value) }, ...options.map((o) => h('option', { value: o, selected: o === value }, o)));
}

export function openTargetPicker(onDone) {
  const body = h('div', { class: 'stack' });
  let m;
  const draw = () => {
    const ts = S.list('tgt');
    const form = { univ: UNIS[0], univOther: '', dept: DEPTS[0], deptOther: '', factors: ['학업역량', '진로(전공적합)역량', '공동체역량'], blind: true, time: TIMES[0] };
    const uOther = h('input', { class: 'inp hidden', placeholder: '대학 이름' }); uOther.addEventListener('input', () => { form.univOther = uOther.value; });
    const dOther = h('input', { class: 'inp hidden', placeholder: '학과 이름' }); dOther.addEventListener('input', () => { form.deptOther = dOther.value; });
    const uSel = select([...UNIS, OTHER], form.univ, (v) => { form.univ = v; uOther.classList.toggle('hidden', v !== OTHER); });
    const dSel = select([...DEPTS, OTHER], form.dept, (v) => { form.dept = v; dOther.classList.toggle('hidden', v !== OTHER); });
    body.replaceChildren(
      h('div', { class: 'note' }, '지원하는 대학과 학과를 고르면 AI에 보내는 안내문에 자동으로 들어가요. 안내문을 직접 고치거나 볼 필요가 없어요. 여러 곳을 골라도 돼요.'),
      ts.length ? h('div', { class: 'card stack' }, h('b', null, '내 지원 목록 (체크한 곳이 사용돼요)'),
        ...ts.map((t) => {
          const c = h('input', { type: 'checkbox', checked: t.on !== false, onchange: () => { S.patch(t.id, { on: c.checked }); } });
          return h('div', { class: 'list-item' }, h('label', { class: 'check grow' }, c, h('span', null, `${t.univ} ${t.dept}`)),
            h('button', { class: 'btn sm ghost-danger', onclick: () => { S.remove(t.id); draw(); } }, '삭제'));
        })) : null,
      h('div', { class: 'card stack' }, h('b', null, '+ 지원 대학·학과 추가'),
        h('label', { class: 'lbl' }, '대학'), uSel, uOther,
        h('label', { class: 'lbl' }, '학과'), dSel, dOther,
        h('label', { class: 'lbl' }, '면접 평가요소 (해당하는 것)'),
        h('div', { class: 'chips' }, ...FACTORS.map((f) => { const b = h('button', { class: 'chip' + (form.factors.includes(f) ? ' on' : ''), onclick: () => { const i = form.factors.indexOf(f); i < 0 ? form.factors.push(f) : form.factors.splice(i, 1); b.classList.toggle('on', i < 0); } }, f); return b; })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { form.blind = e.target.checked; } }), h('span', null, '블라인드 면접')),
        h('div', { class: 'row tight' }, h('span', null, '면접 시간'), select(TIMES, form.time, (v) => { form.time = v; })),
        h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: () => {
          const univ = (form.univ === OTHER ? form.univOther : form.univ).trim(), dept = (form.dept === OTHER ? form.deptOther : form.dept).trim();
          if (!univ || !dept) return toast('대학과 학과를 골라 주세요');
          S.create('tgt', { univ, dept, factors: [...form.factors], blind: form.blind, time: form.time, on: true }); draw();
        } }, '추가'))),
      h('div', { class: 'row end' }, h('button', { class: 'btn solid', onclick: () => { m.close(); onDone && onDone(); } }, '완료')));
  };
  m = modal('지원 대학·학과 선택', body, { wide: true });
  draw();
}
