// 설정: 백업/불러오기(병합), 잠금, 복구 키, 저장 공간, 안내
import { h, toast, modal, confirmBox, promptBox, pickFile, download, fmtSize, fmtDate } from './util.js';
import * as S from './store.js';
import { rerender } from './app.js';
import { recoveryStep } from './lock.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };

export function renderSettings(root, st) {
  const withMedia = h('input', { type: 'checkbox', checked: S.pref('bkMedia', true), onchange: (e) => S.setPref('bkMedia', e.target.checked) });
  const last = S.pref('lastBackup', 0);
  const storage = h('p', { class: 'sub' }, '저장 공간 확인 중…');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(async (e) => {
      const per = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      storage.textContent = `이 기기에서 사용 중 ${fmtSize(e.usage || 0)} / 사용 가능 약 ${fmtSize(e.quota || 0)}${per == null ? '' : per ? ' · 영구 저장 허용됨' : ' · 영구 저장 미허용(브라우저가 공간 부족 시 지울 수 있어요)'}`;
    }).catch(() => { storage.textContent = ''; });
  } else storage.textContent = '';

  const backupCard = h('div', { class: 'card' + (st.focus === 'backup' ? '' : '') },
    h('h3', null, '백업 · 불러오기'),
    h('p', { class: 'sub' }, last ? `마지막 백업: ${fmtDate(last)}` : '아직 백업한 적이 없어요.'),
    h('p', null, '생기부 원문, 활동, 보고서, 하이라이트, 예상질문, 자기소개, 직접 만든 모의면접, 리포트를 파일 하나(.saenggibu)로 묶어요. 파일은 암호화되어 있고, 백업 당시의 비밀번호 또는 복구 키로 열려요.'),
    h('label', { class: 'check' }, withMedia, h('span', null, '녹음·영상 포함 (포함하면 파일이 커지고 오래 걸릴 수 있어요)')),
    h('div', { class: 'row' },
      h('button', { class: 'btn solid', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; toast('백업 파일 만드는 중…'); await wait(30);
        try {
          const { blob, mediaCount } = await S.exportBackup(withMedia.checked);
          download(blob, `생기부-백업-${stamp()}.saenggibu`);
          S.setPref('lastBackup', Date.now()); toast(`백업했어요 (${fmtSize(blob.size)}${withMedia.checked ? `, 녹음·영상 ${mediaCount}개` : ''})`); rerender();
        } catch (err) { console.error(err); toast('백업에 실패했어요: ' + err.message); b.disabled = false; }
      } }, '백업 파일 내보내기'),
      h('button', { class: 'btn', onclick: importBackup }, '백업 불러오기 (병합)')),
    h('p', { class: 'sub' }, '불러오기는 항상 "병합"이에요. 같은 항목은 수정 시각이 더 최근인 쪽이 남고, 삭제한 항목도 기록으로 합쳐져요.'));

  const idle = h('select', { class: 'inp', onchange: (e) => S.setPref('idleMin', +e.target.value) },
    ...[[0, '자동 잠금 안 함'], [3, '3분'], [5, '5분'], [10, '10분'], [30, '30분'], [60, '1시간']].map(([v, l]) => h('option', { value: v, selected: S.pref('idleMin', 10) === v }, l)));
  const lockCard = h('div', { class: 'card stack' }, h('h3', null, '잠금'),
    h('div', null, h('label', { class: 'lbl' }, '아무 조작이 없으면 자동으로 잠그기'), idle),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => S.lock() }, '지금 잠그기'),
      h('button', { class: 'btn', onclick: changePw }, '비밀번호 변경'),
      h('button', { class: 'btn', onclick: newRK }, '복구 키 새로 발급')));

  const dataCard = h('div', { class: 'card stack' }, h('h3', null, '저장 공간'), storage,
    h('div', { class: 'row tight' }, h('button', { class: 'btn sm', onclick: async () => {
      try { const ok = await navigator.storage.persist(); toast(ok ? '영구 저장이 허용됐어요' : '브라우저가 허용하지 않았어요. 정기적으로 백업해 주세요.'); rerender(); } catch { toast('이 브라우저는 지원하지 않아요'); }
    } }, '영구 저장 요청')),
    h('div', { class: 'sep' }),
    h('button', { class: 'btn ghost-danger', onclick: async () => {
      const t = await promptBox('모든 데이터 삭제', '이 기기의 모든 데이터(백업하지 않은 것 포함)가 영구 삭제돼요. 계속하려면 "삭제"를 입력하세요.');
      if (t !== '삭제') return; await S.wipeAll(); location.reload();
    } }, '이 기기의 모든 데이터 삭제'));

  const infoCard = h('div', { class: 'card' }, h('h3', null, '개인정보 · 보안 안내'),
    h('div', { class: 'pre' }, '① 입력하거나 첨부한 모든 내용은 서버로 전송되지 않아요. 이 기기의 브라우저(IndexedDB)에만 저장돼요.\n② 저장할 때 비밀번호로 만든 키로 암호화(AES-256-GCM)해요.\n③ 이 앱은 외부 서버·글꼴·분석 도구와 통신하지 않아요. (콘텐츠 보안 정책으로 외부 요청을 차단)\n④ 백업 파일도 암호화되어 있어요. 비밀번호와 복구 키를 모두 잃으면 누구도 복구할 수 없어요.\n⑤ 공용 기기에서는 사용 후 꼭 "지금 잠그기"를 눌러 주세요.\n⑥ 3학년 생기부는 학교에서 공개되지 않는 경우가 많아 직접 입력이 필요할 수 있어요.'));

  root.append(h('div', { class: 'stack' }, backupCard, lockCard, dataCard, infoCard));
  if (st.focus === 'backup') setTimeout(() => backupCard.scrollIntoView({ block: 'start' }), 50);
}

