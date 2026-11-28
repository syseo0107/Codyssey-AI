// 플랫폼별 생성 결과 검사기
// - 터미널: node check.js 결과.json   (모델 출력 JSON을 그대로 붙여 넣은 파일)
// - n8n Code 노드: 아래 "검사 함수" 부분을 붙여 넣고
//     return [{ json: checkAll($json) }];
//
// 입력 형식 (플랫폼 키는 있는 것만 검사):
// {
//   "instagram": {"caption": "...", "hashtags": ["#..."], "hook_type": "..."},
//   "blog":      {"title": "...", "body": "..."},
//   "x":         {"post": "...", "hook_type": "..."},
//   "image":     {"image_prompt": "..."}
// }

// ───────── 검사 함수 ─────────

// 글자 수: 이모지·한글 모두 1자로 센다 (공백 포함)
function charCount(s) {
  return [...String(s ?? '')].length;
}

// X 가중치 글자 수 (twitter-text v3 기준)
// 라틴·기본 문장부호는 1, 한글·한자·이모지 등은 2, URL은 23. 상한 280.
function xWeightedLength(s) {
  let text = String(s ?? '');
  let weight = 0;
  text = text.replace(/https?:\/\/\S+/g, () => { weight += 23; return ''; });
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const light =
      (c <= 0x10ff) ||
      (c >= 0x2000 && c <= 0x200d) ||
      (c >= 0x2010 && c <= 0x201f) ||
      (c >= 0x2032 && c <= 0x2037);
    weight += light ? 1 : 2;
  }
  return weight;
}

function lines(s) {
  return String(s ?? '').split('\n').map(l => l.trim()).filter(Boolean);
}

