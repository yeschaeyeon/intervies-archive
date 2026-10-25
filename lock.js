// 최초 설정 / 잠금 해제 / 복구 키 / 백업으로 시작
import { h, clear, toast, download, pickFile, promptBox, confirmBox } from './util.js';
import * as S from './store.js';
import { newRecoveryKey } from './crypto.js';
import { pdfLines, parseSaenggibu } from './files.js';
import { applyEntries } from './intake.js';
import { openDownloadGuide } from './dlguide.js';
import { renderPrep } from './prep.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = async (btn, label, fn) => {
  const t = btn.textContent; btn.disabled = true; btn.textContent = label;
  await wait(30);
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = t; }
};

export function renderLock(root) {
  clear(root);
  const box = h('div', { class: 'gate' });
  root.append(box);
  if (!S.hasMeta()) welcome(box); else unlockView(box);
}

let pending = null; // 온보딩에서 읽은 생기부 분류 결과 (비밀번호를 정한 뒤 저장)
const stepTag = (n) => h('p', { class: 'sub' }, `${n} / 5`);

function welcome(box) {
  const pt = (t, d) => h('div', { class: 'card' }, h('b', null, t), h('p', { class: 'sub' }, d));
  box.append(stepTag(1), h('h1', null, '생기부 아카이브'), h('p', { class: 'sub' }, '학생용 · 면접 준비 자료를 안전하게 모아 두는 곳'),
    pt('내 기기에만 저장돼요', '외부 서버와 연결하지 않고 이 기기에만 저장해요. 그래서 내 생기부가 어디로 전송될까 걱정하지 않아도 돼요. 저장할 때는 비밀번호로 암호화해요.'),
    pt('다른 기기로 옮기기', '설정에서 데이터 파일을 다운로드하고, 다른 기기에서 그 파일과 비밀번호만 있으면 그대로 이어서 쓸 수 있어요.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn solid block', onclick: () => { clear(box); uploadStep(box); } }, '다음'),
      h('button', { class: 'btn block', onclick: () => startFromBackup(box) }, '이미 쓰던 데이터 파일이 있어요')));
}

function uploadStep(box) {
  const out = h('div', { class: 'stack' });
  const next = h('button', { class: 'btn solid block', onclick: () => { clear(box); passwordStep(box); } }, pending ? '이 결과로 계속' : '파일 없이 계속');
  const pick = async () => {
    const [f] = await pickFile('.pdf,application/pdf'); if (!f) return;
    out.replaceChildren(h('p', null, '읽고 분류하는 중…')); await wait(30);
    try {
      const entries = parseSaenggibu(await pdfLines(f));
      if (!entries.length) { pending = null; out.replaceChildren(h('p', { class: 'err' }, '자동으로 나누지 못했어요. 글자가 있는 PDF인지 확인해 주세요. 지금은 건너뛰고, 시작한 뒤 "직접 입력"이나 "한꺼번에 입력"으로 넣을 수 있어요.')); next.textContent = '파일 없이 계속'; return; }
      pending = entries;
      const gs = [1, 2, 3].map((g) => { const es = entries.filter((e) => e.grade === g); return [g, new Set(es.map((e) => e.label)).size, es.reduce((n, e) => n + e.text.split(/\n+/).filter((x) => x.trim()).length, 0)]; }).filter((x) => x[1]);
      out.replaceChildren(h('div', { class: 'note' }, h('b', null, '분류했어요'),
        h('div', { class: 'pre' }, gs.map(([g, a, b]) => `${g}학년 · 과목·영역 ${a}개 · 활동 후보 ${b}개`).join('\n') + (gs.some((x) => x[0] === 3) ? '' : '\n3학년은 기록이 없어서 건너뛰었어요. 나중에 추가할 수 있어요.')),
        '비밀번호를 정하면 저장돼요. 잘못 나뉜 부분은 시작한 뒤에 고칠 수 있어요.'));
      next.textContent = '이 결과로 계속';
    } catch (e) { console.error(e); pending = null; out.replaceChildren(h('p', { class: 'err' }, '파일을 읽지 못했어요: ' + e.message)); next.textContent = '파일 없이 계속'; }
  };
  box.append(stepTag(2), h('h1', null, '생기부 파일을 넣어 주세요'),
    h('p', null, '생기부 PDF 파일만 올리면 학년 · 과목 · 활동으로 자동 분류해 드려요.'),
    h('div', { class: 'note' }, h('b', null, '3학년 전체 기록이 없어도 괜찮아요'), '3학년 생기부는 공개되지 않는 경우가 많아요. 나중에 추가할 수 있어요.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn solid block', onclick: pick }, '생기부 PDF 선택'),
      h('button', { class: 'btn block', onclick: openDownloadGuide }, '생기부 다운로드 방법이 궁금해요')),
    out, next);
}