async function importBackup() {
  const [f] = await pickFile('.saenggibu,application/octet-stream');
  if (!f) return;
  try { await S.readBackupHeader(f); } catch (e) { return toast(e.message); }
  const secret = await promptBox('백업 열기', '백업을 만들 때의 비밀번호 또는 복구 키');
  if (!secret) return;
  toast('여는 중… (몇 초 걸릴 수 있어요)'); await wait(30);
  try {
    const op = await S.openBackup(f, secret);
    if (!op) return toast('비밀번호나 복구 키가 맞지 않아요.');
    const r = await S.mergeBackup(f, op);
    toast(`병합했어요 · 바뀐 항목 ${r.changed}개, 녹음·영상 ${r.mediaIn}개 추가`); rerender();
  } catch (e) { console.error(e); toast('불러오지 못했어요: ' + e.message); }
}

function changePw() {
  const o = h('input', { class: 'inp', type: 'password', placeholder: '현재 비밀번호', autocomplete: 'current-password' });
  const a = h('input', { class: 'inp', type: 'password', placeholder: '새 비밀번호 (8자 이상)', autocomplete: 'new-password' });
  const b = h('input', { class: 'inp', type: 'password', placeholder: '새 비밀번호 확인', autocomplete: 'new-password' });
  const msg = h('p', { class: 'err' });
  const m = modal('비밀번호 변경', h('div', null, o, h('div', { class: 'stack' }), a, b, msg,
    h('p', { class: 'sub' }, '이미 만들어 둔 백업 파일은 백업 당시의 비밀번호로 열려요.'),
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, '취소'), h('button', { class: 'btn solid', onclick: async (e) => {
      if (a.value.length < 8) return (msg.textContent = '새 비밀번호는 8자 이상이어야 해요.');
      if (a.value !== b.value) return (msg.textContent = '새 비밀번호가 서로 달라요.');
      e.target.disabled = true; await wait(30);
      const ok = await S.changePassword(o.value, a.value);
      if (!ok) { e.target.disabled = false; return (msg.textContent = '현재 비밀번호가 맞지 않아요.'); }
      m.close(); toast('비밀번호를 바꿨어요');
    } }, '변경'))));
}

async function newRK() {
  const pw = await promptBox('복구 키 새로 발급', '현재 비밀번호를 입력하세요. 기존 복구 키는 더 이상 쓸 수 없게 돼요.');
  if (!pw) return;
  toast('발급 중…'); await wait(30);
  const rk = await S.reissueRecoveryKey(pw);
  if (!rk) return toast('비밀번호가 맞지 않아요.');
  const box = h('div', null);
  const m = modal('새 복구 키', box);
  recoveryStep(box, rk, () => m.close(), '새 복구 키');
  box.querySelector('h1').remove();
  const b = box.querySelector('.btn.solid.block'); if (b) b.textContent = '완료';
}