function hashtagsIn(s) {
  return String(s ?? '').match(/#[^\s#]+/g) || [];
}

// 확인할 수 없는 통계일 수 있는 표현 (사람이 다시 볼 것)
function numberClaims(s) {
  return String(s ?? '').match(/\d[\d,.]*\s*(%|퍼센트|배|명|만|억|위)/g) || [];
}

function startsWithGreeting(s) {
  return /^(안녕|여러분|반가|오늘은|저는)/.test(lines(s)[0] || '');
}

function check(name, value, target, pass) {
  return { name, value, target, pass };
}

function checkInstagram(d) {
  const caption = d.caption ?? '';
  const tags = Array.isArray(d.hashtags) ? d.hashtags : hashtagsIn(d.hashtags);
  const n = lines(caption).length;
  return [
    check('해시태그 개수', tags.length, '정확히 10', tags.length === 10),
    check('해시태그 형식', tags.filter(t => !/^#[^\s#]+$/.test(t)).join(' ') || '정상', '# + 공백 없음',
      tags.every(t => /^#[^\s#]+$/.test(t))),
    check('캡션 줄 수', n, '5~7 (첫 줄 + 본문 3~5 + 마지막 줄)', n >= 5 && n <= 7),
    check('캡션 안 해시태그', hashtagsIn(caption).length, '0 (hashtags 칸에만)', hashtagsIn(caption).length === 0),
    check('인사로 시작', startsWithGreeting(caption) ? '예' : '아니오', '아니오', !startsWithGreeting(caption)),
    check('수치 표현', numberClaims(caption).join(', ') || '없음', '없음 (있으면 사실 확인)', numberClaims(caption).length === 0),
    check('hook_type', d.hook_type ? '있음' : '없음', '있음', Boolean(d.hook_type)),
  ];
}

function checkBlog(d) {
  const body = d.body ?? '';
  const len = charCount(body);
  const heads = (body.match(/^##\s+\S/gm) || []).length;
  const deeper = (body.match(/^#{3,}\s/gm) || []).length;
  return [
    check('제목', d.title ? charCount(d.title) + '자' : '없음', '있음', Boolean(d.title)),
    check('본문 글자 수(공백 포함)', len, '800~1,200 (미션 500 이상)', len >= 800 && len <= 1200),
    check('미션 기준 500자', len, '500 이상', len >= 500),
    check('소제목(##) 개수', heads, '정확히 3', heads === 3),
    check('### 이하 소제목', deeper, '0', deeper === 0),
    // 출력 형식 예시("마크다운 본문, 소제목은 ##")를 본문에 그대로 베낀 경우
    check('형식 안내문 복사', /마크다운 본문|소제목은 ##/.test(body) ? '있음' : '없음', '없음',
      !/마크다운 본문|소제목은 ##/.test(body)),
    check('인사로 시작', startsWithGreeting(body) ? '예' : '아니오', '아니오', !startsWithGreeting(body)),
    check('수치 표현', numberClaims(body).join(', ') || '없음', '없음 (있으면 사실 확인)', numberClaims(body).length === 0),
  ];
}

function checkX(d) {
  const post = d.post ?? '';
  const len = charCount(post);
  const w = xWeightedLength(post);
  const tags = hashtagsIn(post).length;
  return [
    check('글자 수', len, '120 이하 (미션 280 이하)', len <= 120),
    check('X 실제 가중치', w, '280 이하', w <= 280),
    check('해시태그 개수', tags, '2 이하', tags <= 2),
    check('인사로 시작', startsWithGreeting(post) ? '예' : '아니오', '아니오', !startsWithGreeting(post)),
    check('수치 표현', numberClaims(post).join(', ') || '없음', '없음 (있으면 사실 확인)', numberClaims(post).length === 0),
    check('hook_type', d.hook_type ? '있음' : '없음', '있음', Boolean(d.hook_type)),
  ];
}

function checkImage(d) {
  const p = d.image_prompt ?? '';
  const nonAscii = [...p].filter(ch => ch.codePointAt(0) > 0x7f).length;
  return [
    check('프롬프트', p ? charCount(p) + '자' : '없음', '있음', Boolean(p)),
    check('영어 여부(비ASCII 글자 수)', nonAscii, '0', nonAscii === 0),
    check('정사각형 지시', /1:1|square/i.test(p) ? '있음' : '없음', '있음', /1:1|square/i.test(p)),
    check('글자 금지 지시', /no text|without text|no words|no letters|no typography/i.test(p) ? '있음' : '없음', '있음',
      /no text|without text|no words|no letters|no typography/i.test(p)),
  ];
}

function checkAll(input) {
  const checkers = { instagram: checkInstagram, blog: checkBlog, x: checkX, image: checkImage };
  const result = {};
  for (const [key, fn] of Object.entries(checkers)) {
    if (input[key] == null) continue;
    const checks = fn(input[key]);
    result[key] = { pass: checks.every(c => c.pass), failed: checks.filter(c => !c.pass).map(c => c.name), checks };
  }
  result.allPass = Object.values(result).every(r => r.pass);
  return result;
}

// ───────── 터미널 실행 ─────────

if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const file = process.argv[2];
  if (!file) {
    console.error('사용법: node check.js 결과.json');
    process.exit(2);
  }
  // 모델이 ```json 코드 블록으로 감싸 준 경우도 읽는다
  const raw = fs.readFileSync(file, 'utf8').replace(/```(?:json)?/g, '');
  const result = checkAll(JSON.parse(raw));
  const names = { instagram: '인스타그램', blog: '블로그', x: 'X', image: '이미지 프롬프트' };
  for (const [key, r] of Object.entries(result)) {
    if (key === 'allPass') continue;
    console.log(`\n[${names[key]}] ${r.pass ? '통과' : '기준 벗어남'}`);
    for (const c of r.checks) console.log(`  ${c.pass ? 'O' : 'X'} ${c.name}: ${c.value}  (기준: ${c.target})`);
  }
  console.log(`\n전체: ${result.allPass ? '모두 통과' : '재생성 필요'}`);
  process.exit(result.allPass ? 0 : 1);
}

if (typeof module !== 'undefined') {
  module.exports = { charCount, xWeightedLength, checkInstagram, checkBlog, checkX, checkImage, checkAll };
}
