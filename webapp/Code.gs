// 성일 모닝 브리핑 웹앱 (Google Apps Script)
// - 배포: 웹 앱 / 실행 사용자: 나 / 액세스 권한: 나만  → 본인 구글 계정으로만 열림
// - 스크립트 속성(프로젝트 설정 → 스크립트 속성):
//     PIN           = 4자리 숫자
//     ROUTINE_TOKEN = claude.ai 루틴의 API 트리거 토큰 (sk-ant-oat01-…)  ← 새로고침 버튼용
// - PIN이 맞으면 30분짜리 세션 토큰을 준다(같은 탭에서 다시 들어와도 PIN을 묻지 않게).
// - PIN 5번 틀리면 15분 잠금. 새로고침(루틴 실행)은 10분에 한 번.

const SHEET_ID = '1zryRTw55FBuubXkyOk5qO4hRQZqZg6aa7Eh7YJQXn0g';
const SHEET_NAME = 'Sheet1';
const ROUTINE_ID = 'trig_01UWvjiA9QuGSR6KMorAdvGi';
const MAX_TRIES = 5;
const LOCK_SECONDS = 15 * 60;
const SESSION_SECONDS = 30 * 60;
const FIRE_COOLDOWN_SECONDS = 10 * 60;
const FIRE_TRACK_SECONDS = 30 * 60;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('성일 모닝 브리핑')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

// auth = { pin: '1234' } 또는 { token: '…' }. 통과하면 (새) 세션 토큰을 돌려준다.
function checkAuth_(auth) {
  auth = auth || {};
  const cache = CacheService.getUserCache();
  if (auth.token && cache.get('sess_' + auth.token)) {
    cache.put('sess_' + auth.token, '1', SESSION_SECONDS);
    return auth.token;
  }
  if (!auth.pin) throw new Error('NEED_PIN');

  const want = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!want) throw new Error('NO_PIN');
  const tries = Number(cache.get('pin_tries') || 0);
  if (tries >= MAX_TRIES) throw new Error('LOCKED');
  if (String(auth.pin) !== String(want).trim()) {
    cache.put('pin_tries', String(tries + 1), LOCK_SECONDS);
    throw new Error(tries + 1 >= MAX_TRIES ? 'LOCKED' : 'WRONG:' + (MAX_TRIES - tries - 1));
  }
  cache.remove('pin_tries');
  const token = Utilities.getUuid();
  cache.put('sess_' + token, '1', SESSION_SECONDS);
  return token;
}

function getBriefings(auth) {
  const token = checkAuth_(auth);
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  const last = sheet.getLastRow();
  const briefs = [];
  if (last >= 2) {
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
    Object.keys(byDate).sort().reverse().forEach(function (d) { briefs.push(byDate[d]); });
  }
  // 최근 30분 안에 새로고침을 눌렀으면 그 시각을 같이 알려준다(앱을 나갔다 와도 진행 중 표시)
  const firedAt = CacheService.getUserCache().get('last_fire') || '';
  return { briefs: briefs, token: token, firedAt: firedAt };
}

// 새로고침 버튼: 모닝 브리핑 루틴을 지금 한 번 실행한다
function fireRoutine(auth) {
  checkAuth_(auth);
  const token = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
  if (!token) throw new Error('NO_TOKEN');
  const cache = CacheService.getUserCache();
  if (cache.get('fire_cooldown')) throw new Error('COOLDOWN:' + cache.get('fire_cooldown'));

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/claude_code/routines/' + ROUTINE_ID + '/fire', {
    method: 'post',
    contentType: 'application/json',
    payload: '{}',
    muteHttpExceptions: true,
    headers: {
      'Authorization': 'Bearer ' + token.trim(),
      'anthropic-version': '2023-06-01'
    }
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error('FIRE_FAILED:' + code + ' ' + res.getContentText().slice(0, 200));

  const firedAt = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  cache.put('fire_cooldown', firedAt.slice(11), FIRE_COOLDOWN_SECONDS);
  cache.put('last_fire', firedAt, FIRE_TRACK_SECONDS);
  return { firedAt: firedAt };
}
