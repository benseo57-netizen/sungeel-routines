// 성일 모닝 브리핑 웹앱 (Google Apps Script)
// - 배포: 웹 앱 / 실행 사용자: 나 / 액세스 권한: 나만  → 본인 구글 계정으로만 열림
// - 스크립트 속성(프로젝트 설정 → 스크립트 속성):
//     PIN           = 4자리 숫자
//     ROUTINE_TOKEN = claude.ai 루틴의 API 트리거 토큰 (sk-ant-oat01-…)  ← 새로고침 버튼용
// - PIN이 맞을 때만 시트 데이터를 보내고 루틴을 실행한다. PIN 5번 틀리면 15분 잠금.

const SHEET_ID = '1zryRTw55FBuubXkyOk5qO4hRQZqZg6aa7Eh7YJQXn0g';
const SHEET_NAME = 'Sheet1';
const ROUTINE_ID = 'trig_01UWvjiA9QuGSR6KMorAdvGi';
const MAX_TRIES = 5;
const LOCK_SECONDS = 15 * 60;
const FIRE_COOLDOWN_SECONDS = 10 * 60;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('성일 모닝 브리핑')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

function checkPin_(pin) {
  const want = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!want) throw new Error('NO_PIN');
  const cache = CacheService.getUserCache();
  const tries = Number(cache.get('pin_tries') || 0);
  if (tries >= MAX_TRIES) throw new Error('LOCKED');
  if (String(pin) !== String(want).trim()) {
    cache.put('pin_tries', String(tries + 1), LOCK_SECONDS);
    throw new Error(tries + 1 >= MAX_TRIES ? 'LOCKED' : 'WRONG:' + (MAX_TRIES - tries - 1));
  }
  cache.remove('pin_tries');
}

function getBriefings(pin) {
  checkPin_(pin);
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, 3).getDisplayValues();

  // 같은 날짜가 여러 줄이면 마지막 줄을 쓴다
  const byDate = {};
  rows.forEach(function (r) {
    if (!r[2]) return;
    try {
      const j = JSON.parse(r[2]);
      byDate[j.date || r[0]] = j;
    } catch (e) { /* 깨진 줄은 건너뜀 */ }
  });
  return Object.keys(byDate).sort().reverse().map(function (d) { return byDate[d]; });
}

// 새로고침 버튼: 모닝 브리핑 루틴을 지금 한 번 실행한다 (10분에 한 번까지)
function fireRoutine(pin) {
  checkPin_(pin);
  const token = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
  if (!token) throw new Error('NO_TOKEN');
  const cache = CacheService.getUserCache();
  if (cache.get('fired_at')) throw new Error('COOLDOWN:' + cache.get('fired_at'));

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/claude_code/routines/' + ROUTINE_ID + '/fire', {
    method: 'post',
    contentType: 'application/json',
    payload: '{}',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + token.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01'
    }
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('FIRE_FAILED:' + code + ' ' + res.getContentText().slice(0, 200));
  const now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm');
  cache.put('fired_at', now, FIRE_COOLDOWN_SECONDS);
  return { startedAt: now };
}
