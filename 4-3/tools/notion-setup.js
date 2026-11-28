// 노션에 프로젝트 개요·작업 과정 요약과 콘텐츠 데이터베이스를 만든다.
// 사용법: node tools/notion-setup.js   (4-3 폴더에서)
// 한 번만 실행한다. .env 에 NOTION_DATABASE_ID 가 있으면 아무것도 하지 않는다.
const { loadEnv, saveEnv, pageIdFrom, api, richText } = require('./notion');

const p = (text) => ({ type: 'paragraph', paragraph: { rich_text: richText(text) } });
const h2 = (text) => ({ type: 'heading_2', heading_2: { rich_text: richText(text) } });
const li = (text) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(text) } });
const ol = (text) => ({ type: 'numbered_list_item', numbered_list_item: { rich_text: richText(text) } });

const overview = [
  h2('프로젝트 개요'),
  p('주제 하나를 폼에 입력하면 n8n 워크플로우가 인스타그램·블로그·X 텍스트와 대표 이미지를 만들고, 아래 데이터베이스에 플랫폼별로 저장한다.'),
  li('입력: n8n 폼에 주제(필수), 보는 사람, 톤(친근/전문), 버전(A/B)'),
  li('텍스트 생성: Codyssey API(OpenAI 호환) gpt-5.4-mini. 인스타그램·블로그·X 프롬프트 3개와 이미지 프롬프트 1개'),
  li('검증: Code 노드로 글자 수, 해시태그 개수, 소제목 개수를 세고 기준을 벗어나면 다시 생성 (최대 3번)'),
  li('이미지 생성: Gemini API gemini-3.1-flash-image, 정사각형(1:1), 글자·로고 없음. 노션 파일 업로드로 첨부'),
  li('저장: 실행 1번마다 이 데이터베이스에 행 4개 (인스타그램, 블로그, X, 대표 이미지)'),
  h2('작업 과정 요약'),
  ol('미션 분석과 설계: 기능 요구사항 4가지, 산출물, 노드 구성, 막히기 쉬운 곳 정리'),
  ol('프롬프트 시험 v0 → v3: 리브레챗에서 모델 6종으로 응답 44개를 받아 검사기(check.js)로 확인. 통과 v0 8/12 → v1 8/12 → v2 11/12 → v3 8/8. 워크플로우용 Codyssey API로 재시험해 gpt-5.4-mini 8/8'),
  ol('최종 프롬프트 확정: JSON 출력, 글자 수 여유값(블로그 900~1,100자, X 120자), 지어낸 효과 수치 금지, 마무리 소제목 금지'),
  ol('노션 데이터베이스 구성: 플랫폼·버전(A/B)·훅 유형 열로 결과를 구분'),
  ol('n8n 워크플로우 연결과 실행: 노드 21개, 인증 3개(Codyssey·Gemini·Notion). 인증 형식 오류로 2번 실패한 뒤 실행 #11 성공(16.9초), 4개 모두 첫 시도에 통과'),
  h2('콘텐츠 데이터베이스'),
];

const color = (name, c) => ({ name, color: c });
const properties = {
  '제목': { title: {} },
  '주제': { rich_text: {} },
  '플랫폼': { select: { options: [color('인스타그램', 'pink'), color('블로그', 'green'), color('X', 'gray'), color('대표 이미지', 'blue')] } },
  '본문': { rich_text: {} },
  '해시태그': { rich_text: {} },
  '이미지': { files: {} },
  '톤': { select: { options: [color('친근', 'yellow'), color('전문', 'purple')] } },
  '대상': { rich_text: {} },
  '버전': { select: { options: [color('A', 'orange'), color('B', 'blue')] } },
  '훅 유형': { select: {} },
  '글자 수': { number: { format: 'number' } },
  '검사 통과': { checkbox: {} },
  '실행 ID': { rich_text: {} },
  '생성 시각': { created_time: {} },
};

(async () => {
  const env = loadEnv();
  if (env.NOTION_DATABASE_ID) {
    console.log('이미 만들어진 DB가 있습니다 (.env 의 NOTION_DATABASE_ID). 다시 만들려면 그 줄을 비우세요.');
    return;
  }
  const parent = pageIdFrom(env.NOTION_PARENT_PAGE);

  await api(env, 'PATCH', `/blocks/${parent}/children`, { children: overview });
  console.log('개요·작업 과정 요약 블록 추가');

  const db = await api(env, 'POST', '/databases', {
    parent: { type: 'page_id', page_id: parent },
    title: richText('소셜 콘텐츠'),
    is_inline: true,
    initial_data_source: { properties },
  });
  const dsId = db.data_sources?.[0]?.id;
  saveEnv('NOTION_DATABASE_ID', db.id);
  saveEnv('NOTION_DATA_SOURCE_ID', dsId || '');
  console.log(`DB 생성: ${db.id}`);
  console.log(`데이터 소스: ${dsId}`);
  console.log(`열: ${Object.keys(properties).join(', ')}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
