// n8n 가져오기용 워크플로우 JSON(워크플로우내보내기.json)을 만든다.
// 프롬프트는 프롬프트템플릿.md 의 "최종"에서, 검사·노션 로직은 check.js·pipeline-core.js 에서 그대로 가져와
// Code 노드에 붙여 넣는다. 로컬 시험(pipeline-test.js)과 같은 코드가 돈다.
// 사용법: node tools/build-workflow.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./pipeline-core');
const { readFinalPrompts } = require('./prompts');
const { loadEnv } = require('./notion');

const ROOT = path.join(__dirname, '..');
const env = loadEnv();
const prompts = readFinalPrompts();

// check.js 의 "검사 함수" 구역만 잘라 온다
const checkSrc = fs.readFileSync(path.join(__dirname, 'check.js'), 'utf8');
const CHECK_FUNCS = checkSrc.slice(checkSrc.indexOf('// ───────── 검사 함수'), checkSrc.indexOf('// ───────── 터미널 실행')).trim();
const src = (...fns) => fns.map((f) => f.toString()).join('\n\n');

const uid = () => crypto.randomUUID();
const TEXT_CRED = { httpHeaderAuth: { name: 'Codyssey API 헤더 인증' } };
const GEMINI_CRED = { httpHeaderAuth: { name: 'Gemini 헤더 인증' } };
const TEXT_URL = `${env.OPENAI_BASE_URL}/chat/completions`;
const NOTION_CRED = { httpHeaderAuth: { name: 'Notion 헤더 인증' } };
const NOTION_VERSION_HEADER = { sendHeaders: true, headerParameters: { parameters: [{ name: 'Notion-Version', value: '2026-03-11' }] } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 };

const nodes = [];
const connections = {};
function add(name, type, typeVersion, position, parameters, extra = {}) {
  nodes.push({ id: uid(), name, type, typeVersion, position, parameters, ...extra });
}
function link(from, to, output = 0) {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= output) connections[from].main.push([]);
  connections[from].main[output].push({ node: to, type: 'main', index: 0 });
}
const code = (jsCode) => ({ jsCode });
const ifDone = () => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ id: uid(), leftValue: '={{ $json.done }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});

// 1. 폼 트리거
add('폼 입력', 'n8n-nodes-base.formTrigger', 2.2, [0, 0], {
  formTitle: 'AI 소셜 콘텐츠 만들기',
  formDescription: '주제를 넣으면 인스타그램·블로그·X 글과 대표 이미지를 만들어 노션에 저장합니다.',
  formFields: {
    values: [
      { fieldLabel: '주제', placeholder: '예: 겨울철 집에서 하는 10분 운동', requiredField: true },
      { fieldLabel: '보는 사람', placeholder: '예: 20~30대 직장인 (비우면 20~30대 직장인)' },
      { fieldLabel: '톤', fieldType: 'dropdown', fieldOptions: { values: [{ option: '친근' }, { option: '전문' }] }, requiredField: true },
      { fieldLabel: '버전', fieldType: 'dropdown', fieldOptions: { values: [{ option: 'A' }, { option: 'B' }] } },
    ],
  },
  options: {},
}, { webhookId: uid() });

// 2. 입력 정리 + 요청 본문 4개 준비
add('입력 정리', 'n8n-nodes-base.code', 2, [240, 0], code(
`// 폼 값을 정리하고, 최종 프롬프트(프롬프트템플릿.md)로 텍스트 생성 요청 본문 4개를 만든다 (Codyssey, OpenAI 호환)
const TEXT_MODEL = ${JSON.stringify(core.TEXT_MODEL)};
const PROMPTS = ${JSON.stringify(prompts, null, 2)};

${src(core.normalizeInput, core.fillPrompt, core.chatBody)}

const input = normalizeInput($input.first().json);
const bodies = {};
for (const k of Object.keys(PROMPTS)) bodies[k] = chatBody(fillPrompt(PROMPTS[k], input), TEXT_MODEL);
return [{ json: { input, bodies } }];`));
link('폼 입력', '입력 정리');

