// 노션 API 공통 도우미 (Node 18 이상, 외부 패키지 없음)
// 토큰은 4-3/.env 에서만 읽고 화면에 출력하지 않는다.
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const NOTION_VERSION = '2026-03-11';

function parseEnvFile(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error('4-3/.env 가 없습니다. .env.example 을 복사해 값을 채워 주세요.');
  }
  const env = parseEnvFile(ENV_PATH);
  // OpenAI 키가 비어 있으면 리브레챗 .env(LIBRECHAT_ENV)에서 가져온다. 키를 두 군데 복사해 두지 않기 위해서다.
  if (!env.OPENAI_API_KEY && env.LIBRECHAT_ENV && fs.existsSync(env.LIBRECHAT_ENV)) {
    const lc = parseEnvFile(env.LIBRECHAT_ENV);
    if (lc.OPENAI_API_KEY && lc.OPENAI_API_KEY !== 'user_provided') env.OPENAI_API_KEY = lc.OPENAI_API_KEY;
    // 리브레챗이 OpenAI 호환 중계 서버(예: Codyssey API)를 쓰면 그 주소도 같이 가져온다
    if (!env.OPENAI_BASE_URL && lc.OPENAI_REVERSE_PROXY) env.OPENAI_BASE_URL = lc.OPENAI_REVERSE_PROXY;
  }
  env.OPENAI_BASE_URL = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (!env.NOTION_TOKEN) throw new Error('.env 의 NOTION_TOKEN 이 비어 있습니다.');
  return env;
}

// .env 의 특정 키 값만 바꾸거나 추가한다 (다른 줄은 그대로)
function saveEnv(key, value) {
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(ENV_PATH, text);
}

// 링크나 하이픈 있는 ID에서 32자리 ID만 뽑는다
function pageIdFrom(input) {
  const hex = String(input || '').replace(/-/g, '').match(/[0-9a-f]{32}/gi);
  if (!hex) throw new Error('NOTION_PARENT_PAGE 에서 페이지 ID를 찾지 못했습니다.');
  return hex[hex.length - 1];
}

async function api(env, method, endpoint, body) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 404
      ? ' (페이지를 통합에 연결했는지 확인: 페이지 ••• → 연결 → 통합 선택)'
      : res.status === 401 ? ' (NOTION_TOKEN 값을 확인)' : '';
    throw new Error(`노션 API ${method} ${endpoint} 실패: ${res.status} ${data.code || ''} ${data.message || ''}${hint}`);
  }
  return data;
}

// 2,000자 제한에 맞춰 rich_text 배열로 나눈다
function richText(text) {
  const s = String(text ?? '');
  const parts = [];
  for (let i = 0; i < s.length; i += 2000) parts.push({ type: 'text', text: { content: s.slice(i, i + 2000) } });
  return parts.length ? parts : [];
}

// 블로그 마크다운 본문을 노션 블록(소제목·문단)으로 바꾼다
function markdownToBlocks(md) {
  const blocks = [];
  for (const para of String(md || '').split(/\n{2,}/)) {
    for (const [i, line] of para.split('\n').entries()) {
      const t = line.trim();
      if (!t) continue;
      const h = t.match(/^##\s+(.*)$/);
      if (h) blocks.push({ type: 'heading_2', heading_2: { rich_text: richText(h[1]) } });
      else if (i === 0 || !blocks.length || blocks[blocks.length - 1].type !== 'paragraph') {
        blocks.push({ type: 'paragraph', paragraph: { rich_text: richText(t) } });
      } else {
        // 같은 문단의 이어진 줄은 줄바꿈으로 붙인다
        blocks[blocks.length - 1].paragraph.rich_text.push(...richText('\n' + t));
      }
    }
  }
  return blocks;
}

module.exports = { loadEnv, saveEnv, pageIdFrom, api, richText, markdownToBlocks, NOTION_VERSION };
