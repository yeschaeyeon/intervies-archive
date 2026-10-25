import { buildPack, toModule } from './prompt-pack.js';
const $ = (id) => document.getElementById(id);
$('go').onclick = async () => {
  const o = { imp: $('p0').value.trim(), organize: $('p1').value.trim(), questions: $('p2').value.trim(), ref: $('p3').value.trim() };
  if (!o.imp || !o.organize || !o.questions || !o.ref) return ($('msg').textContent = '네 프롬프트를 모두 입력해 주세요.');
  const code = $('c').value.trim();
  const blob = new Blob([toModule(await buildPack(JSON.stringify(o), code))], { type: 'text/javascript' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'qprompt.js'; a.click();
  $('msg').textContent = 'qprompt.js 를 내려받았어요. 사이트의 js/qprompt.js 를 이 파일로 바꿔 올리세요.' + (code ? ' (이용 코드: 사용자에게 따로 알려 주세요)' : '');
};