// 3. 플랫폼별: 생성 → 검사 → 완료? (아니면 다시 생성, 최대 3번)
// 화면 배치: 플랫폼마다 한 줄씩 (캡처했을 때 한 화면에 읽히도록)
const ROW = 200;
const PLATFORMS = [
  ['instagram', '인스타그램'],
  ['blog', '블로그'],
  ['x', 'X'],
  ['image', '이미지 프롬프트'],
];
let prev = '입력 정리';
PLATFORMS.forEach(([key, label], i) => {
  const x = 480;
  const y = ROW * (i + 1);
  const gen = `${label} 생성`, chk = `${label} 검사`, done = `${label} 완료?`;
  add(gen, 'n8n-nodes-base.httpRequest', 4.2, [x, y], {
    method: 'POST',
    url: TEXT_URL,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify($('입력 정리').first().json.bodies.${key}) }}`,
    options: { timeout: 120000 },
  }, { credentials: TEXT_CRED, ...RETRY });
  add(chk, 'n8n-nodes-base.code', 2, [x + 240, y], code(
`// 응답을 JSON으로 읽고 기준(글자 수·해시태그·소제목 등)을 검사한다. $runIndex 로 시도 횟수를 센다.
${CHECK_FUNCS}

${src(core.parseModelJson, core.evaluate)}

return [{ json: evaluate(${JSON.stringify(key)}, $input.first().json, $runIndex + 1, ${core.MAX_ATTEMPTS}) }];`));
  add(done, 'n8n-nodes-base.if', 2, [x + 480, y], ifDone());
  link(prev, gen);
  link(gen, chk);
  link(chk, done);
  link(done, gen, 1); // 기준을 벗어나면 다시 생성
  prev = done;
});

// 4. 대표 이미지: 생성 → 노션 업로드 만들기 → 파일로 바꾸기 → 업로드 보내기
const ix = 480;
const iy = ROW * (PLATFORMS.length + 1);
add('이미지 생성', 'n8n-nodes-base.httpRequest', 4.2, [ix, iy], {
  method: 'POST',
  url: `https://generativelanguage.googleapis.com/v1beta/models/${core.IMAGE_MODEL}:generateContent`,
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: "={{ JSON.stringify({ contents: [ { parts: [ { text: $('이미지 프롬프트 검사').last().json.data.image_prompt } ] } ], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } } }) }}",
  options: { timeout: 180000 },
}, { credentials: GEMINI_CRED, ...RETRY });
link(prev, '이미지 생성', 0);

add('노션 업로드 만들기', 'n8n-nodes-base.httpRequest', 4.2, [ix + 240, iy], {
  method: 'POST',
  url: 'https://api.notion.com/v1/file_uploads',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  ...NOTION_VERSION_HEADER,
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '{}',
  options: {},
}, { credentials: NOTION_CRED, ...RETRY });
link('이미지 생성', '노션 업로드 만들기');

add('이미지 꺼내기', 'n8n-nodes-base.code', 2, [ix + 480, iy], code(
`// Gemini 응답에서 이미지(base64)와 형식을 꺼낸다
${src(core.extractGeminiImage)}

return [{ json: extractGeminiImage($('이미지 생성').first().json) }];`));
link('노션 업로드 만들기', '이미지 꺼내기');

add('이미지 파일로', 'n8n-nodes-base.convertToFile', 1.1, [ix + 720, iy], {
  operation: 'toBinary',
  sourceProperty: 'b64',
  binaryPropertyName: 'data',
  options: { fileName: '={{ $json.fileName }}', mimeType: '={{ $json.mime }}' },
});
link('이미지 꺼내기', '이미지 파일로');

add('노션 업로드 보내기', 'n8n-nodes-base.httpRequest', 4.2, [ix, iy + ROW], {
  method: 'POST',
  url: "=https://api.notion.com/v1/file_uploads/{{ $('노션 업로드 만들기').first().json.id }}/send",
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  ...NOTION_VERSION_HEADER,
  sendBody: true,
  contentType: 'multipart-form-data',
  bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' }] },
  options: {},
}, { credentials: NOTION_CRED, ...RETRY });
link('이미지 파일로', '노션 업로드 보내기');

// 5. 노션 행 4개 만들기 → 저장
add('노션 행 만들기', 'n8n-nodes-base.code', 2, [ix + 240, iy + ROW], code(
`// 플랫폼별 결과를 노션 데이터베이스 행 4개(인스타그램·블로그·X·대표 이미지)로 만든다
const DATA_SOURCE_ID = ${JSON.stringify(env.NOTION_DATA_SOURCE_ID || '여기에-노션-데이터소스-ID')};

${src(core.richText, core.markdownToBlocks, core.buildNotionPages)}

const input = $('입력 정리').first().json.input;
const results = {
  instagram: $('인스타그램 검사').last().json,
  blog: $('블로그 검사').last().json,
  x: $('X 검사').last().json,
  image: $('이미지 프롬프트 검사').last().json,
};
const uploadId = $('노션 업로드 만들기').first().json.id;
const fileName = $('이미지 꺼내기').first().json.fileName;
const pages = buildNotionPages(input, results, uploadId, DATA_SOURCE_ID, String($execution.id), fileName);
return pages.map((page) => ({ json: { page } }));`));
link('노션 업로드 보내기', '노션 행 만들기');

add('노션 저장', 'n8n-nodes-base.httpRequest', 4.2, [ix + 480, iy + ROW], {
  method: 'POST',
  url: 'https://api.notion.com/v1/pages',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  ...NOTION_VERSION_HEADER,
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.page) }}',
  options: {},
}, { credentials: NOTION_CRED, ...RETRY });
link('노션 행 만들기', '노션 저장');

const workflow = {
  name: 'AI 소셜 콘텐츠 자동 생성',
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
};
const out = path.join(ROOT, '워크플로우내보내기.json');
fs.writeFileSync(out, JSON.stringify(workflow, null, 2));
console.log(`저장: ${path.relative(ROOT, out)} (노드 ${nodes.length}개)`);
