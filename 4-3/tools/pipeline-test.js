// n8n 워크플로우와 같은 순서·같은 요청 본문으로 전체 파이프라인을 로컬에서 한 번 돌린다.
// (주제 → 텍스트 4종 생성·검사·재생성 → 이미지 생성 → 노션 업로드 → 노션 행 4개)
// 사용법: node tools/pipeline-test.js "주제" [톤] [대상] [버전]
// 필요: 4-3/.env 에 OPENAI_API_KEY, NOTION_TOKEN, NOTION_DATA_SOURCE_ID
// 결과 원본은 4-3/시험기록/pipeline/ 에 저장한다.
const fs = require('fs');
const path = require('path');
const { loadEnv, api: notion } = require('./notion');
global.checkAll = require('./check').checkAll;
const core = require('./pipeline-core');
const { readFinalPrompts } = require('./prompts');

async function openai(env, endpoint, body) {
  const res = await fetch(`${env.OPENAI_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`텍스트 API ${endpoint} 실패: ${res.status} ${data.error?.message || ''}`);
  return data;
}

async function gemini(env, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${core.IMAGE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(core.geminiImageBody(prompt)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini 이미지 실패: ${res.status} ${data.error?.message || ''}`);
  return data;
}

(async () => {
  const env = loadEnv();
  for (const k of ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'NOTION_DATA_SOURCE_ID']) if (!env[k]) throw new Error(`.env 에 ${k} 가 없습니다.`);
  const input = core.normalizeInput({ '주제': process.argv[2] || '겨울철 집에서 하는 10분 운동', '톤': process.argv[3], '보는 사람': process.argv[4], '버전': process.argv[5] });
  const prompts = readFinalPrompts();
  const runId = `local-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  const outDir = path.join(__dirname, '..', '시험기록', 'pipeline', runId);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`입력: ${JSON.stringify(input)}`);

  // 1) 텍스트 4종: 병렬 생성, 기준을 벗어나면 최대 3번까지
  const results = {};
  await Promise.all(Object.keys(prompts).map(async (platform) => {
    const body = core.chatBody(core.fillPrompt(prompts[platform], input), core.TEXT_MODEL);
    for (let attempt = 1; ; attempt++) {
      const resp = await openai(env, '/chat/completions', body);
      const r = core.evaluate(platform, resp, attempt, core.MAX_ATTEMPTS);
      fs.writeFileSync(path.join(outDir, `${platform}_try${attempt}.json`), JSON.stringify(resp.choices?.[0]?.message?.content ?? resp, null, 2));
      console.log(`[${platform}] 시도 ${attempt}: ${r.pass ? '통과' : '기준 벗어남 ' + r.failed.join(', ')}`);
      if (r.done) { results[platform] = r; break; }
    }
  }));

  // 2) 대표 이미지 생성 (Gemini)
  const img = core.extractGeminiImage(await gemini(env, results.image.data.image_prompt));
  const png = Buffer.from(img.b64, 'base64');
  fs.writeFileSync(path.join(outDir, img.fileName), png);
  console.log(`이미지 생성: ${img.mime}, ${png.length} bytes`);

  // 3) 노션 파일 업로드 (만들기 → 보내기)
  const upload = await notion(env, 'POST', '/file_uploads', {});
  const form = new FormData();
  form.append('file', new Blob([png], { type: img.mime }), img.fileName);
  const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${upload.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2026-03-11' },
    body: form,
  });
  const sent = await sendRes.json();
  if (!sendRes.ok) throw new Error(`노션 파일 보내기 실패: ${sendRes.status} ${sent.message || ''}`);
  console.log(`노션 업로드: ${sent.status}`);

  // 4) 노션 행 4개
  const pages = core.buildNotionPages(input, results, upload.id, env.NOTION_DATA_SOURCE_ID, runId, img.fileName);
  fs.writeFileSync(path.join(outDir, 'notion_pages.json'), JSON.stringify(pages, null, 2));
  for (const page of pages) {
    const res = await notion(env, 'POST', '/pages', page);
    console.log(`노션 행: ${page.properties['플랫폼'].select.name} → ${res.url}`);
  }
  console.log(`원본 저장: ${path.relative(path.join(__dirname, '..'), outDir)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
