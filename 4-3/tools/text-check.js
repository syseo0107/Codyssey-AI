// 최종 프롬프트 4개를 한 모델로 돌려 검사한다 (이미지·노션 없이 텍스트만).
// 사용법: node tools/text-check.js <모델> <폴더이름> "주제" [톤] [대상]
// 결과: 4-3/시험기록/<폴더이름>/<모델>_<플랫폼>.json (응답 원문), 요약은 화면에
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./notion');
global.checkAll = require('./check').checkAll;
const core = require('./pipeline-core');
const { readFinalPrompts } = require('./prompts');

(async () => {
  const [model, folder, topic, tone, audience] = process.argv.slice(2);
  if (!model || !folder || !topic) throw new Error('사용법: node tools/text-check.js <모델> <폴더이름> "주제" [톤] [대상]');
  const env = loadEnv();
  const input = core.normalizeInput({ '주제': topic, '톤': tone, '보는 사람': audience });
  const prompts = readFinalPrompts();
  const dir = path.join(__dirname, '..', '시험기록', folder);
  fs.mkdirSync(dir, { recursive: true });
  const tag = topic.slice(0, 6).replace(/\s+/g, '');
  await Promise.all(Object.keys(prompts).map(async (platform) => {
    const res = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(core.chatBody(core.fillPrompt(prompts[platform], input), model)),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { console.log(`[${platform}] 요청 실패 ${res.status} ${j.error?.message || ''}`); return; }
    const content = j.choices?.[0]?.message?.content ?? '';
    fs.writeFileSync(path.join(dir, `${model}_${tag}_${platform}.txt`), content);
    const r = core.evaluate(platform, j, 1, 1);
    const d = r.data || {};
    const len = platform === 'blog' ? [...String(d.body || '')].length
      : platform === 'x' ? [...String(d.post || '')].length
      : platform === 'instagram' ? `태그 ${(d.hashtags || []).length}` : '';
    console.log(`[${platform}] 응답모델 ${j.model} | ${r.pass ? '통과' : '기준 벗어남: ' + r.failed.join(', ')} | ${len}`);
  }));
})().catch((e) => { console.error(e.message); process.exit(1); });
