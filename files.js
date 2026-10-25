// 파일에서 글자 뽑기(txt/docx/pdf) + 생기부 PDF 초안 분류
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export async function extractDocx(file) {
  if (!window.JSZip) throw new Error('docx 읽기 도구가 없어요');
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const f = zip.file('word/document.xml'); if (!f) throw new Error('docx 형식이 아니에요');
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  const out = [];
  const textOf = (node) => {
    let s = '';
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        const ln = c.localName;
        if (ln === 'txbxContent' || ln === 'Fallback') continue; // 텍스트 상자 안은 따로 처리, 대체 콘텐츠는 중복이라 건너뜀
        if (ln === 't') s += c.textContent; else if (ln === 'tab') s += '\t'; else if (ln === 'br' || ln === 'cr') s += '\n'; else walk(c);
      }
    };
    walk(node); return s;
  };
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let a = p.parentNode, skip = false;
    while (a && a.nodeType === 1) { if (a.localName === 'Fallback') { skip = true; break; } a = a.parentNode; }
    if (!skip) out.push(textOf(p));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

let pdfjs;
async function loadPdf() {
  if (!pdfjs) {
    pdfjs = await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}
// 쪽별 줄 목록: [{ y, items:[{str,x}] }]
export async function pdfLines(file) {
  const lib = await loadPdf();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const its = tc.items.filter((i) => i.str && i.str.trim() !== '').map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, hg: i.height || 10 }));
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of its) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) < 3) last.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
    pages.push(lines);
  }
  return pages;
}
// 글자 사이 간격이 벌어진 곳에만 공백을 넣어 한 줄 글자를 만든다 (글자별로 쪼개진 PDF 대응)
function joinItems(items) {
  let text = ''; const starts = [];
  items.forEach((it, k) => {
    if (k) { const p = items[k - 1]; const gap = it.x - (p.x + p.w); if (gap > Math.max(1.2, (p.hg || 10) * 0.22) && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' '; }
    starts.push(text.length); text += it.str;
  });
  return { text, starts };
}
const lineText = (l) => joinItems(l.items).text.replace(/\s+/g, ' ').trim();
// 줄 안에서 정규식에 처음 맞는 글자가 속한 조각의 x 위치
function xOfMatch(l, re) {
  const { text, starts } = joinItems(l.items); const m = re.exec(text); if (!m) return null;
  let k = 0; for (let i = 0; i < starts.length; i++) if (starts[i] <= m.index) k = i;
  return l.items[k].x;
}
export const pdfPlainText = (pages) => pages.map((p) => p.map(lineText).join('\n')).join('\n\n').trim();

export async function extractText(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.docx')) return extractDocx(file);
  if (n.endsWith('.pdf')) return pdfPlainText(await pdfLines(file));
  return (await file.text()).trim();
}

// ---- 생기부 PDF 분류 (학교생활기록부Ⅱ 정부24 사본 양식 기준) ----
// 세특: 학년별 한 칸에 "과목: 내용"이 문단으로 이어짐 → 과목별로 나누고 문단마다 활동 후보로 나눔
// 창체: 학년·영역·시간·특기사항 표 / 행동특성: 학년·내용 표
const cmp = (t) => t.replace(/\s+/g, '');
const PLACEHOLDER = /공공기관의정보공개/;
const FOOT = /\d+\/\d+반\d+번호\d+이름/;
const END_PUNCT = /[.?!…]["'」”’)]?$/;
function joinText(parts) {
  let s = '';
  for (const t of parts) {
    if (!s) { s = t; continue; }
    // 줄바꿈 위치의 띄어쓰기는 PDF에 남아 있지 않아서, 문장 부호 뒤에만 공백을 넣는다
    s += /[.,?!;:)」”’]$/.test(s) ? ' ' + t : t;
  }
  return s.trim();
}
const mkRow = (ln) => {
  const t = lineText(ln);
  return { t, c: cmp(t), y: ln.y, endX: Math.max(...ln.items.map((i) => i.x + i.w)), items: ln.items };
};
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
// 줄 목록 → 문단 목록 (문단의 끝 줄은 문장 부호로 끝나고 오른쪽이 비어 있음). 빈 줄(세로 틈)이 있으면 블록 시작(bs)으로 표시
function toParas(rows) {
  if (!rows.length) return [];
  const R = [...rows.map((r) => r.endX)].sort((a, b) => b - a)[Math.floor(rows.length * 0.04)];
  const cw = median(rows.map((r) => (r.endX - r.startX) / Math.max(1, r.t.length))) || 8;
  const diffs = []; rows.forEach((r, i) => { if (i && r.pg === rows[i - 1].pg) { const d = rows[i - 1].y - r.y; if (d > 0 && d < 30) diffs.push(d); } });
  const pitch = median(diffs) || 12;
  const paras = []; let cur = [], bs = false;
  rows.forEach((r, i) => {
    const blank = i > 0 && r.pg === rows[i - 1].pg && rows[i - 1].y - r.y > pitch * 1.6;
    if (blank && cur.length) { paras.push({ t: joinText(cur), bs }); cur = []; }
    if (!cur.length) bs = blank;
    cur.push(r.t);
    if (END_PUNCT.test(r.t) && R - r.endX > Math.max(10, cw * 1.3)) { paras.push({ t: joinText(cur), bs }); cur = []; }
  });
  if (cur.length) paras.push({ t: joinText(cur), bs });
  return paras;
}
// 두 라벨 사이에서 가장 큰 세로 틈을 행의 경계로 삼는다 (라벨이 칸 가운데 있어도 처리)
function splitRowsByLabels(rows, labelIdx) {
  const starts = [0];
  for (let k = 1; k < labelIdx.length; k++) {
    const a = labelIdx[k - 1], b = labelIdx[k]; let best = b - 1, mx = -1, mn = Infinity;
    for (let j = a; j < b; j++) { const g = rows[j].y - rows[j + 1].y; if (g > mx) { mx = g; best = j; } mn = Math.min(mn, g); }
    starts.push(mx > mn * 1.08 ? best + 1 : b);
  }
  return labelIdx.map((_, k) => rows.slice(starts[k], k + 1 < labelIdx.length ? starts[k + 1] : rows.length));
}
const LABEL_RE = /^\s*(?:\(\s*(\d)\s*학기\s*\)\s*)?([가-힣A-Za-z0-9ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ·ㆍ ]{1,18}?)\s*:\s*(?=\S)/;
const firstPart = (arr) => arr.find((x) => x.length > 0) || '';

export function parseSaenggibu(pages, dbg) {
  const se = { 1: [], 2: [], 3: [], 0: [] };      // 학년 → 세특 줄
  const chGroups = []; const digits = [];          // 창체 항목, 학년 숫자
  const haeng = [];                                // 행동특성 항목
  let mode = '', grade = 0, inBox = false, region = [], cols = null, hcols = null;
  const flush = () => {
    if (region.length) {
      if (mode === 'changche' && cols) parseChangche(region, cols, chGroups, digits);
      else if (mode === 'haeng') parseHaeng(region, haeng);
    }
    region = [];
  };
  pages.forEach((lines, pg) => {
    inBox = false;
    for (const ln of lines) {
      const r = mkRow(ln); const c = r.c; r.pg = pg; r.startX = ln.items[0].x;
      if (/^문서확인번호/.test(c) || FOOT.test(c)) continue;
      if (/^\d{1,2}\.[가-힣]/.test(c) && c.length < 24) {
        flush();
        mode = /^\d\.창의적체험활동상황/.test(c) ? 'changche' : /^\d\.교과학습발달상황/.test(c) ? 'seteuk' : /^\d\.행동특성및종합의견/.test(c) ? 'haeng' : '';
        if (mode === 'seteuk') grade = 0;
        inBox = false; cols = null; hcols = null; continue;
      }
      if (/봉사활동실적/.test(c)) { flush(); mode = ''; continue; }
      if (mode === 'seteuk') {
        const gm = c.match(/^\[(\d)학년\]$/); if (gm) { grade = +gm[1]; inBox = false; continue; }
        if (/^[〈<＜]/.test(c) || /^이수학점합계/.test(c) || /^학기교과과목/.test(c)) { inBox = false; continue; }
        if (/세부능력및특기사항/.test(c) && /^과목/.test(c)) { inBox = true; continue; }
        if (!inBox || PLACEHOLDER.test(c) || c === '해당사항없음' || /^(않습니다\.?|제공하지)$/.test(c)) continue;
        se[grade].push(r);
      } else if (mode === 'changche' || mode === 'haeng') {
        if (c === '학년') { hcols = hcols || {}; hcols.g = ln.items[0]; continue; }
        if (/^학년?창의적체험활동상황$|^학년행동특성및종합의견$|^행동특성및종합의견$/.test(c)) continue;
        if (mode === 'changche' && /^영역시간특기사항$/.test(c) && ln.items.length >= 3) {
          flush();
          const [a, t] = ln.items; const gEnd = hcols && hcols.g ? hcols.g.x + hcols.g.w : a.x - 30;
          cols = { areaX: (gEnd + a.x) / 2, timeX: (a.x + a.w + t.x) / 2, contentX: t.x + t.w + 6 }; continue;
        }
        region.push(r);
      }
    }
    flush();
  });
  if (dbg) { dbg.ch = chGroups.map((g) => ({ l: g.label, idx: g.idx, len: g.text.length, head: g.text.slice(0, 14) })); dbg.digits = digits; }
  const out = [];
  // 세특: 문단 시작의 "과목:" 로 과목을 나누고, 라벨 없이 빈 줄 뒤에 나온 글(학교자율교육과정 등)은 따로 둔다
  for (const g of [1, 2, 3]) {
    const paras = toParas(se[g]); const subs = []; let cur = null;
    const get = (name) => subs.find((s) => s.name === name) || (subs.push({ name, paras: [] }), subs[subs.length - 1]);
    for (const p of paras) {
      const m = p.t.match(LABEL_RE);
      if (m) { cur = get(m[2].trim()); cur.paras.push(p.t); }
      else if (/^학교자율/.test(p.t) || !cur) { cur = get(/^학교자율/.test(p.t) ? '학교자율교육과정' : '(과목 미확인)'); cur.paras.push(p.t); }
      else cur.paras.push(p.t);
    }
    subs.forEach((s) => out.push({ grade: g, label: s.name, kind: '세특', text: s.paras.join('\n') }));
  }
  // 창체: 영역 순서가 처음으로 돌아가면 다음 학년
  let gi = -1, last = 99;
  chGroups.forEach((e) => {
    if (e.idx <= last) gi++; last = e.idx;
    const g = digits[gi] || gi + 1;
    if (e.text && !PLACEHOLDER.test(cmp(e.text))) out.push({ grade: g, label: e.label, kind: '창체', text: e.text });
  });
  haeng.forEach((e) => { if (e.text && !PLACEHOLDER.test(cmp(e.text))) out.push(e); });
  const order = { 세특: 0, 창체: 1, 행특: 2 };
  return out.sort((a, b) => a.grade - b.grade || order[a.kind] - order[b.kind]);
}

const AREAS = ['자율활동', '동아리활동', '진로활동', '봉사활동'];
function parseChangche(region, cols, groups, digits) {
  const rows = [];
  for (const r of region) {
    const g = r.items.filter((i) => i.x < cols.areaX), a = r.items.filter((i) => i.x >= cols.areaX && i.x < cols.timeX), c = r.items.filter((i) => i.x >= cols.contentX);
    g.forEach((i) => { const m = i.str.trim().match(/^[1-3]$/); if (m && digits[digits.length - 1] !== +m[0]) digits.push(+m[0]); });
    const area = cmp(a.map((i) => i.str).join('')), text = joinItems(c).text.trim();
    if (!text && !area) continue;
    if (/^희망분야/.test(cmp(text)) && text.length < 24) continue;
    rows.push({ area, t: text, y: r.y, pg: r.pg, endX: c.length ? Math.max(...c.map((i) => i.x + i.w)) : 0, startX: c.length ? c[0].x : 0 });
  }
  const labelIdx = rows.map((r, i) => (r.area ? i : -1)).filter((i) => i >= 0);
  if (!labelIdx.length) return;
  const parts = splitRowsByLabels(rows, labelIdx);
  parts.forEach((rs, k) => {
    const area = rows[labelIdx[k]].area; const idx = AREAS.findIndex((x) => area.includes(x.slice(0, 2)));
    const text = toParas(rs.filter((x) => x.t)).map((p) => p.t).join('\n');
    groups.push({ label: area, idx: idx < 0 ? 9 : idx, text });
  });
}
function parseHaeng(region, out) {
  const rows = region.map((r) => ({ lt: '', ...r }));
  const gx = Math.min(...rows.map((r) => r.items[0].x));
  const rr = region.map((r) => {
    const left = r.items.filter((i) => i.x < gx + 14 && /^[1-3]$/.test(i.str.trim())), right = r.items.filter((i) => !left.includes(i));
    return { pg: r.pg, d: left.length ? +left[0].str.trim() : 0, t: joinItems(right).text.trim(), y: r.y, endX: right.length ? Math.max(...right.map((i) => i.x + i.w)) : 0, startX: right.length ? right[0].x : 0 };
  });
  const li = rr.map((r, i) => (r.d ? i : -1)).filter((i) => i >= 0);
  if (!li.length) return;
  splitRowsByLabels(rr, li).forEach((rs, k) => {
    const text = toParas(rs.filter((x) => x.t)).map((p) => p.t).join('\n');
    out.push({ grade: rr[li[k]].d, label: '행동특성 및 종합의견', kind: '행특', text });
  });
}

// ---- 붙여 넣은 글(직접 입력 · 3학년 한꺼번에 입력) 분류 ----
// "과목: 내용" 으로 시작하는 줄, 또는 [과목] / 【과목】 / ■ 과목 처럼 따로 적은 제목 줄이 새 과목의 시작. 엔터(줄)마다 문단(활동 후보)
const HEAD_RE = /^\s*[\[【■▶●◆▣]\s*([^\]】:\n]{1,20}?)\s*[\]】]?\s*$/;
const AREA_RE = /^\s*(자율활동|동아리활동|진로활동|봉사활동|행동특성\s*및\s*종합의견|독서활동(?:상황)?)\s*:?\s*$/;
export function parseBulkText(text, grade) {
  const out = []; let cur = null;
  const start = (name, kind) => { cur = { grade, label: name, kind: kind || '세특', paras: [] }; out.push(cur); };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const hm = line.match(HEAD_RE) || line.match(AREA_RE);
    if (hm && line.length <= 24 && !/[.!?。]$/.test(line)) { const n = hm[1].replace(/\s+/g, ' ').trim(); start(n, /활동$|독서|행동/.test(n) ? '창체' : '세특'); continue; }
    const lm = line.match(LABEL_RE);
    if (lm) { const n = lm[2].trim(); if (!cur || cur.label !== n) start(n); cur.paras.push(line); continue; }
    if (!cur) start('');
    cur.paras.push(line);
  }
  return out.filter((e) => e.paras.length).map((e) => ({ grade: e.grade, label: e.label, kind: e.kind, text: e.paras.join('\n') }));
}
