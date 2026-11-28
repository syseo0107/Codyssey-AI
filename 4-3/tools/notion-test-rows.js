// 시험기록의 결과 한 벌(인스타그램·블로그·X·이미지 프롬프트)을 노션 DB에 행 4개로 넣는다.
// n8n 노션 노드에 넣을 값의 모양을 미리 확인하는 용도.
// 사용법: node tools/notion-test-rows.js [접두어] [주제]
//   예) node tools/notion-test-rows.js 시험기록/v3/t1_gpt62 "겨울철 집에서 하는 10분 운동"
const fs = require('fs');
const path = require('path');
const { loadEnv, api, richText, markdownToBlocks } = require('./notion');
const { checkAll, charCount } = require('./check');

const prefix = process.argv[2] || '시험기록/v3/t1_gpt62';
const topic = process.argv[3] || '겨울철 집에서 하는 10분 운동';
const base = path.join(__dirname, '..');
const read = (k) => JSON.parse(fs.readFileSync(path.join(base, `${prefix}_${k}.json`), 'utf8'));

(async () => {
  const env = loadEnv();
  if (!env.NOTION_DATA_SOURCE_ID) throw new Error('.env 에 NOTION_DATA_SOURCE_ID 가 없습니다. notion-setup.js 를 먼저 실행하세요.');
  const d = { instagram: read('instagram'), blog: read('blog'), x: read('x'), image: read('image') };
  const check = checkAll(d);
  const runId = `test-${new Date().toISOString().slice(0, 16)}`;

  const common = {
    '주제': { rich_text: richText(topic) },
    '톤': { select: { name: '친근' } },
    '대상': { rich_text: richText('20~30대 직장인') },
    '버전': { select: { name: 'A' } },
    '실행 ID': { rich_text: richText(runId) },
  };
  const rows = [
    { platform: '인스타그램', body: d.instagram.caption, tags: d.instagram.hashtags.join(' '), hook: d.instagram.hook_type, pass: check.instagram.pass,
      children: [{ type: 'paragraph', paragraph: { rich_text: richText(`${d.instagram.caption}\n\n${d.instagram.hashtags.join(' ')}`) } }] },
    { platform: '블로그', title: d.blog.title, body: d.blog.body, pass: check.blog.pass, children: markdownToBlocks(d.blog.body) },
    { platform: 'X', body: d.x.post, hook: d.x.hook_type, pass: check.x.pass,
      children: [{ type: 'paragraph', paragraph: { rich_text: richText(d.x.post) } }] },
    { platform: '대표 이미지', body: d.image.image_prompt, pass: check.image.pass,
      children: [{ type: 'paragraph', paragraph: { rich_text: richText(d.image.image_prompt) } }] },
  ];

  for (const r of rows) {
    const props = {
      ...common,
      '제목': { title: richText(r.title ? `${r.title}` : `${topic} · ${r.platform}`) },
      '플랫폼': { select: { name: r.platform } },
      '본문': { rich_text: richText(r.body) },
      '글자 수': { number: charCount(r.body) },
      '검사 통과': { checkbox: r.pass },
    };
    if (r.tags) props['해시태그'] = { rich_text: richText(r.tags) };
    if (r.hook) props['훅 유형'] = { select: { name: r.hook } };
    const page = await api(env, 'POST', '/pages', {
      parent: { type: 'data_source_id', data_source_id: env.NOTION_DATA_SOURCE_ID },
      properties: props,
      children: r.children.slice(0, 100),
    });
    console.log(`${r.platform}: ${page.url}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