function passwordStep(box) {
  const pw = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: '8자 이상' });
  const pw2 = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: '한 번 더' });
  const msg = h('p', { class: 'err' });
  const memo = h('input', { type: 'checkbox' });
  const go = h('button', { class: 'btn solid block', onclick: async () => {
    msg.textContent = '';
    if (!memo.checked) return (msg.textContent = '비밀번호를 메모했는지 체크해 주세요.');
    if (pw.value.length < 8) return (msg.textContent = '비밀번호는 8자 이상이어야 해요.');
    if (pw.value !== pw2.value) return (msg.textContent = '두 비밀번호가 달라요.');
    const rk = newRecoveryKey();
    S.gate.hold = true; // 복구 키를 확인하기 전에는 앱 화면으로 넘어가지 않음
    await busy(go, '암호화 준비 중…', async () => { await S.setup(pw.value, rk); if (pending) { applyEntries(pending, true); pending = null; } });
    clear(box); recoveryStep(box, rk, () => { clear(box); renderPrep(box, () => { S.gate.hold = false; S.gate.release(); }); });
  } }, '다음');
  box.append(stepTag(3), h('h1', null, '앱 잠금 비밀번호'),
    h('div', { class: 'note' }, h('b', null, '잊으면 되돌릴 수 없어요. 꼭 메모해 두세요'), '서버가 없어서 비밀번호를 대신 찾아 줄 수 없어요. 다음 단계에서 나오는 복구 키도 따로 보관하세요.'),
    h('label', { class: 'lbl' }, '비밀번호'), pw, h('label', { class: 'lbl' }, '비밀번호 확인'), pw2,
    h('label', { class: 'check' }, memo, h('span', null, '비밀번호를 안전한 곳에 메모했어요')), msg, h('div', { class: 'row' }, go));
  pw.focus();
}

// 복구 키 보여주기(최초 1회). onDone 호출 후 앱 진입은 lock 상태 변화로 처리됨
export function recoveryStep(box, rk, onDone, title = '복구 키') {
  const chk = h('input', { type: 'checkbox', id: 'rk-ok' });
  const go = h('button', { class: 'btn solid block', disabled: true, onclick: () => onDone() }, '다음');
  chk.addEventListener('change', () => { go.disabled = !chk.checked; });
  box.append(title === '복구 키' ? stepTag(4) : null, h('h1', null, title),
    h('p', null, '비밀번호를 잊었을 때 이 복구 키로 데이터를 열 수 있어요. 지금 한 번만 보여드리고, 앱 안에는 저장하지 않아요.'),
    h('div', { class: 'rkbox' }, rk),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(rk); toast('복사했어요'); } catch { toast('복사할 수 없어요. 직접 선택해서 복사해 주세요.'); } } }, '복사'),
      h('button', { class: 'btn', onclick: () => download(new Blob([`생기부 아카이브 복구 키\n\n${rk}\n\n※ 이 키가 있으면 누구나 데이터를 열 수 있어요. 종이에 적거나 비밀번호 관리자에 보관하세요.\n`], { type: 'text/plain' }), '생기부-복구키.txt') }, '텍스트 파일 저장'),
      h('button', { class: 'btn', onclick: () => printKey(rk) }, '인쇄')),
    h('div', { class: 'note' }, '휴대폰 메모나 메일 대신 종이나 비밀번호 관리자에 보관하세요. 비밀번호와 복구 키를 모두 잃으면 누구도 복구할 수 없어요.'),
    h('label', { class: 'check' }, chk, h('span', null, '복구 키를 안전한 곳에 저장했어요')), go);
}
function printKey(rk) {
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 막혀 있어요. 텍스트 파일로 저장해 주세요.');
  w.document.write(`<title>복구 키</title><body style="font:20px sans-serif;padding:40px"><h2>생기부 아카이브 복구 키</h2><p style="font:700 28px monospace">${rk}</p><p>이 키가 있으면 누구나 데이터를 열 수 있어요. 안전한 곳에 보관하세요.</p>`);
  w.document.close(); w.print();
}

