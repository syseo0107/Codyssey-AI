// 워크플로우의 공통 로직. 로컬 시험(pipeline-test.js)과 n8n Code 노드(build-workflow.js가 붙여 넣음)가
// 똑같은 함수를 쓰도록 한곳에 둔다. 함수마다 바깥 변수에 기대지 않게 써서 소스째 복사할 수 있다.

// 텍스트: Codyssey 중계 서버(OpenAI 호환). gpt-5.4-mini 는 요청한 모델이 그대로 답하고 최종 프롬프트 8/8 통과
// (gpt-5.5·gpt-5.4 는 서버가 gpt-5-mini 로 바꿔 답함)
const TEXT_MODEL = 'gpt-5.4-mini';
// 이미지: Gemini API 최신 이미지 모델 (Codyssey 서버에는 이미지 생성 기능이 없음)
const IMAGE_MODEL = 'gemini-3.1-flash-image';
const MAX_ATTEMPTS = 3;

// 폼 입력을 정리한다. 폼 항목 이름(한국어)을 영어 키로 바꾼다.
function normalizeInput(form) {
  return {
    topic: String(form['주제'] || form.topic || '').trim(),
    audience: String(form['보는 사람'] || form.audience || '').trim() || '20~30대 직장인',
    tone: String(form['톤'] || form.tone || '').trim() || '친근',
    version: String(form['버전'] || form.version || '').trim() || 'A',
  };
}

// 프롬프트의 n8n 표현식 자리를 실제 값으로 바꾼다
function fillPrompt(prompt, input) {
  return prompt
    .split('{{ $json.topic }}').join(input.topic)
    .split('{{ $json.audience }}').join(input.audience)
    .split('{{ $json.tone }}').join(input.tone);
}

// Codyssey 중계 서버는 response_format(JSON 모드)을 지원하지 않아 넣지 않는다.
// JSON 형식은 프롬프트 규칙과 검사(evaluate)의 재생성으로 맞춘다.
function chatBody(prompt, model) {
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
  };
}

// 모델 응답에서 JSON을 꺼낸다 (코드 블록 표시가 붙어 와도 읽는다)
function parseModelJson(content) {
  const s = String(content || '').replace(/```(?:json)?/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  return JSON.parse(start >= 0 && end > start ? s.slice(start, end + 1) : s);
}

// 응답 하나를 검사해 결과를 만든다. checkAll은 check.js의 검사 함수.
function evaluate(platform, apiResponse, attempt, maxAttempts) {
  const content = apiResponse && apiResponse.choices && apiResponse.choices[0] && apiResponse.choices[0].message
    ? apiResponse.choices[0].message.content : '';
  let data = null;
  let failed = [];
  let pass = false;
  try {
    data = parseModelJson(content);
    const r = checkAll({ [platform]: data })[platform];
    pass = r.pass;
    failed = r.failed;
  } catch (e) {
    failed = ['JSON 파싱 실패: ' + e.message];
  }
  return { platform, data, pass, failed, attempt, done: pass || attempt >= maxAttempts };
}

// Gemini 이미지 생성 요청 본문 (generateContent, 이미지 출력, 정사각형)
function geminiImageBody(prompt) {
  return {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  };
}

// Gemini 응답에서 이미지(base64)와 형식을 꺼낸다
function extractGeminiImage(resp) {
  const parts = (resp && resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) || [];
  const part = parts.find((p) => p.inlineData || p.inline_data);
  if (!part) {
    const why = (resp && resp.candidates && resp.candidates[0] && resp.candidates[0].finishReason) || JSON.stringify(resp).slice(0, 200);
    throw new Error('Gemini 응답에 이미지가 없습니다: ' + why);
  }
  const d = part.inlineData || part.inline_data;
  const mime = d.mimeType || d.mime_type || 'image/png';
  return { b64: d.data, mime, fileName: 'cover.' + (mime.split('/')[1] || 'png').replace('jpeg', 'jpg') };
}

function richText(text) {
  const s = String(text == null ? '' : text);
  const parts = [];
  for (let i = 0; i < s.length; i += 2000) parts.push({ type: 'text', text: { content: s.slice(i, i + 2000) } });
  return parts;
}

function markdownToBlocks(md) {
  const blocks = [];
  for (const para of String(md || '').split(/\n{2,}/)) {
    const lines = para.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const h = t.match(/^##\s+(.*)$/);
      if (h) blocks.push({ type: 'heading_2', heading_2: { rich_text: richText(h[1]) } });
      else if (i === 0 || !blocks.length || blocks[blocks.length - 1].type !== 'paragraph') {
        blocks.push({ type: 'paragraph', paragraph: { rich_text: richText(t) } });
      } else {
        blocks[blocks.length - 1].paragraph.rich_text.push(...richText('\n' + t));
      }
    }
  }
  return blocks.slice(0, 100);
}

// 노션 행 4개의 요청 본문을 만든다
function buildNotionPages(input, results, uploadId, dataSourceId, runId, fileName) {
  const para = (text) => ({ type: 'paragraph', paragraph: { rich_text: richText(text) } });
  const ig = results.instagram.data || {};
  const blog = results.blog.data || {};
  const x = results.x.data || {};
  const img = results.image.data || {};
  const tags = Array.isArray(ig.hashtags) ? ig.hashtags.join(' ') : String(ig.hashtags || '');
  const rows = [
    { platform: '인스타그램', title: `${input.topic} · 인스타그램`, body: ig.caption, tags, hook: ig.hook_type,
      r: results.instagram, children: [para(`${ig.caption || ''}\n\n${tags}`)] },
    { platform: '블로그', title: blog.title || `${input.topic} · 블로그`, body: blog.body,
      r: results.blog, children: markdownToBlocks(blog.body) },
    { platform: 'X', title: `${input.topic} · X`, body: x.post, hook: x.hook_type,
      r: results.x, children: [para(x.post)] },
    { platform: '대표 이미지', title: `${input.topic} · 대표 이미지`, body: img.image_prompt,
      r: results.image, image: true, children: [para(img.image_prompt)] },
  ];
  return rows.map((row) => {
    const body = String(row.body || '');
    const properties = {
      '제목': { title: richText(row.title) },
      '주제': { rich_text: richText(input.topic) },
      '플랫폼': { select: { name: row.platform } },
      '본문': { rich_text: richText(body) },
      '톤': { select: { name: input.tone } },
      '대상': { rich_text: richText(input.audience) },
      '버전': { select: { name: input.version } },
      '글자 수': { number: [...body].length },
      '검사 통과': { checkbox: Boolean(row.r.pass) },
      '실행 ID': { rich_text: richText(runId) },
    };
    if (row.tags) properties['해시태그'] = { rich_text: richText(row.tags) };
    if (row.hook) properties['훅 유형'] = { select: { name: String(row.hook).slice(0, 100) } };
    const children = row.children.slice();
    if (row.image && uploadId) {
      properties['이미지'] = { files: [{ type: 'file_upload', file_upload: { id: uploadId }, name: fileName || 'cover.png' }] };
    }
    if (!row.r.pass) children.unshift(para(`검사 기준을 벗어남 (시도 ${row.r.attempt}회): ${row.r.failed.join(', ')}`));
    return {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties,
      children: children.slice(0, 100),
    };
  });
}

if (typeof module !== 'undefined') {
  module.exports = {
    TEXT_MODEL, IMAGE_MODEL, MAX_ATTEMPTS,
    normalizeInput, fillPrompt, chatBody, parseModelJson, evaluate, geminiImageBody, extractGeminiImage, richText, markdownToBlocks, buildNotionPages,
  };
}
