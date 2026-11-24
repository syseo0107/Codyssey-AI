/**
 * 보너스 과제 3 — Google Apps Script에서 Gemini API로 리뷰 초안 요청하기
 *
 * 사용한 프롬프트: system-design.md 3-3 [카테고리: 텍스트 생성] 유저 프롬프트에
 * 3-2 입력 템플릿을 model-comparison.md 1-1 가상 데이터로 채운 것(실행 로그 5-1과 같은 입력).
 *
 * API 키는 코드에 적지 않는다.
 * 프로젝트 설정 > 스크립트 속성에 GEMINI_API_KEY 이름으로 직접 넣는다.
 */
const MODEL = 'gemini-3.8-flash';

const PROMPT = `아래 영수증 정보와 실제 방문 경험만으로 네이버 지도 리뷰 초안을 작성해줘.
제공하지 않은 사실과 경험은 추가하지 말고 작성 조건을 지켜줘.

[영수증 정보]
상호명: 예시카페 가상점
결제일시: 2026-11-20 14:32
주문 내역: 아메리카노 2잔 9,000원, 치즈케이크 1개 6,500원
총 결제금액: 15,500원

[실제 방문 경험]
메뉴별 경험: 아메리카노는 산미가 강하지 않아 내 취향에 맞았음, 치즈케이크는 부드러웠음
직원 응대: 주문 관련 질문에 친절하게 답해줌
분위기: 대화하기 편했음
아쉬운 점: 내가 앉은 자리는 테이블 간격이 좁게 느껴졌음
기타: 주차, 대기시간, 재방문 의사는 제공하지 않음

[작성 조건]
기본 조건 사용

위 정보를 바탕으로 리뷰 초안을 작성해줘.`;

function callGemini() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    throw new Error('프로젝트 설정 > 스크립트 속성에 GEMINI_API_KEY를 먼저 넣어 주세요.');
  }

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    // 검색 도구(tools)를 넣지 않아 웹 검색 없이 입력만으로 답하게 한다.
    payload: JSON.stringify({ contents: [{ parts: [{ text: PROMPT }] }] }),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText());
  Logger.log('모델: ' + MODEL + ' / HTTP ' + status);

  if (body.error) {
    Logger.log('오류: ' + body.error.status + ' — ' + body.error.message);
    return;
  }
  const text = body.candidates[0].content.parts
    .map(function (part) { return part.text || ''; })
    .join('');
  Logger.log('응답:\n' + text);
}