async function startFromBackup(box) {
  const [f] = await pickFile('.saenggibu,application/octet-stream');
  if (!f) return;
  try { await S.readBackupHeader(f); } catch (e) { return toast(e.message); }
  const secret = await promptBox('백업 열기', '백업을 만들 때의 비밀번호 또는 복구 키');
  if (!secret) return;
  toast('여는 중… (몇 초 걸릴 수 있어요)');
  await wait(30);
  const op = await S.openBackup(f, secret);
  if (!op) return toast('비밀번호나 복구 키가 맞지 않아요.');
  const r = await S.startFromBackup(f, op);
  toast(`불러왔어요 (항목 ${r.added}개, 녹음·영상 ${r.mediaIn}개)`);
}

function unlockView(box) {
  const pw = h('input', { class: 'inp', type: 'password', autocomplete: 'current-password', placeholder: '비밀번호' });
  const msg = h('p', { class: 'err' });
  const go = h('button', { class: 'btn solid block', onclick: attempt }, '열기');
  const fails = () => S.pref('fails', 0), until = () => S.pref('until', 0);
  async function attempt() {
    const left = until() - Date.now();
    if (left > 0) return (msg.textContent = `잠시 후 다시 시도해 주세요 (${Math.ceil(left / 1000)}초)`);
    if (!pw.value) return;
    const ok = await busy(go, '여는 중…', () => S.unlock(pw.value));
    if (!ok) {
      const n = fails() + 1; S.setPref('fails', n);
      if (n >= 5) S.setPref('until', Date.now() + Math.min(600, 15 * (n - 4)) * 1000);
      msg.textContent = '비밀번호가 맞지 않아요.'; pw.value = ''; pw.focus();
    } else { S.setPref('fails', 0); S.setPref('until', 0); }
  }
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  box.append(h('h1', null, '잠겨 있어요'), pw, msg, h('div', { class: 'row' }, go),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { clear(box); recoverView(box); } }, '복구 키로 열기'),
      h('button', { class: 'btn sm ghost-danger', onclick: resetAll }, '모두 지우고 새로 시작')));
  pw.focus();
}
async function resetAll() {
  const t = await promptBox('모두 지우기', '이 기기의 모든 데이터가 영구 삭제돼요. 계속하려면 "삭제"를 입력하세요.');
  if (t !== '삭제') return;
  await S.wipeAll(); location.reload();
}
function recoverView(box) {
  const rk = h('input', { class: 'inp', placeholder: 'XXXX-XXXX-XXXX-…', autocapitalize: 'characters', spellcheck: false });
  const a = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호 (8자 이상)' });
  const b = h('input', { class: 'inp', type: 'password', autocomplete: 'new-password', placeholder: '새 비밀번호 확인' });
  const msg = h('p', { class: 'err' });
  const go = h('button', { class: 'btn solid block', onclick: async () => {
    if (a.value.length < 8) return (msg.textContent = '새 비밀번호는 8자 이상이어야 해요.');
    if (a.value !== b.value) return (msg.textContent = '새 비밀번호가 서로 달라요.');
    const ok = await busy(go, '여는 중…', () => S.unlockWithRecovery(rk.value, a.value));
    if (!ok) msg.textContent = '복구 키가 맞지 않아요.';
  } }, '복구 키로 열고 비밀번호 바꾸기');
  box.append(h('h1', null, '복구 키로 열기'), h('label', { class: 'lbl' }, '복구 키'), rk, h('label', { class: 'lbl' }, '새 비밀번호'), a, b, msg, h('div', { class: 'row' }, go),
    h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => renderLock(box.parentElement) }, '← 돌아가기')));
}
