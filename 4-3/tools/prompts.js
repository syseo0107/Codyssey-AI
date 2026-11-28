// 프롬프트템플릿.md 의 플랫폼별 "### 최종" 코드 블록을 읽는다.
// 워크플로우와 로컬 시험이 문서에 적힌 최종 프롬프트를 그대로 쓰게 하려는 것.
const fs = require('fs');
const path = require('path');

const SECTIONS = {
  instagram: '## 2. 인스타그램',
  blog: '## 3. 블로그',
  x: '## 4. X (트위터)',
  image: '## 5. 대표 이미지 프롬프트',
};

function readFinalPrompts() {
  const md = fs.readFileSync(path.join(__dirname, '..', '프롬프트템플릿.md'), 'utf8');
  const out = {};
  for (const [key, header] of Object.entries(SECTIONS)) {
    const start = md.indexOf(header);
    if (start < 0) throw new Error(`프롬프트템플릿.md 에서 "${header}" 를 찾지 못했습니다.`);
    const fin = md.indexOf('### 최종', start);
    const open = md.indexOf('```text\n', fin);
    const close = md.indexOf('\n```', open + 8);
    if (fin < 0 || open < 0 || close < 0) throw new Error(`"${header}" 의 최종 프롬프트 코드 블록을 찾지 못했습니다.`);
    out[key] = md.slice(open + 8, close);
  }
  return out;
}

module.exports = { readFinalPrompts };
