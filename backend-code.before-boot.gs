function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 시트에 실제로 쓰기 작업을 하는 액션들 - 동시 요청 시 순서대로 처리되도록 잠금
var WRITE_ACTIONS = [
  'submitLecture', 'updateSchoolInfo', 'decideApproval',
  'inviteRegister', 'deleteInstructor',
  'setDormant', 'recordReconsent', 'saveSession', 'deleteSession', 'updatePlan', 'confirmConflict', 'copySessions', 'submitSessionPlan'
];

function doPost(e) {
  var params;
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonError('요청 형식이 올바르지 않습니다');
  }

  // 비밀번호 대입 시도 제한: 틀린 비밀번호 5회 연속 시 15분간 비밀번호가 필요한 요청 차단
  var gate = passwordGate(params);
  if (gate) return jsonError(gate);

  var lock = null;
  if (WRITE_ACTIONS.indexOf(params.action) > -1) {
    lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
    } catch (err) {
      return jsonError('다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  try {
    if (params.action === 'register') return registerInstructor(params);
    if (params.action === 'login') return checkLogin(params);
    if (params.action === 'list') return listInstructors(params);
    if (params.action === 'checkInstructor') return checkInstructor(params);
    if (params.action === 'submitLecture') return submitLecture(params);
    if (params.action === 'getHistory') return getHistory(params);
    if (params.action === 'getSchoolInfo') return getSchoolInfo();
    if (params.action === 'updateSchoolInfo') return updateSchoolInfo(params);
    if (params.action === 'decideApproval') return decideApproval(params);
    if (params.action === 'inviteSend') return inviteSend(params);
    if (params.action === 'inviteRegister') return inviteRegister(params);
    if (params.action === 'deleteInstructor') return deleteInstructor(params);
    if (params.action === 'getPrivateFile') return getPrivateFile(params);
    if (params.action === 'getAssignment') return getAssignment(params);
    if (params.action === 'setDormant') return setDormant(params);
    if (params.action === 'recordReconsent') return recordReconsent(params);
    if (params.action === 'listAssignmentData') return listAssignmentData(params);
    if (params.action === 'listSessions') return listSessions(params);
    if (params.action === 'saveSession') return saveSession(params);
    if (params.action === 'deleteSession') return deleteSession(params);
    if (params.action === 'listReservations') return listReservations(params);
    if (params.action === 'markGaps') return markGaps(params);
    if (params.action === 'saveReservation') return saveReservation(params);
    if (params.action === 'cancelReservation') return cancelReservation(params);
    if (params.action === 'updatePlan') return updatePlan(params);
    if (params.action === 'confirmConflict') return confirmConflict(params);
    if (params.action === 'copySessions') return copySessions(params);
    if (params.action === 'getSessionForSubmit') return getSessionForSubmit(params);
    if (params.action === 'submitSessionPlan') return submitSessionPlan(params);

    return jsonError('unknown action');
  } catch (err) {
    Logger.log('doPost 오류: ' + err);
    return jsonError('서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    if (lock) lock.releaseLock();
  }
}

var LOGIN_MAX_FAIL = 5;       // 연속 실패 허용 횟수
var LOGIN_LOCK_SECONDS = 900; // 잠금 시간(15분)

// 반환: 차단 시 안내 문구, 통과 시 null. 비밀번호를 보내지 않은 요청(등록·제출 등)은 대상 아님
function passwordGate(params) {
  var pw = params && params.password;
  if (typeof pw !== 'string' || pw === '') return null;
  var cache = CacheService.getScriptCache();
  var KEY = 'pwfail';
  var fails = Number(cache.get(KEY) || 0);
  var ok = checkPassword(pw) || checkAdminPassword(pw) || checkViewerPassword(pw);
  if (fails >= LOGIN_MAX_FAIL) {
    // 잠금 중에는 맞는 비밀번호도 거부 (대입 시도 확인 방지)
    return '비밀번호 입력 실패가 ' + LOGIN_MAX_FAIL + '회 누적되어 ' + (LOGIN_LOCK_SECONDS / 60) + '분간 잠겼습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (ok) {
    if (fails > 0) { cache.remove(KEY); cache.remove('pwlast'); }
    return null;
  }
  // 화면이 로그인 한 번에 요청 3건을 동시에 보내므로, 직전에 틀린 것과 같은 비밀번호는 1회로만 계산
  var digest = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw));
  if (cache.get('pwlast') === digest) return null;
  cache.put('pwlast', digest, LOGIN_LOCK_SECONDS);
  fails++;
  cache.put(KEY, String(fails), LOGIN_LOCK_SECONDS);
  Logger.log('비밀번호 실패 ' + fails + '회: action=' + params.action);
  if (fails >= LOGIN_MAX_FAIL) {
    return '비밀번호 입력 실패가 ' + LOGIN_MAX_FAIL + '회 누적되어 ' + (LOGIN_LOCK_SECONDS / 60) + '분간 잠겼습니다. 잠시 후 다시 시도해 주세요.';
  }
  return null; // 이번 실패는 기존 로직이 '인증 실패' 메시지로 응답
}

function checkPassword(password) {
  var stored = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
  return stored && password === stored;
}

function checkAdminPassword(password) {
  var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  return stored && password === stored;
}

// 조회 전용(동료직원) 비밀번호 - 스크립트 속성에 VIEWER_PASSWORD 키로 별도 등록
function checkViewerPassword(password) {
  var stored = PropertiesService.getScriptProperties().getProperty('VIEWER_PASSWORD');
  return stored && password === stored;
}

// 조회성 API(목록/이력/일정 등)는 관리자 비밀번호 또는 조회전용 비밀번호 모두 허용
function checkReadAccess(password) {
  return checkPassword(password) || checkViewerPassword(password);
}

// 쓰기성 API에서 사용: 관리자 비밀번호가 아니면 거부하되, 조회전용 계정이 시도한 경우 전용 안내 메시지 반환
function writeAccessDeniedMessage(password) {
  if (checkViewerPassword(password)) {
    return '조회 전용 계정입니다. 이 기능은 관리자 비밀번호로 로그인해야 사용할 수 있습니다.';
  }
  return '인증이 필요합니다';
}

// 연락처·계좌번호처럼 앞자리 0이 있는 숫자문자열이 시트에서 숫자로 자동변환되지 않도록 텍스트로 강제 저장
function textCell(val) {
  if (!val) return '';
  return "'" + val;
}

function checkLogin(params) {
  var isAdmin = checkPassword(params.password);
  var isViewer = !isAdmin && checkViewerPassword(params.password);
  var result = (isAdmin || isViewer)
    ? { status: 'ok', role: isAdmin ? 'admin' : 'viewer' }
    : { status: 'error', message: '비밀번호가 올바르지 않습니다' };
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 강의배정DB(교과목시간표)를 읽어 강사ID별로 집계. 강의배정DB가 연결되지 않았거나 편성이 없으면 빈 객체
// all: 전체 편성 건수(취소된 기수·보조강사 포함) / count: 주강사 편성 건수(취소된 기수 제외)
// upcoming: 오늘 이후 편성 / unsub·done: 오늘 이후 주강사 편성 중 강의계획서 미제출·제출
function sessionStatsByInstructor(todayStr) {
  var out = {};
  var ss = openAssignSS();
  if (!ss) return out;
  var sess = readAssignTable(ss, SESSION_SHEET);
  if (sess.missing || !sess.rows.length) return out;
  var cancelledKeys = {};
  readAssignTable(ss, '연간계획').rows.forEach(function(r){
    if (isPlanCancelled(r)) cancelledKeys[String(r['과정+기수'])] = true;
  });
  sess.rows.forEach(function(r){
    var id = String(r['강사ID'] || '');
    if (!id) return;
    var st = out[id] || (out[id] = { all: 0, count: 0, upcoming: 0, unsub: 0, done: 0 });
    st.all++;
    if (cancelledKeys[String(r['개설키'])]) return;
    var isSub = String(r['강사 역할'] || '') === '보조강사';
    var date = String(r['일자'] || '');
    var upcoming = !!date && date >= todayStr;
    if (!isSub) st.count++;
    if (upcoming) {
      st.upcoming++;
      if (!isSub) {
        if (String(r['계획서파일ID'] || '')) st.done++; else st.unsub++;
      }
    }
  });
  return out;
}

function listInstructors(params) {
  var isAdmin = checkPassword(params.password);
  var isViewer = !isAdmin && checkViewerPassword(params.password);
  if (!isAdmin && !isViewer) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: '인증이 필요합니다' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1);

  // 강의 횟수·예정·제출 현황은 강의배정DB(교과목시간표) 기준. 옛 강의이력 시트는 "이력 있음" 표시(삭제 보호)에만 사용
  var todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  var sessStats = {};
  try { sessStats = sessionStatsByInstructor(todayStr); } catch (err) { Logger.log('편성 집계 오류: ' + err); }
  var legacyHas = {};
  var histSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강의이력');
  if (histSheet) {
    histSheet.getDataRange().getValues().slice(1).forEach(function(row){
      if (row[1]) legacyHas[String(row[1])] = true;
    });
  }

  var instructors = rows
    .filter(function(row) { return row[1]; })
    .map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) {
        var val = row[i];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, 'GMT+9', 'yyyy-MM-dd');
        } else if (typeof val === 'number') {
          val = String(val);
        }
        obj[header] = val;
      });
      var st = sessStats[String(obj.강사ID)] || { all: 0, count: 0, upcoming: 0, unsub: 0, done: 0 };
      obj.강의회차 = st.count;                  // 주강사 편성 건수(취소된 기수 제외)
      obj.강의확정건수 = st.upcoming;            // 오늘 이후 편성(주강사·보조강사 모두)
      obj.확정미제출건수 = st.unsub;             // 오늘 이후 주강사 편성 중 강의계획서 미제출
      obj.확정제출건수 = st.done;                // 오늘 이후 주강사 편성 중 강의계획서 제출
      obj.강의확정 = st.upcoming > 0;
      obj.확정미제출 = st.unsub > 0;
      obj.편성건수 = st.all;                     // 역할·취소 여부와 관계없는 전체 편성 건수
      obj.이력있음 = st.all > 0 || !!legacyHas[String(obj.강사ID)];
      if (!obj.등록경로) obj.등록경로 = '자진등록';
      return obj;
    });

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', count: instructors.length, data: instructors, role: isAdmin ? 'admin' : 'viewer', mail: isAdmin ? { 대기: mailQueueCounts_().대기, 실패: mailQueueCounts_().실패, 남은한도: remainingMailQuota_() } : null }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 강사카드·개인정보 동의서(비공개 폴더) 열람/내려받기: 관리자·조회전용 비밀번호 모두 허용
// - 강사기본정보에 등록된 강사카드·동의서 파일 ID만 열 수 있음(임의의 드라이브 파일 요청 차단)
var PRIVATE_FILE_MAX_BYTES = 12 * 1024 * 1024;
function getPrivateFile(params) {
  if (!checkReadAccess(params.password)) return jsonError('인증이 필요합니다');
  var fid = String(params.파일ID || '').trim();
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(fid)) return jsonError('파일 정보가 올바르지 않습니다');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h); });
  var cols = [];
  headers.forEach(function(h, i){ if (/프로필파일|동의서/.test(h)) cols.push(i); });
  var owner = '', allowed = false;
  for (var i = 1; i < data.length && !allowed; i++) {
    for (var c = 0; c < cols.length; c++) {
      if (String(data[i][cols[c]]) === fid) { allowed = true; owner = String(data[i][0]); break; }
    }
  }
  if (!allowed) return jsonError('등록된 강사 서류가 아닙니다');
  try {
    var file = DriveApp.getFileById(fid);
    if (file.getSize() > PRIVATE_FILE_MAX_BYTES) return jsonError('파일이 너무 커서 화면으로 불러올 수 없습니다. 담당자에게 문의해 주세요.');
    var blob = file.getBlob();
    return jsonOut({ status: 'ok', 이름: file.getName(), 형식: blob.getContentType() || 'application/pdf', base64: Utilities.base64Encode(blob.getBytes()) });
  } catch (err) {
    Logger.log('getPrivateFile 오류: ' + err);
    return jsonError('파일을 불러오지 못했습니다. 파일이 삭제되었거나 접근 권한이 없습니다.');
  }
}

function findInstructor(id) {
  if (!id) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      var obj = {};
      headers.forEach(function(h, idx){
        var val = data[i][idx];
        if (val instanceof Date) val = Utilities.formatDate(val, 'GMT+9', 'yyyy-MM-dd');
        else if (typeof val === 'number') val = String(val);
        obj[h] = val;
      });
      return obj;
    }
  }
  return null;
}

function checkInstructor(params) {
  var found = findInstructor(params.강사ID);
  return ContentService
    .createTextOutput(JSON.stringify(
      found ? { status: 'ok', found: true, 성명: found.성명 } : { status: 'ok', found: false }
    ))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateFolder(name) {
  var props = PropertiesService.getScriptProperties();
  var cacheKey = 'FOLDER_ID_' + name;
  var cachedId = props.getProperty(cacheKey);
  if (cachedId) {
    try {
      return DriveApp.getFolderById(cachedId);
    } catch (err) {
      // 캐시된 폴더가 삭제된 경우 등 - 아래에서 다시 찾거나 생성
    }
  }
  var folders = DriveApp.getFoldersByName(name);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
  props.setProperty(cacheKey, folder.getId());
  return folder;
}

function saveFile(base64, type, fileName, folderName) {
  if (!base64) return '';
  var raw = base64.split(',').pop();
  var blob = Utilities.newBlob(Utilities.base64Decode(raw), type || 'application/octet-stream', fileName);
  var folder = getOrCreateFolder(folderName);
  var file = folder.createFile(blob);
  // 주민등록번호·계좌번호가 들어가는 서류 폴더는 공개하지 않고 소유자(담당자)만 열람
  if (PRIVATE_FOLDERS.indexOf(folderName) === -1) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return file.getId();
}

var PRIVATE_FOLDERS = ['강사프로필파일', '개인정보동의서'];

// 1회 실행용: 이미 올라온 강사카드·동의서 파일을 "담당자만" 열람으로 변경 (Apps Script 편집기에서 직접 실행)
function makeSensitiveFilesPrivate() {
  var count = 0;
  PRIVATE_FOLDERS.forEach(function(name) {
    var folders = DriveApp.getFoldersByName(name);
    while (folders.hasNext()) {
      var files = folders.next().getFiles();
      while (files.hasNext()) {
        files.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
        count++;
      }
    }
  });
  Logger.log('비공개로 변경한 파일 수: ' + count);
}

// ===== 솔라피(Solapi) 문자 발송 =====
// 스크립트 속성에 SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER(발신번호, 솔라피에 등록된 번호) 필요
function solapiAuthHeader() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('SOLAPI_API_KEY');
  var apiSecret = props.getProperty('SOLAPI_API_SECRET');
  if (!apiKey || !apiSecret) return null;

  var date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  var salt = Utilities.getUuid().replace(/-/g, '');
  var signatureBytes = Utilities.computeHmacSha256Signature(date + salt, apiSecret);
  var signature = signatureBytes.map(function(b){
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');

  return 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date + ', salt=' + salt + ', signature=' + signature;
}

function sendSMS(to, text) {
  if (!to) return;
  var auth = solapiAuthHeader();
  var sender = PropertiesService.getScriptProperties().getProperty('SOLAPI_SENDER');
  if (!auth || !sender) {
    Logger.log('문자 발송 건너뜀: 솔라피 스크립트 속성 미설정');
    return;
  }
  var cleanTo = String(to).replace(/[^0-9]/g, '');
  if (!cleanTo) return;

  try {
    UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: auth },
      payload: JSON.stringify({ message: { to: cleanTo, from: sender, text: text } }),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('문자 발송 실패: ' + err);
  }
}

// 배포된 사이트 기본 주소 - 모든 발송 메일 하단의 "학교 둘러보기" 링크에 사용
var SITE_BASE_URL = 'https://yky14994-web.github.io/instructor-dashboard/';

// 반환: { ok:true, 남은한도:N } 또는 { ok:false, reason:'...' } (기존 호출부는 반환값을 무시해도 동작 동일)
function sendConfirmationEmail(to, subject, bodyLines) {
  if (!to) return { ok: false, reason: '받는 사람 이메일이 비어 있습니다' };
  try {
    if (MailApp.getRemainingDailyQuota() < 1) { Logger.log('메일 일일 한도 소진: 발송 건너뜀 → ' + to); return { ok: false, reason: '오늘 메일 발송 한도(하루 100통)를 모두 사용했습니다. 내일 다시 시도해 주세요' }; }
  } catch (quotaErr) { /* 확인 실패 시 그대로 발송 시도 */ }
  var finalSubject = '[필독] ' + subject;
  var tourUrl = SITE_BASE_URL + 'school-intro.html';
  var html =
    '<div style="font-family:sans-serif;font-size:14px;color:#2C2C2A;line-height:1.7;max-width:520px;">' +
    '<div style="background:#1B3A5F;color:#ffffff;padding:14px 18px;border-radius:8px 8px 0 0;font-size:15px;font-weight:bold;">' +
    '🔔 반드시 확인해 주셔야 하는 메일입니다' +
    '</div>' +
    '<div style="border:1.5px solid #1B3A5F;border-top:none;border-radius:0 0 8px 8px;padding:20px 18px;">' +
    bodyLines.map(function(l){ return '<p style="margin:0 0 10px 0;">' + l + '</p>'; }).join('') +
    '<p style="margin:16px 0 0 0;"><a href="' + tourUrl + '" style="color:#1B3A5F;font-weight:bold;">▶ 학교 둘러보기 (오시는 길·시설 안내)</a></p>' +
    '</div>' +
    '<p style="color:#9AA5B1;font-size:12px;margin-top:16px;">전남소방학교 교육기획팀 · 문의 061-860-4732</p>' +
    '</div>';
  try {
    MailApp.sendEmail({ to: to, subject: finalSubject, htmlBody: html, body: bodyLines.join('\n').replace(/<\/?b>/g,'') + '\n\n학교 둘러보기: ' + tourUrl });
  } catch (err) {
    Logger.log('메일 발송 실패: ' + err);
    return { ok: false, reason: String(err && err.message ? err.message : err) };
  }
  var left = '';
  try { left = MailApp.getRemainingDailyQuota(); } catch (e2) {}
  return { ok: true, 남은한도: left };
}

// 메일 발송 점검용: Apps Script 편집기에서 직접 실행(▶)하면 내 계정으로 시험 메일을 보내고 결과를 실행 로그에 남김.
// 처음 실행하면 메일 발송 권한 승인 창이 뜸 → 승인해야 웹앱에서도 메일이 나감.
function testMailToMe() {
  var me = Session.getEffectiveUser().getEmail();
  var r = sendConfirmationEmail(me, '[전남소방학교] 메일 발송 시험', ['메일 발송 시험입니다.', '이 메일이 도착했다면 발송 기능은 정상입니다.']);
  Logger.log('받는 주소: ' + me + ' / 결과: ' + JSON.stringify(r));
  return r;
}


// ===== 승인·반려 안내 메일 대기열 =====
// 하루 메일 한도(약 100통)를 넘지 않도록, 승인·반려 안내 메일은 '메일대기' 시트에 먼저 기록하고
// 한도가 남아 있을 때 오래된 순서로 발송한다. 남은 건은 1시간마다 자동으로 이어서 발송(setupMailQueueTrigger 1회 실행 필요).
var MAIL_QUEUE_SHEET = '메일대기';
var MAIL_QUEUE_HEADERS = ['요청시각', '강사ID', '받는사람', '제목', '본문', '종류', '상태', '시도횟수', '발송시각', '비고'];
var MAIL_COL_STATUS = 7;            // 상태 열(1부터)
var MAIL_RESERVE = 10;              // 대기열 발송 후에도 남겨 둘 한도(초대 등 다른 메일용)
var MAIL_FIRST_RESERVE = 20;        // 접수확인 메일은 '대기 중인 승인·반려 메일 수 + 이 값'보다 한도가 많을 때만 발송
var MAIL_MAX_TRIES = 3;             // 발송 실패(주소 오류 등) 재시도 횟수

function getMailQueueSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(MAIL_QUEUE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(MAIL_QUEUE_SHEET);
    sh.appendRow(MAIL_QUEUE_HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 대기열에 기록하고 시트 행 번호를 돌려줌
function enqueueMail_(instructorId, to, subject, bodyLines, kind, status, note) {
  var sh = getMailQueueSheet_();
  sh.appendRow([nowStamp(), instructorId || '', String(to || ''), subject, JSON.stringify(bodyLines), kind, status || '대기', 0, '', note || '']);
  return sh.getLastRow();
}

function mailQueueCounts_() {
  var out = { 대기: 0, 실패: 0 };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIL_QUEUE_SHEET);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, MAIL_COL_STATUS, sh.getLastRow() - 1, 1).getValues().forEach(function(r) {
    if (r[0] === '대기') out.대기++;
    else if (r[0] === '실패') out.실패++;
  });
  return out;
}

function remainingMailQuota_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return 100; }
}

// 대기 중인 메일을 오래된 순으로 발송(한도에서 MAIL_RESERVE만큼은 남김). 호출하는 쪽에서 잠금을 잡아야 함.
function flushMailQueue_() {
  var res = { 발송: 0, 실패: 0, 대기: 0 };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAIL_QUEUE_SHEET);
  if (!sh || sh.getLastRow() < 2) return res;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, MAIL_QUEUE_HEADERS.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v[MAIL_COL_STATUS - 1] !== '대기') continue;
    if (remainingMailQuota_() <= MAIL_RESERVE) { res.대기++; continue; }
    var lines;
    try { lines = JSON.parse(v[4]); } catch (e) { lines = [String(v[4])]; }
    var r = sendConfirmationEmail(v[2], v[3], lines);
    var tries = Number(v[7]) || 0;
    var status = '대기', sentAt = '', note = '';
    if (r.ok) {
      status = '발송완료'; sentAt = nowStamp(); tries++; res.발송++;
    } else if (/한도/.test(String(r.reason || ''))) {
      note = String(r.reason); res.대기++;                  // 한도 문제는 시도 횟수에 넣지 않고 다음 기회에 재시도
    } else {
      tries++; note = String(r.reason || '');
      if (tries >= MAIL_MAX_TRIES) { status = '실패'; res.실패++; } else { res.대기++; }
    }
    sh.getRange(i + 2, MAIL_COL_STATUS, 1, 4).setValues([[status, tries, sentAt, note]]);
  }
  return res;
}

// 시간 기준 트리거가 호출: 한도가 남아 있으면 대기 중인 메일을 이어서 발송
function processMailQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log('다른 작업 진행 중이라 이번 회차는 건너뜀'); return; }
  try {
    var r = flushMailQueue_();
    Logger.log('메일 대기열 처리: ' + JSON.stringify(r) + ' / 남은 한도 ' + remainingMailQuota_());
  } finally { lock.releaseLock(); }
}

// Apps Script 편집기에서 한 번만 실행(▶): 1시간마다 processMailQueue 실행. 처음 실행하면 권한 승인 창이 뜸.
function setupMailQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'processMailQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processMailQueue').timeBased().everyHours(1).create();
  Logger.log('1시간마다 메일 대기열을 처리하도록 설정했습니다.');
}

// ===== 모집 안전장치 (A1~A4) =====
var MAX_REGISTER_PER_DAY = 30;      // 자진등록 하루 접수 상한(승인·반려 메일은 '메일대기'로 한도 안에서 나눠 발송)
var CONTACT_PHONE = '061-860-4731';

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 연락처 숫자만 비교 (010-1234-5678 / 01012345678 / 앞자리 0 누락 10자리 모두 동일 처리)
function normPhone(v) {
  var d = String(v || '').replace(/[^0-9]/g, '');
  if (d.length === 10 && d.charAt(0) === '1') d = '0' + d;
  return d;
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

// 같은 연락처로 이미 등록(활성·승인대기·보류중·휴면)된 강사를 찾음. 반려는 재신청 허용.
function findDuplicateInstructor(phone) {
  var key = normPhone(phone);
  if (!key) return null;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var phoneCol = headers.indexOf('연락처');
  var statusCol = headers.indexOf('상태');
  if (phoneCol < 0) return null;
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (statusCol > -1 && data[i][statusCol] === '반려') continue;
    if (normPhone(data[i][phoneCol]) === key) {
      var obj = {};
      headers.forEach(function(h, idx){ obj[h] = data[i][idx]; });
      return { id: String(data[i][0]), 상태: statusCol > -1 ? data[i][statusCol] : '', 이메일: obj.이메일 || '', 성명: obj.성명 || '' };
    }
  }
  return null;
}

// 헤더 행에 열 이름이 없으면 맨 오른쪽에 추가하고 열 번호(1부터)를 돌려줌
function ensureHeaderColumn(sheet, name) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headers.indexOf(name);
  if (idx > -1) return idx + 1;
  sheet.getRange(1, lastCol + 1).setValue(name);
  return lastCol + 1;
}

// 행을 추가하되, 동의 기록 열(없으면 생성)에 값을 함께 기록
function appendInstructorRow(sheet, rowArr, consentText) {
  var col = ensureHeaderColumn(sheet, '동의일시');
  while (rowArr.length < col - 1) rowArr.push('');
  rowArr[col - 1] = consentText;
  sheet.appendRow(rowArr);
}

function nowStamp() {
  return Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd HH:mm');
}

// 하루 접수 건수 확인 후 +1 (register는 잠금 안에서 실행되므로 동시 증가 안전)
// 오늘 접수된 인원(상한 확인용, 증가시키지 않음)
function registerSlotsUsed_() {
  var key = 'REG_COUNT_' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMdd');
  return Number(PropertiesService.getScriptProperties().getProperty(key) || 0);
}

// 접수가 거절된 경우 방금 저장한 임시 업로드 파일을 휴지통으로 이동(드라이브 휴지통에서 복구 가능)
function trashFiles_(ids) {
  ids.forEach(function(id) {
    if (!id) return;
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { Logger.log('임시 파일 정리 실패: ' + id + ' ' + e); }
  });
}

function takeRegisterSlot() {
  var props = PropertiesService.getScriptProperties();
  var key = 'REG_COUNT_' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMdd');
  var n = Number(props.getProperty(key) || 0);
  if (n >= MAX_REGISTER_PER_DAY) return false;
  props.setProperty(key, String(n + 1));
  return true;
}

function registerInstructor(params) {
  // 봇 차단: 사람 눈에 보이지 않는 칸(website)이 채워져 있으면 조용히 무시
  if (params.website) return jsonOut({ status: 'ok' });

  if (params.동의 !== true) {
    return jsonError('개인정보 수집·이용에 동의해 주셔야 신청할 수 있습니다.');
  }
  if (!params.성명 || !isValidEmail(params.이메일) || normPhone(params.연락처).length < 10 || normPhone(params.연락처).length > 11) {
    return jsonError('성명, 연락처, 이메일 형식을 확인해 주세요.');
  }

  // 강사카드·개인정보 동의서는 PDF만 받음 (한글 양식 작성 후 PDF 변환)
  if (!params.프로필base64 || !params.동의서base64) {
    return jsonError('강사카드와 개인정보 동의서(PDF)를 모두 첨부해 주세요.');
  }
  if (!/pdf/i.test(String(params.프로필타입 || '')) || !/pdf/i.test(String(params.동의서타입 || ''))) {
    return jsonError('강사카드와 개인정보 동의서는 PDF 파일만 올릴 수 있습니다.');
  }

  // 1) 잠금 없이 미리 확인: 이미 거절될 신청은 파일을 저장하지 않음
  if (findDuplicateInstructor(params.연락처)) {
    return jsonOut({ status: 'duplicate', message: '이미 같은 연락처로 등록되었거나 심사 중입니다. 확인이 필요하시면 교육훈련팀(' + CONTACT_PHONE + ')으로 문의해 주세요.' });
  }
  if (registerSlotsUsed_() >= MAX_REGISTER_PER_DAY) {
    return jsonOut({ status: 'limit', message: '오늘 접수 가능한 인원을 초과했습니다. 내일 다시 신청하시거나 교육훈련팀(' + CONTACT_PHONE + ')으로 문의해 주세요.' });
  }

  // 2) 파일 저장(시간이 걸리는 구간)은 잠금 밖에서 처리 → 여러 명이 동시에 제출해도 서로 기다리지 않음
  var newId = 'T' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss') + ('00' + Math.floor(Math.random() * 1000)).slice(-3);
  var photoFileId = saveFile(params.사진base64, params.사진타입, newId + '_photo.jpg', '강사사진');
  var profileFileId = saveFile(params.프로필base64, params.프로필타입, newId + '_강사카드.pdf', '강사프로필파일');
  var consentFileId = saveFile(params.동의서base64, params.동의서타입, newId + '_동의서.pdf', '개인정보동의서');
  var savedIds = [photoFileId, profileFileId, consentFileId];

  // 3) 시트 기록만 한 명씩(잠금): 중복 연락처·하루 상한을 다시 확인한 뒤 저장
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(60000);
  } catch (err) {
    trashFiles_(savedIds);
    return jsonOut({ status: 'busy', message: '접수가 몰려 처리가 지연되고 있습니다. 잠시 후 자동으로 다시 시도합니다.' });
  }
  var sendRegMail = false, regLines = null;
  try {
    if (findDuplicateInstructor(params.연락처)) {
      trashFiles_(savedIds);
      return jsonOut({ status: 'duplicate', message: '이미 같은 연락처로 등록되었거나 심사 중입니다. 확인이 필요하시면 교육훈련팀(' + CONTACT_PHONE + ')으로 문의해 주세요.' });
    }
    if (!takeRegisterSlot()) {
      trashFiles_(savedIds);
      return jsonOut({ status: 'limit', message: '오늘 접수 가능한 인원을 초과했습니다. 내일 다시 신청하시거나 교육훈련팀(' + CONTACT_PHONE + ')으로 문의해 주세요.' });
    }
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
    var newRow = [
      newId,
      params.성명 || '', textCell(params.연락처), params.이메일 || '', params.소속 || '',
      params.직위 || '', params.강사구분 || '', params.전문분야 || '', params.교과목명 || '',
      params.활동지역 || '', params.자격증학위 || '', params.약력 || '',
      photoFileId, consentFileId,
      Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd'),
      '승인대기',
      params.생년월일 || '',
      profileFileId,
      '자진등록'
    ];

    appendInstructorRow(sheet, newRow, nowStamp() + ' 체크 동의+동의서 제출');

    // 접수확인 메일: 승인·반려 안내 메일(대기 중인 건)에 쓸 한도를 먼저 남겨 두고, 여유가 있을 때만 발송
    regLines = [
      '안녕하세요, ' + (params.성명 || '') + '님.',
      '전남소방학교 외부강사 등록 신청이 정상적으로 접수되었습니다.',
      '<b>등록 승인 여부는 메일로 다시 안내드리니, 반드시 메일을 확인해 주시기 바랍니다.</b>'
    ];
    if (remainingMailQuota_() > mailQueueCounts_().대기 + MAIL_FIRST_RESERVE) {
      sendRegMail = true;   // 메일은 잠금을 푼 뒤에 발송
    } else {
      enqueueMail_(newId, params.이메일, '[전남소방학교] 외부강사 등록신청이 접수되었습니다', regLines, '접수확인', '생략', '메일 한도 보존을 위해 접수확인 메일을 보내지 않음(화면 안내로 대체)');
    }
  } finally {
    lock.releaseLock();
  }
  if (sendRegMail) sendConfirmationEmail(params.이메일, '[전남소방학교] 외부강사 등록신청이 접수되었습니다', regLines);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', 강사ID: newId }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 신규 강사 초대: 담당자가 이름·연락처·이메일만 입력해 초대 링크 발송
function inviteSend(params) {
  if (!checkPassword(params.password)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: writeAccessDeniedMessage(params.password) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var inviteEmail = String(params.이메일 || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail)) {
    return jsonError('이메일 형식이 올바르지 않습니다');
  }

  // 이미 등록된 연락처면 초대를 보내지 않고 알림(초대 링크로 등록해도 새로 만들어지지 않기 때문)
  var dupInvite = findDuplicateInstructor(params.연락처);
  if (dupInvite) {
    return jsonError('이미 등록된 연락처입니다(' + (dupInvite.성명 || '이름 없음') + ', 상태: ' + (dupInvite.상태 || '-') + '). 새로 초대하지 않았습니다.');
  }

  var link = (params.linkBase || '') + 'instructor-invite.html'
    + '?name=' + encodeURIComponent(params.성명 || '')
    + '&phone=' + encodeURIComponent(params.연락처 || '')
    + '&email=' + encodeURIComponent(params.이메일 || '');

  var mailResult = sendConfirmationEmail(
    inviteEmail,
    '[전남소방학교] 외부강사 등록 안내',
    [
      '안녕하세요, ' + (params.성명 || '') + '님.',
      '전남소방학교 외부강사로 모시게 되어 안내드립니다.',
      '아래 링크를 통해 기본정보를 입력해 주시면, 별도 심사 없이 바로 강사풀에 등록됩니다.',
      '<a href="' + link + '">' + link + '</a>'
    ]
  );
  if (!mailResult || !mailResult.ok) {
    return jsonError('메일을 보내지 못했습니다: ' + ((mailResult && mailResult.reason) || '원인 불명'));
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', 받는주소: inviteEmail, 남은한도: mailResult.남은한도 }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 초대받은 강사가 기본정보를 제출 → 심사 없이 즉시 활성 등록 (강의정보는 받지 않음)
function inviteRegister(params) {
  // 같은 연락처가 이미 등록되어 있으면 새로 만들지 않고 기존 강사로 처리(중복 제출·이중 클릭 방지)
  var dupInv = findDuplicateInstructor(params.연락처);
  if (dupInv) {
    return jsonOut({ status: 'ok', 강사ID: dupInv.id, 기존등록: true });
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var newId = 'T' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss');

  var photoId = saveFile(params.사진base64, params.사진타입, newId + '_photo.jpg', '강사사진');
  var consentId = saveFile(params.동의서base64, params.동의서타입, newId + '_동의서.pdf', '개인정보동의서');
  var profileId = saveFile(params.프로필base64, params.프로필타입, newId + '_강사카드.pdf', '강사프로필파일');

  appendInstructorRow(sheet, [
    newId, params.성명 || '', textCell(params.연락처), params.이메일 || '', params.소속 || '',
    params.직위 || '', params.강사구분 || '', params.전문분야 || '', params.교과목명 || '',
    params.활동지역 || '', params.자격증학위 || '', params.약력 || '',
    photoId, consentId,
    Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd'), '활성',
    params.생년월일 || '', profileId,
    '초대'
  ], nowStamp() + ' 동의서 제출');

  // 계좌정보는 시트에 저장하지 않음(강사카드 PDF에만 기재, 비공개 폴더에 보관)

  sendConfirmationEmail(
    params.이메일,
    '[전남소방학교] 외부강사 등록이 완료되었습니다',
    [
      '안녕하세요, ' + (params.성명 || '') + '님.',
      '외부강사 등록이 정상적으로 완료되었습니다.',
      '앞으로 강의가 확정되면 별도 안내를 통해 자료 제출을 요청드리겠습니다.'
    ]
  );

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', 강사ID: newId }))
    .setMimeType(ContentService.MimeType.JSON);
}

function submitLecture(params) {
  var instructorId = params.강사ID;
  var found = findInstructor(instructorId);

  // id 없는 링크로 들어온 사람이 이미 등록된 연락처라면 기존 강사로 연결(새 ID 생성 방지)
  if (!found) {
    var dupSub = findDuplicateInstructor(params.연락처);
    if (dupSub) {
      found = findInstructor(dupSub.id);
      instructorId = dupSub.id;
    }
  }

  if (!found) {
    // 신규 강사: 프로필 + 동의서 + 계좌정보까지 함께 생성 (id 없는 기본링크로 들어온 전화섭외 경로)
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
    instructorId = 'T' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss');

    var photoId = saveFile(params.사진base64, params.사진타입, instructorId + '_photo.jpg', '강사사진');
    var consentId = saveFile(params.동의서base64, params.동의서타입, instructorId + '_동의서.pdf', '개인정보동의서');
    var profileId = saveFile(params.프로필base64, params.프로필타입, instructorId + '_강사카드.pdf', '강사프로필파일');

    appendInstructorRow(sheet, [
      instructorId, params.성명 || '', textCell(params.연락처), params.이메일 || '', params.소속 || '',
      params.직위 || '', params.강사구분 || '', params.전문분야 || '', params.교과목명 || '',
      params.활동지역 || '', params.자격증학위 || '', params.약력 || '',
      photoId, consentId,
      Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd'), '활성',
      params.생년월일 || '', profileId,
      '전화섭외'
    ], nowStamp() + ' 동의서 제출');

    // 계좌정보는 시트에 저장하지 않음(강사카드 PDF에만 기재, 비공개 폴더에 보관)
  }

  var planId = saveFile(params.계획서base64, params.계획서타입, instructorId + '_계획서', '강의자료');
  var materialId = saveFile(params.교안base64, params.교안타입, instructorId + '_교안', '강의자료');
  var today = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');

  var histSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강의이력');
  var histId = params.hid || ('L' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss'));

  if (params.hid) {
    // 이미 "강의 배정" 단계에서 만들어둔 행을 찾아 업데이트 (배정됨 → 제출완료)
    var hData = histSheet.getDataRange().getValues();
    var hHeaders = hData[0];
    var idCol = hHeaders.indexOf('이력ID');
    var rowIdx = -1;
    for (var i = 1; i < hData.length; i++) {
      if (String(hData[i][idCol]) === String(params.hid)) { rowIdx = i; break; }
    }
    if (rowIdx > -1) {
      var planCol = hHeaders.indexOf('계획서링크');
      var materialCol = hHeaders.indexOf('교안링크');
      var submitCol = hHeaders.indexOf('제출일');
      var statusCol = hHeaders.indexOf('상태');
      var categoryCol = hHeaders.indexOf('구분');
      // 계획서링크~구분이 시트상 연속된 열이므로 한 번의 범위쓰기로 묶어서 처리속도 개선
      var finalCategory = params.구분 || hData[rowIdx][categoryCol] || '';
      histSheet.getRange(rowIdx + 1, planCol + 1, 1, 5).setValues([[planId, materialId, today, '제출완료', finalCategory]]);
    } else {
      // hid를 못 찾은 경우(예외) 새 행으로 추가
      histSheet.appendRow([
        histId, instructorId, params.강의명 || '', params.일자 || '', params.시간 || '', params.교과목 || '',
        planId, materialId, today, '제출완료', params.구분 || '', ''
      ]);
    }
  } else {
    // 배정 단계 없이 바로 제출된 경우(전화섭외 신규 강사 등) 새 행 추가
    histSheet.appendRow([
      histId, instructorId, params.강의명 || '', params.일자 || '', params.시간 || '', params.교과목 || '',
      planId, materialId, today, '제출완료', params.구분 || '', ''
    ]);
  }

  var recipientEmail = found ? found.이메일 : params.이메일;
  var recipientName = found ? found.성명 : params.성명;
  sendConfirmationEmail(
    recipientEmail,
    '[전남소방학교] 강의자료 제출이 접수되었습니다',
    [
      '안녕하세요, ' + (recipientName || '') + '님.',
      '"' + (params.강의명 || '') + '" 강의 자료가 정상적으로 접수되었습니다.',
      '문의사항이 있으시면 담당자에게 연락해 주시기 바랍니다.'
    ]
  );

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', 강사ID: instructorId, 이력ID: histId }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 강사 상세의 강의 이력: 강의배정DB(교과목시간표)에서 해당 강사의 편성을 읽기 전용으로 돌려줌
// (취소되지 않은 배정이 곧 이력. 취소된 기수는 상태 "취소됨"으로 표시)
function getHistory(params) {
  if (!checkReadAccess(params.password)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: '인증이 필요합니다' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var id = String(params.강사ID || '');
  var history = [];
  var ss = openAssignSS();
  if (ss && id) {
    var sess = readAssignTable(ss, SESSION_SHEET);
    var mine = sess.rows.filter(function(r){ return String(r['강사ID'] || '') === id; });
    if (mine.length) {
      var cancelledKeys = {};
      readAssignTable(ss, '연간계획').rows.forEach(function(r){
        if (isPlanCancelled(r)) cancelledKeys[String(r['과정+기수'])] = true;
      });
      var periods = readAssignTable(ss, '교시표').rows;
      var pInfo = function(n){ return periods.filter(function(r){ return Number(r['교시']) === n; })[0]; };
      mine.forEach(function(r){
        var sp = Number(r['시작교시']), ep = Number(r['끝교시']);
        var ps = pInfo(sp), pe = pInfo(ep);
        history.push({
          이력ID: String(r['편성ID'] || ''),
          강의명: String(r['개설키'] || ''),
          일자: String(r['일자'] || ''),
          교시: isFinite(sp) && isFinite(ep) ? (sp === ep ? sp + '교시' : sp + '~' + ep + '교시') : '',
          시간: (ps && pe && ps['시작'] && pe['종료']) ? ps['시작'] + '~' + pe['종료'] : '',
          시수: (isFinite(sp) && isFinite(ep) && ep >= sp) ? ep - sp + 1 : 0,
          교과목: String(r['교과목'] || ''),
          구분: String(r['교과목 구분'] || ''),
          강의실: String(r['강의실'] || ''),
          역할: String(r['강사 역할'] || '') === '보조강사' ? '보조강사' : '주강사',
          상태: cancelledKeys[String(r['개설키'])] ? '취소됨' : '',
          계획서링크: String(r['계획서파일ID'] || ''),
          계획서제출일시: String(r['계획서제출일시'] || ''),
          교안링크: ''
        });
      });
      history.sort(function(a, b) {
        var d = String(b.일자).localeCompare(String(a.일자));
        return d !== 0 ? d : String(b.시간).localeCompare(String(a.시간));
      });
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', data: history }))
    .setMimeType(ContentService.MimeType.JSON);
}

function testEmail() {
  sendConfirmationEmail(
    Session.getActiveUser().getEmail(),
    '[테스트] 메일 발송 확인',
    ['이 메일이 보이면 권한 승인이 완료된 것입니다.']
  );
}

function decideApproval(params) {
  if (!checkPassword(params.password)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: writeAccessDeniedMessage(params.password) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!checkAdminPassword(params.adminPassword)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: '승인 권한 비밀번호가 올바르지 않습니다' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var statusCol = headers.indexOf('상태');
  var emailCol = headers.indexOf('이메일');
  var nameCol = headers.indexOf('성명');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.강사ID)) {
      var decision = params.decision; // '승인' | '반려' | '보류'
      var newStatus = decision === '승인' ? '활성' : (decision === '보류' ? '보류중' : '반려');
      sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);

      var email = data[i][emailCol];
      var name = data[i][nameCol];

      var mailState = '';   // '발송완료' | '대기' | ''(보류: 메일 없음)
      var qRow = 0;
      if (decision === '승인') {
        qRow = enqueueMail_(params.강사ID, email, '[전남소방학교] 외부강사 등록이 승인되었습니다', [
          '안녕하세요, ' + name + '님.',
          '외부강사 등록 신청이 승인되어 강사풀에 정식 등록되었습니다.',
          '앞으로 강의가 확정되면 별도 안내를 통해 자료 제출을 요청드리겠습니다.'
        ], '승인');
      } else if (decision === '반려') {
        qRow = enqueueMail_(params.강사ID, email, '[전남소방학교] 외부강사 등록 신청 결과 안내', [
          '안녕하세요, ' + name + '님.',
          '외부강사 등록 신청을 검토한 결과, 이번에는 등록이 어려운 것으로 확인되었습니다.' + (params.사유 ? ' (사유: ' + params.사유 + ')' : ''),
          '문의사항이 있으시면 담당자에게 연락해 주시기 바랍니다.'
        ], '반려');
      }
      if (qRow) {
        flushMailQueue_();   // 한도가 남아 있으면 바로 발송(앞선 대기 건 포함, 오래된 순)
        mailState = String(getMailQueueSheet_().getRange(qRow, MAIL_COL_STATUS).getValue());
      }
      // 보류는 강사에게 메일을 보내지 않음 (검토를 미루는 내부 처리이므로)

      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', 메일: mailState }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: '강사를 찾을 수 없습니다' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 배정 링크(hid)로 들어온 화면에서, 이미 배정된 강의 정보를 읽기 전용으로 보여주기 위한 조회 (인증 불필요)
function getAssignment(params) {
  var histSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강의이력');
  var data = histSheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('이력ID');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(params.hid)) {
      var obj = {};
      headers.forEach(function(h, idx){
        var val = data[i][idx];
        if (val instanceof Date) val = Utilities.formatDate(val, 'GMT+9', 'yyyy-MM-dd');
        obj[h] = val;
      });
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', found: true, data: obj }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', found: false }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 개인정보 재동의 확인 기록 (예: 유선통화로 재사용 동의 확인). 상태는 바꾸지 않고 날짜·메모만 기록
function recordReconsent(params) {
  if (!checkPassword(params.password)) {
    return jsonError(writeAccessDeniedMessage(params.password));
  }
  if (!checkAdminPassword(params.adminPassword)) {
    return jsonError('권한 비밀번호가 올바르지 않습니다');
  }
  var memo = String(params.메모 || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var dateCol = ensureHeaderColumn(sheet, '재동의확인일');
  var memoCol = ensureHeaderColumn(sheet, '재동의메모');
  var data = sheet.getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.강사ID)) {
      sheet.getRange(i + 1, dateCol).setNumberFormat('@').setValue(today);
      sheet.getRange(i + 1, memoCol).setValue(memo);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', date: today, memo: memo }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return jsonError('강사를 찾을 수 없습니다');
}

// 강의 이력이 있는 강사는 삭제 대신 휴면 처리 (데이터는 보존, 목록에서 비활성 표시)
function setDormant(params) {
  if (!checkPassword(params.password)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: writeAccessDeniedMessage(params.password) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!checkAdminPassword(params.adminPassword)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: '권한 비밀번호가 올바르지 않습니다' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var statusCol = headers.indexOf('상태');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.강사ID)) {
      sheet.getRange(i + 1, statusCol + 1).setValue('휴면');
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: '강사를 찾을 수 없습니다' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function deleteInstructor(params) {
  if (!checkPassword(params.password)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: writeAccessDeniedMessage(params.password) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!checkAdminPassword(params.adminPassword)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: '삭제 권한 비밀번호가 올바르지 않습니다' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 강의 이력(취소 건 포함)이 하나라도 있으면 삭제하지 않음: 배정 기록·통계 보존 (휴면 처리 이용)
  // 강의배정DB(교과목시간표)의 편성과 옛 강의이력 시트를 모두 확인
  var delStats = sessionStatsByInstructor(Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd'))[String(params.강사ID)];
  if (delStats && delStats.all > 0) {
    return jsonError('강의 이력이 있는 강사는 삭제할 수 없습니다. 이력을 보존하려면 "휴면 처리"를 이용해 주세요.');
  }
  var legacySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강의이력');
  var histCheck = legacySheet ? legacySheet.getDataRange().getValues() : [];
  for (var h = 1; h < histCheck.length; h++) {
    if (String(histCheck[h][1]) === String(params.강사ID)) {
      return jsonError('강의 이력이 있는 강사는 삭제할 수 없습니다. 이력을 보존하려면 "휴면 처리"를 이용해 주세요.');
    }
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강사기본정보');
  var data = sheet.getDataRange().getValues();
  var deleted = false;
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(params.강사ID)) {
      sheet.deleteRow(i + 1);
      deleted = true;
      break;
    }
  }

  var accSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('계좌정보');
  var accData = accSheet ? accSheet.getDataRange().getValues() : [];
  for (var j = accData.length - 1; j >= 1; j--) {
    if (String(accData[j][0]) === String(params.강사ID)) {
      accSheet.deleteRow(j + 1);
    }
  }

  var histSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('강의이력');
  var histData = histSheet ? histSheet.getDataRange().getValues() : [];
  for (var k = histData.length - 1; k >= 1; k--) {
    if (String(histData[k][1]) === String(params.강사ID)) {
      histSheet.deleteRow(k + 1);
    }
  }

  if (!deleted) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: '강사를 찾을 수 없습니다' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSchoolInfo() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('학교정보');
  var data = sheet.getDataRange().getValues();
  var info = {};
  data.slice(1).forEach(function(row){
    if (row[0]) info[row[0]] = row[1] || '';
  });
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', data: info }))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateSchoolInfo(params) {
  if (!checkPassword(params.password)) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: writeAccessDeniedMessage(params.password) }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('학교정보');
  var fields = params.fields || {};

  if (params.전경사진base64) {
    fields['전경사진'] = saveFile(params.전경사진base64, params.전경사진타입, 'school_cover.jpg', '학교사진');
  }

  var data = sheet.getDataRange().getValues();
  Object.keys(fields).forEach(function(key){
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(fields[key]);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([key, fields[key]]);
      data.push([key, fields[key]]);
    }
  });

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// 강의배정DB (별도 구글 시트 파일) 연동 - 스크립트 속성 ASSIGN_SHEET_ID에 파일 ID 저장
// 시트 규칙: 1행·A열은 비우고 B2부터 시작(헤더 2행, 데이터 3행부터)
// =====================================================================
var ASSIGN_HEADER_ROW = 2;
var ASSIGN_FIRST_COL = 2;
var SESSION_SHEET = '교과목시간표';
var SESSION_HEADERS = ['편성ID', '개설키', '반', '일자', '시작교시', '끝교시', '교과목', '교과목 구분',
  '강사ID', '강사명', '강의실', '비고', '입력일시', '수정일시', '입력 역할', '강사 역할',
  '계획서제출일시', '계획서파일ID'];
// 강사 역할: 빈칸 = 주강사(기존 자료 호환). 주강사가 2명인 교과목도 가능
var SESSION_ROLE_VALUES = ['주강사', '보조강사'];
// 계획서제출일시·계획서파일ID: 강사가 제출 링크(lecture-submission.html?id=강사ID&sid=편성ID)로 낸 강의계획서(PDF) 기록. 주강사만 제출 대상
var SESSION_NUMBER_COLS = ['시작교시', '끝교시'];
var SESSION_CLASS_VALUES = ['전체', 'A', 'B'];

function openAssignSS() {
  var id = PropertiesService.getScriptProperties().getProperty('ASSIGN_SHEET_ID');
  if (!id) return null;
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    Logger.log('강의배정DB 열기 실패: ' + err);
    return null;
  }
}

function assignNotConnectedError() {
  return jsonError('강의배정DB 파일이 연결되지 않았습니다. Apps Script 스크립트 속성 ASSIGN_SHEET_ID를 확인해 주세요.');
}

// 헤더 문구에서 끝의 (자동...)·(필수...) 설명은 제거: "과정명\n(필수)" -> "과정명"
// 여러 줄 머리글은 한 줄로 합침: "입교\n시작일\n(필수)" -> "입교 시작일"
function assignHeaderKey(h) {
  var s = String(h == null ? '' : h).replace(/\s+/g, ' ').trim();
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function assignCellValue(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (v === null || v === undefined) return '';
  return v;
}

// 시트를 헤더 2행·B열 기준 객체 배열로 읽음. 헤더가 비어 있는 열은 건너뜀. 값이 전부 빈 줄은 제외.
function readAssignTable(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { missing: true, headers: [], rows: [] };
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < ASSIGN_HEADER_ROW || lastCol < ASSIGN_FIRST_COL) return { missing: false, headers: [], rows: [] };
  var data = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, lastRow - ASSIGN_HEADER_ROW + 1, lastCol - ASSIGN_FIRST_COL + 1).getValues();
  var tz = ss.getSpreadsheetTimeZone();
  var headers = data[0].map(assignHeaderKey);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var any = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = assignCellValue(data[i][c], tz);
      if (v !== '') any = true;
      obj[headers[c]] = v;
    }
    if (any) { obj._row = i + ASSIGN_HEADER_ROW; rows.push(obj); }
  }
  return { missing: false, headers: headers, rows: rows };
}

// 교과목시간표 시트를 돌려줌. 없으면 헤더와 함께 새로 만들고, 헤더가 비어 있으면 헤더를 씀.
function ensureSessionSheet(ss) {
  var sheet = ss.getSheetByName(SESSION_SHEET);
  if (!sheet) sheet = ss.insertSheet(SESSION_SHEET);
  var headRange = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, 1, SESSION_HEADERS.length);
  var cur = headRange.getValues()[0];
  var empty = cur.every(function(v){ return String(v) === ''; });
  if (empty) {
    headRange.setValues([SESSION_HEADERS]);
    // 값 칸은 텍스트 서식으로 지정해 날짜·숫자 자동 변환을 막음(교시는 숫자 유지)
    var fmts = SESSION_HEADERS.map(function(h){ return SESSION_NUMBER_COLS.indexOf(h) > -1 ? '0' : '@'; });
    var rows = 3000;
    ensureSheetRows(sheet, ASSIGN_HEADER_ROW + rows);
    var f = [];
    for (var i = 0; i < rows; i++) f.push(fmts);
    sheet.getRange(ASSIGN_HEADER_ROW + 1, ASSIGN_FIRST_COL, rows, SESSION_HEADERS.length).setNumberFormats(f);
  } else {
    // 기존 시트에 뒤에 추가된 머리글(예: 강사 역할)이 없으면, 그 칸이 비어 있을 때만 머리글을 씀(기존 열 순서는 바꾸지 않음)
    var curKeys = cur.map(assignHeaderKey);
    SESSION_HEADERS.forEach(function(h, idx){
      if (curKeys.indexOf(h) > -1 || String(cur[idx]) !== '') return;
      var lastRowNeeded = Math.max(sheet.getLastRow(), ASSIGN_HEADER_ROW + 3000);
      ensureSheetRows(sheet, lastRowNeeded);
      sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL + idx).setValue(h);
      sheet.getRange(ASSIGN_HEADER_ROW + 1, ASSIGN_FIRST_COL + idx, lastRowNeeded - ASSIGN_HEADER_ROW, 1).setNumberFormat('@');
    });
  }
  return sheet;
}

// 시트의 전체 행 수가 부족하면 아래에 행을 늘림(기본 시트는 1000행)
function ensureSheetRows(sheet, needed) {
  var max = sheet.getMaxRows();
  if (max < needed) sheet.insertRowsAfter(max, needed - max);
}

function sessionColMap(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), ASSIGN_FIRST_COL + SESSION_HEADERS.length - 1);
  var headers = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, 1, lastCol - ASSIGN_FIRST_COL + 1).getValues()[0].map(assignHeaderKey);
  var map = {};
  headers.forEach(function(h, idx){ if (h) map[h] = idx; });
  return { headers: headers, map: map };
}

function readSessions(ss, keyFilter) {
  var sheet = ensureSessionSheet(ss);
  var t = readAssignTable(ss, SESSION_SHEET);
  var rows = t.rows;
  if (keyFilter) rows = rows.filter(function(r){ return String(r['개설키']) === String(keyFilter); });
  rows.forEach(function(r){ delete r._row; });
  return rows;
}

// 연간계획 4개 시트를 한 번에 읽음
function listAssignmentData(params) {
  if (!checkReadAccess(params.password)) return jsonError('인증이 필요합니다');
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var names = ['연간계획', '과정목록', '강의실', '교시표'];
  var out = { status: 'ok', 시트없음: [] };
  names.forEach(function(n){
    var t = readAssignTable(ss, n);
    if (t.missing) out.시트없음.push(n);
    var rows = t.rows;
    if (n === '연간계획') rows = rows.filter(function(r){ return String(r['과정명']) !== ''; });
    if (n === '강의실') rows = rows.filter(function(r){ return String(r['강의실명']) !== ''; });
    if (n === '교시표') rows = rows.filter(function(r){ return !isNaN(Number(r['교시'])) && String(r['교시']) !== ''; });
    rows.forEach(function(r){ delete r._row; });
    out[n] = rows;
  });
  out.개수 = {
    연간계획: out['연간계획'].length, 과정목록: out['과정목록'].length,
    강의실: out['강의실'].length, 교시표: out['교시표'].length
  };
  out.변경이력 = readPlanHistory(ss);
  try { out.빈교시확인 = gapActiveRows(ss); } catch (err) { out.빈교시확인 = []; }
  try { out.강의실예약 = reserveActiveRows(ss).map(function(r){ delete r._row; return r; }); } catch (err) { out.강의실예약 = []; }
  return jsonOut(out);
}

function listSessions(params) {
  if (!checkReadAccess(params.password)) return jsonError('인증이 필요합니다');
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var rows = readSessions(ss, params.개설키 ? String(params.개설키) : '');
  return jsonOut({ status: 'ok', count: rows.length, data: rows });
}

function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max || 200);
}

// 편성 한 줄 추가 또는 수정. 강사 지정·변경·취소도 이 액션 하나로 처리.
// 겹침은 막지 않고 저장하며, 범위 밖 일자·없는 교시·없는 강의실 등은 warnings로만 알려줌.
function saveSession(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();

  var key = cleanText(params.개설키, 200);
  if (!key) return jsonError('개설키(과정+기수)가 필요합니다');
  var plan = readAssignTable(ss, '연간계획').rows.filter(function(r){ return String(r['과정+기수']) === key; });
  if (plan.length === 0) return jsonError('연간계획에 없는 개설키입니다: ' + key);
  var course = plan[0];
  if (isPlanCancelled(course) && !cleanText(params.편성ID, 60)) {
    return jsonError('취소된 기수에는 교과목을 추가할 수 없습니다. 연간계획에서 취소 해제 후 추가해 주세요.');
  }

  var klass = cleanText(params.반 || '전체', 10);
  if (SESSION_CLASS_VALUES.indexOf(klass) === -1) return jsonError('반은 전체, A, B 중 하나여야 합니다');

  var dateStr = cleanText(params.일자, 10);
  if (!isValidDateStr(dateStr)) return jsonError('일자는 yyyy-MM-dd 형식이어야 합니다');

  var startP = Number(params.시작교시);
  var endP = Number(params.끝교시);
  if (!isFinite(startP) || !isFinite(endP) || startP % 1 !== 0 || endP % 1 !== 0 || startP < 1 || endP < 1) {
    return jsonError('시작교시와 끝교시는 1 이상의 정수여야 합니다');
  }
  if (startP > endP) return jsonError('시작교시가 끝교시보다 클 수 없습니다');

  var subject = cleanText(params.교과목, 100);
  if (!subject) return jsonError('교과목을 입력해 주세요');

  var warnings = [];

  // 강사: 강사ID가 있으면 강사DB에서 확인해 성명 복사, 없으면 수기 입력 이름 저장, 둘 다 없으면 미지정
  var instructorId = cleanText(params.강사ID, 50);
  var instructorName = '';
  if (instructorId) {
    var inst = findInstructor(instructorId);
    if (!inst) return jsonError('강사를 찾을 수 없습니다');
    instructorName = String(inst.성명 || '');
    if (inst.상태 && ['활성', '승인', '정식'].indexOf(String(inst.상태)) === -1) {
      warnings.push('강사 상태가 "' + inst.상태 + '"입니다');
    }
  } else {
    instructorName = cleanText(params.강사명, 50);
  }
  // 강사 역할: 주강사/보조강사(빈칸은 주강사로 봄). 강사가 없으면 역할도 비움
  var instructorRole = cleanText(params['강사 역할'], 10);
  if (instructorRole && SESSION_ROLE_VALUES.indexOf(instructorRole) === -1) return jsonError('강사 역할은 주강사 또는 보조강사여야 합니다');
  if (!instructorId && !instructorName) instructorRole = '';
  else if (!instructorRole) instructorRole = '주강사';

  // 경고 검사(저장은 허용)
  var inRange = false;
  [['입교 시작일', '입교 종료일'], ['사이버 시작일', '사이버 종료일'], ['실습(외부) 시작일', '실습(외부) 종료일']].forEach(function(p){
    var s = String(course[p[0]] || ''), e = String(course[p[1]] || '');
    if (s && e && dateStr >= s && dateStr <= e) inRange = true;
  });
  if (!inRange) warnings.push('일자가 해당 과정의 입교·사이버·실습 기간 밖입니다');
  var periods = readAssignTable(ss, '교시표').rows.map(function(r){ return Number(r['교시']); }).filter(function(n){ return isFinite(n); });
  if (periods.length && (periods.indexOf(startP) === -1 || periods.indexOf(endP) === -1)) {
    warnings.push('교시표에 없는 교시입니다');
  }
  var room = cleanText(params.강의실, 100);
  if (room) {
    var rooms = readAssignTable(ss, '강의실').rows.map(function(r){ return String(r['강의실명']); });
    if (rooms.length && rooms.indexOf(room) === -1) warnings.push('강의실 목록에 없는 이름입니다(정식 등록 대기 대상)');
  }

  var sheet = ensureSessionSheet(ss);
  var cm = sessionColMap(sheet);
  var width = SESSION_HEADERS.length;
  var now = nowStamp();
  var rowNum = 0;
  var existing = null;
  var sessionId = cleanText(params.편성ID, 60);

  if (sessionId) {
    var t = readAssignTable(ss, SESSION_SHEET);
    var found = t.rows.filter(function(r){ return String(r['편성ID']) === sessionId; });
    if (found.length === 0) return jsonError('편성을 찾을 수 없습니다');
    rowNum = found[0]._row;
    existing = found[0];
  } else {
    var ids = readAssignTable(ss, SESSION_SHEET).rows.map(function(r){ return String(r['편성ID']); });
    do {
      sessionId = 'S' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss') + '-' + ('000' + Math.floor(Math.random() * 1000)).slice(-3);
    } while (ids.indexOf(sessionId) > -1);
    rowNum = Math.max(sheet.getLastRow(), ASSIGN_HEADER_ROW) + 1;
  }

  var values = {
    '편성ID': sessionId, '개설키': key, '반': klass, '일자': dateStr, '시작교시': startP, '끝교시': endP,
    '교과목': subject, '교과목 구분': cleanText(params['교과목 구분'] || params.교과목구분, 50),
    '강사ID': instructorId, '강사명': instructorName, '강의실': room, '비고': cleanText(params.비고, 200),
    '입력일시': existing ? String(existing['입력일시'] || now) : now,
    '수정일시': now,
    '입력 역할': existing ? String(existing['입력 역할'] || '관리자') : '관리자',
    '강사 역할': instructorRole,
    // 강의계획서 제출 기록은 같은 강사일 때만 유지(강사를 바꾸거나 비우면 새로 받아야 하므로 비움)
    '계획서제출일시': (existing && instructorId && String(existing['강사ID'] || '') === instructorId) ? String(existing['계획서제출일시'] || '') : '',
    '계획서파일ID': (existing && instructorId && String(existing['강사ID'] || '') === instructorId) ? String(existing['계획서파일ID'] || '') : ''
  };
  var rowArr = [];
  for (var i = 0; i < width; i++) rowArr.push('');
  SESSION_HEADERS.forEach(function(h){
    if (cm.map[h] !== undefined && cm.map[h] < width) rowArr[cm.map[h]] = values[h];
  });
  ensureSheetRows(sheet, rowNum);
  var range = sheet.getRange(rowNum, ASSIGN_FIRST_COL, 1, width);
  range.setNumberFormats([SESSION_HEADERS.map(function(h){ return SESSION_NUMBER_COLS.indexOf(h) > -1 ? '0' : '@'; })]);
  range.setValues([rowArr]);

  // 일정(일자·교시)·강사·강의실 변경과 추가는 '변경이력'에 남김(실패해도 저장 결과에는 영향 없음)
  try {
    var item = sessionLogItem(subject, klass), st = nowStamp(), hl = [];
    function hAdd(type, before, after) { hl.push({ 일시: st, 개설키: key, 유형: type, 항목: item, 전: before, 후: after, 사유: '', 역할: '관리자' }); }
    var nowWho = instructorName || '미지정';
    if (!existing) {
      hAdd('교과목 추가', '', sessionLogTime(dateStr, startP, endP) + ' · ' + nowWho + (room ? ' · ' + room : ''));
    } else {
      var oldT = sessionLogTime(existing['일자'], existing['시작교시'], existing['끝교시']), newT = sessionLogTime(dateStr, startP, endP);
      if (oldT !== newT) hAdd('교과목 일정 변경', oldT, newT);
      var oldWho = String(existing['강사명'] || '') || '미지정';
      if (String(existing['강사ID'] || '') !== instructorId || oldWho !== nowWho) hAdd('교과목 강사 변경', oldWho, nowWho);
      if (String(existing['강의실'] || '') !== room) hAdd('교과목 강의실 변경', String(existing['강의실'] || '') || '미정', room || '미정');
    }
    if (hl.length) appendPlanHistory(ss, hl);
  } catch (err) { Logger.log('교과목 변경이력 기록 오류: ' + err); }

  // 강의실 예약 연동: 편성 위치가 바뀌면 이전 구간의 예약을 되살리고, 새 구간의 사전확보 예약은 전환(실패해도 저장 결과에는 영향 없음)
  try {
    var slotChanged = !existing || String(existing['개설키'] || '') !== key || String(existing['일자'] || '') !== dateStr ||
      Number(existing['시작교시']) !== startP || Number(existing['끝교시']) !== endP || String(existing['강의실'] || '') !== room;
    if (slotChanged) {
      var rh = [];
      if (existing) reserveRestoreForSession(ss, sessionId, rh);
      reserveConvertForSession(ss, sessionId, key, dateStr, room, startP, endP, subject, rh);
      if (rh.length) appendPlanHistory(ss, rh);
    }
  } catch (err) { Logger.log('강의실 예약 연동 오류: ' + err); }

  return jsonOut({ status: 'ok', 편성ID: sessionId, data: values, warnings: warnings, 신규: !existing });
}

function sessionLogItem(subject, klass) {
  return String(subject) + ((klass && klass !== '전체') ? ' (' + klass + '반)' : '');
}
function sessionLogTime(date, s, e) {
  var a = Number(s), b = Number(e);
  return String(date) + ' ' + (a === b ? a + '교시' : a + '~' + b + '교시');
}

// ===== 강의계획서 제출(편성 단위) =====
// 제출 링크: lecture-submission.html?id=강사ID&sid=편성ID (로그인 없이 열림 → 편성ID와 강사ID가 모두 맞을 때만 응답, 필요한 정보만 돌려줌)
function findSessionForSubmit(ss, sid, instId) {
  if (!sid || !instId) return { error: '제출 링크가 올바르지 않습니다. 담당자에게 문의해 주세요.' };
  ensureSessionSheet(ss);
  var found = readAssignTable(ss, SESSION_SHEET).rows.filter(function(r){ return String(r['편성ID']) === sid; });
  if (found.length === 0 || String(found[0]['강사ID'] || '') !== instId) {
    return { error: '제출 링크가 올바르지 않거나 편성이 변경되었습니다. 담당자에게 문의해 주세요.' };
  }
  var row = found[0];
  var plan = readAssignTable(ss, '연간계획').rows.filter(function(r){ return String(r['과정+기수']) === String(row['개설키']); });
  var cancelled = plan.length > 0 && isPlanCancelled(plan[0]);
  var periods = readAssignTable(ss, '교시표').rows;
  function pInfo(n) { return periods.filter(function(r){ return Number(r['교시']) === n; })[0]; }
  var ps = pInfo(Number(row['시작교시'])), pe = pInfo(Number(row['끝교시']));
  var time = (ps && pe && ps['시작'] && pe['종료']) ? ps['시작'] + '~' + pe['종료'] : '';
  return { row: row, cancelled: cancelled, time: time };
}

function getSessionForSubmit(params) {
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var r = findSessionForSubmit(ss, cleanText(params.편성ID, 60), cleanText(params.강사ID, 50));
  if (r.error) return jsonOut({ status: 'ok', found: false, message: r.error });
  var row = r.row;
  var isSub = String(row['강사 역할'] || '') === '보조강사';
  return jsonOut({ status: 'ok', found: true,
    cancelled: r.cancelled, required: !isSub,
    data: { 과정: String(row['개설키'] || ''), 교과목: String(row['교과목'] || ''), 구분: String(row['교과목 구분'] || ''),
      일자: String(row['일자'] || ''), 시간: r.time, 강의실: String(row['강의실'] || ''),
      역할: isSub ? '보조강사' : '주강사', 제출일시: String(row['계획서제출일시'] || ''), 제출됨: !!String(row['계획서파일ID'] || '') } });
}

function submitSessionPlan(params) {
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var sid = cleanText(params.편성ID, 60), instId = cleanText(params.강사ID, 50);
  var r = findSessionForSubmit(ss, sid, instId);
  if (r.error) return jsonError(r.error);
  if (r.cancelled) return jsonError('취소된 기수의 교과목이라 제출할 수 없습니다. 담당자에게 문의해 주세요.');
  if (String(r.row['강사 역할'] || '') === '보조강사') return jsonError('보조강사는 강의계획서를 제출하지 않아도 됩니다.');
  if (!params.계획서base64) return jsonError('강의계획서 파일을 첨부해 주세요.');
  if (!/pdf/i.test(String(params.계획서타입 || ''))) return jsonError('강의계획서는 PDF 파일만 올릴 수 있습니다.');
  if (String(params.계획서base64).length > 14 * 1024 * 1024) return jsonError('강의계획서 파일이 너무 큽니다. 10MB 이하로 올려 주세요.');

  var fileId = saveFile(params.계획서base64, params.계획서타입, instId + '_' + sid + '_계획서.pdf', '강의자료');
  var sheet = ensureSessionSheet(ss);
  var cm = sessionColMap(sheet);
  var rowNum = r.row._row;
  var now = nowStamp();
  sheet.getRange(rowNum, ASSIGN_FIRST_COL + cm.map['계획서제출일시']).setValue(now);
  sheet.getRange(rowNum, ASSIGN_FIRST_COL + cm.map['계획서파일ID']).setValue(fileId);

  var inst = findInstructor(instId);
  if (inst && inst.이메일) {
    try {
      sendConfirmationEmail(inst.이메일, '[전남소방학교] 강의계획서 제출이 접수되었습니다', [
        '안녕하세요, ' + (inst.성명 || '') + '님.',
        '"' + String(r.row['교과목'] || '') + '" (' + String(r.row['일자'] || '') + ') 강의계획서가 정상적으로 접수되었습니다.',
        '문의사항이 있으시면 담당자에게 연락해 주시기 바랍니다.'
      ]);
    } catch (err) { Logger.log('계획서 접수 메일 오류: ' + err); }
  }
  return jsonOut({ status: 'ok', 편성ID: sid, 제출일시: now });
}

function deleteSession(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var id = cleanText(params.편성ID, 60);
  if (!id) return jsonError('편성ID가 필요합니다');
  var sheet = ensureSessionSheet(ss);
  var t = readAssignTable(ss, SESSION_SHEET);
  var found = t.rows.filter(function(r){ return String(r['편성ID']) === id; });
  if (found.length === 0) return jsonError('편성을 찾을 수 없습니다');
  var dr = found[0];
  sheet.deleteRow(dr._row);
  try {
    appendPlanHistory(ss, [{ 일시: nowStamp(), 개설키: String(dr['개설키'] || ''), 유형: '교과목 삭제', 항목: sessionLogItem(dr['교과목'], String(dr['반'] || '전체')),
      전: sessionLogTime(dr['일자'], dr['시작교시'], dr['끝교시']) + ' · ' + (String(dr['강사명'] || '') || '미지정'), 후: '', 사유: '', 역할: '관리자' }]);
  } catch (err) { Logger.log('교과목 삭제 이력 기록 오류: ' + err); }
  try {
    var rh2 = [];
    reserveRestoreForSession(ss, id, rh2);
    if (rh2.length) appendPlanHistory(ss, rh2);
  } catch (err) { Logger.log('강의실 예약 복구 오류: ' + err); }
  return jsonOut({ status: 'ok', 편성ID: id });
}

// =====================================================================
// 강의실 예약(사전확보·대관) - 시트 '강의실예약'(없으면 처음 저장할 때 자동 생성, 1행·A열 비움)
// - 사전확보: 과정(개설키)은 있고 교과목은 아직 없는 상태에서 강의실을 미리 잡아 둠
// - 대관: 과정·교과목 없이 사유·사용 부서만으로 예약
// - 여러 날 예약은 날짜별로 한 줄씩 저장. 반복 예약 없음. 겹침은 막지 않고 경고만
// - 상태: 예약 / 취소 / 전환됨. 교과목 편성이 사전확보 예약 구간에 들어오면 그 구간만 '전환됨'으로 바뀌고(전환편성ID 기록),
//   편성을 지우거나 일자·교시·강의실·과정을 바꿔 구간을 벗어나면 '예약'으로 되살림
// =====================================================================
var RESERVE_SHEET = '강의실예약';
var RESERVE_HEADERS = ['예약ID', '유형', '일자', '시작교시', '끝교시', '강의실', '개설키', '사유·사용부서', '담당자·연락처',
  '상태', '전환편성ID', '비고', '등록자', '등록일시', '수정일시'];
var RESERVE_NUMBER_COLS = ['시작교시', '끝교시'];
var RESERVE_TYPES = ['사전확보', '대관'];
var RESERVE_MAX_DATES = 62;

function ensureReserveSheet(ss) {
  var sheet = ss.getSheetByName(RESERVE_SHEET);
  if (!sheet) sheet = ss.insertSheet(RESERVE_SHEET);
  var headRange = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, 1, RESERVE_HEADERS.length);
  var cur = headRange.getValues()[0];
  if (cur.every(function(v){ return String(v) === ''; })) {
    headRange.setValues([RESERVE_HEADERS]);
    var rows = 2000;
    ensureSheetRows(sheet, ASSIGN_HEADER_ROW + rows);
    var fmts = RESERVE_HEADERS.map(function(h){ return RESERVE_NUMBER_COLS.indexOf(h) > -1 ? '0' : '@'; });
    var f = [];
    for (var i = 0; i < rows; i++) f.push(fmts);
    sheet.getRange(ASSIGN_HEADER_ROW + 1, ASSIGN_FIRST_COL, rows, RESERVE_HEADERS.length).setNumberFormats(f);
  }
  return sheet;
}

function reserveColMap(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), ASSIGN_FIRST_COL + RESERVE_HEADERS.length - 1);
  var headers = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, 1, lastCol - ASSIGN_FIRST_COL + 1).getValues()[0].map(assignHeaderKey);
  var map = {};
  headers.forEach(function(h, idx){ if (h) map[h] = idx; });
  return { width: headers.length, map: map };
}

function reserveRowArray(cm, values) {
  var arr = [];
  for (var i = 0; i < cm.width; i++) arr.push('');
  RESERVE_HEADERS.forEach(function(h){ if (cm.map[h] !== undefined) arr[cm.map[h]] = values[h] == null ? '' : values[h]; });
  return arr;
}

function reserveActiveRows(ss) {
  var t = readAssignTable(ss, RESERVE_SHEET);
  return t.rows.filter(function(r){ return String(r['상태']) === '예약'; });
}

function reserveNewId(used, seq) {
  var id;
  do {
    id = 'R' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss') + '-' + ('00' + (seq++)).slice(-3) + Math.floor(Math.random() * 10);
  } while (used[id]);
  used[id] = true;
  return { id: id, seq: seq };
}

function reservePeriodText(s, e) { return Number(s) === Number(e) ? s + '교시' : s + '~' + e + '교시'; }

function reserveLogEntry(type, row, before, after) {
  var item = String(row['유형'] || '') + ' · ' + String(row['강의실'] || '');
  return { 일시: nowStamp(), 개설키: String(row['개설키'] || ''), 유형: type, 항목: item, 전: before, 후: after, 사유: String(row['사유·사용부서'] || ''), 역할: '관리자' };
}

function listReservations(params) {
  if (!checkReadAccess(params.password)) return jsonError('인증이 필요합니다');
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var rows = reserveActiveRows(ss);
  rows.forEach(function(r){ delete r._row; });
  return jsonOut({ status: 'ok', count: rows.length, data: rows });
}

// ---------- 빈 교시 '비워둠' 처리 ----------
var GAP_SHEET = '빈교시확인';
var GAP_HEADERS = ['개설키', '일자', '교시', '상태', '처리일시', '사유'];

function ensureGapSheet(ss) {
  var sheet = ss.getSheetByName(GAP_SHEET);
  if (!sheet) sheet = ss.insertSheet(GAP_SHEET);
  var headRange = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, 1, GAP_HEADERS.length);
  var cur = headRange.getValues()[0];
  if (cur.every(function(v){ return String(v) === ''; })) {
    headRange.setValues([GAP_HEADERS]);
    ensureSheetRows(sheet, ASSIGN_HEADER_ROW + 2000);
    sheet.getRange(ASSIGN_HEADER_ROW + 1, ASSIGN_FIRST_COL, 2000, GAP_HEADERS.length).setNumberFormat('@');
  } else if (String(cur[5]) === '') {
    // 이전 버전 시트(사유 열 없음)에 사유 열 추가
    sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL + 5).setValue('사유');
    sheet.getRange(ASSIGN_HEADER_ROW + 1, ASSIGN_FIRST_COL + 5, 2000, 1).setNumberFormat('@');
  }
  return sheet;
}

function gapActiveRows(ss) {
  if (!ss.getSheetByName(GAP_SHEET)) return [];
  return readAssignTable(ss, GAP_SHEET).rows.filter(function(r){ return String(r['상태']) === '처리'; })
    .map(function(r){ return { 개설키: String(r['개설키']), 일자: String(r['일자']), 교시: Number(r['교시']), 사유: String(r['사유'] || ''), 처리일시: String(r['처리일시'] || '') }; });
}

// 항목: [{개설키, 일자, 교시}], 처리: true(기본)=비워둠 처리, false=처리 취소, 사유: 선택(처리할 때만)
function markGaps(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var items = params.항목 || [];
  if (!items.length) return jsonError('처리할 항목이 없습니다');
  if (items.length > 400) return jsonError('한 번에 400칸까지 처리할 수 있습니다');
  var on = params.처리 !== false;
  var reason = cleanText(params.사유, 100);
  var sheet = ensureGapSheet(ss);
  var rows = readAssignTable(ss, GAP_SHEET).rows;
  var idx = {};
  rows.forEach(function(r){ idx[String(r['개설키']) + '|' + String(r['일자']) + '|' + Number(r['교시'])] = r; });
  var cm = {}; GAP_HEADERS.forEach(function(h, i){ cm[h] = i; });
  var now = nowStamp(), add = [], changed = 0;
  items.forEach(function(it){
    var key = cleanText(it.개설키, 200), d = String(it.일자 || ''), n = Number(it.교시);
    if (!key || !isValidDateStr(d) || !isFinite(n) || n < 1) return;
    var k = key + '|' + d + '|' + n, ex = idx[k];
    if (ex) {
      var want = on ? '처리' : '해제';
      if (String(ex['상태']) !== want || (on && reason && String(ex['사유'] || '') !== reason)) {
        sheet.getRange(ex._row, ASSIGN_FIRST_COL + cm['상태']).setValue(want);
        sheet.getRange(ex._row, ASSIGN_FIRST_COL + cm['처리일시']).setValue(now);
        if (on) sheet.getRange(ex._row, ASSIGN_FIRST_COL + cm['사유']).setValue(reason);
        ex['상태'] = want; changed++;
      }
    } else if (on) {
      add.push([key, d, n, '처리', now, reason]); idx[k] = { 상태: '처리' }; changed++;
    }
  });
  if (add.length) {
    var start = Math.max(sheet.getLastRow() + 1, ASSIGN_HEADER_ROW + 1);
    ensureSheetRows(sheet, start + add.length);
    sheet.getRange(start, ASSIGN_FIRST_COL, add.length, GAP_HEADERS.length).setNumberFormat('@');
    sheet.getRange(start, ASSIGN_FIRST_COL, add.length, GAP_HEADERS.length).setValues(add);
  }
  if (changed) try {
    var first = items[0] || {};
    appendPlanHistory(ss, [{ 일시: now, 개설키: cleanText(first.개설키, 200), 유형: on ? '빈 교시 비워둠 처리' : '빈 교시 처리 취소', 항목: '빈 교시', 전: '', 후: changed + '칸' + (on ? ' 비워둠 처리' : ' 처리 취소') + (on && reason ? ' · 사유: ' + reason : ''), 사유: on ? reason : '', 역할: '관리자' }]);
  } catch (err) { Logger.log('빈 교시 이력 오류: ' + err); }
  return jsonOut({ status: 'ok', count: changed, data: gapActiveRows(ss) });
}

// 예약 추가(일자들 배열 또는 일자 1개) 또는 수정(예약ID 지정, 날짜 1개)
function saveReservation(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();

  var type = cleanText(params.유형, 10);
  if (RESERVE_TYPES.indexOf(type) === -1) return jsonError('유형은 사전확보 또는 대관이어야 합니다');
  var room = cleanText(params.강의실, 100);
  if (!room) return jsonError('강의실을 선택해 주세요');
  var startP = Number(params.시작교시), endP = Number(params.끝교시);
  if (!isFinite(startP) || !isFinite(endP) || startP % 1 !== 0 || endP % 1 !== 0 || startP < 1 || endP < 1) return jsonError('시작교시와 끝교시는 1 이상의 정수여야 합니다');
  if (startP > endP) return jsonError('시작교시가 끝교시보다 클 수 없습니다');

  var dates = [];
  var rawDates = (params.일자들 && params.일자들.length) ? params.일자들 : (params.일자 ? [params.일자] : []);
  for (var di = 0; di < rawDates.length; di++) {
    var d = cleanText(rawDates[di], 10);
    if (!isValidDateStr(d)) return jsonError('일자는 yyyy-MM-dd 형식이어야 합니다: ' + d);
    if (dates.indexOf(d) === -1) dates.push(d);
  }
  if (!dates.length) return jsonError('일자를 선택해 주세요');
  if (dates.length > RESERVE_MAX_DATES) return jsonError('한 번에 예약할 수 있는 날짜는 최대 ' + RESERVE_MAX_DATES + '일입니다');
  dates.sort();

  var key = cleanText(params.개설키, 200);
  var reason = cleanText(params.사유, 200);
  if (type === '사전확보') {
    if (!key) return jsonError('사전확보는 과정(개설키)을 선택해 주세요');
    var plan = readAssignTable(ss, '연간계획').rows.filter(function(r){ return String(r['과정+기수']) === key; });
    if (!plan.length) return jsonError('연간계획에 없는 개설키입니다: ' + key);
    if (isPlanCancelled(plan[0])) return jsonError('취소된 기수에는 사전확보를 할 수 없습니다');
  } else {
    key = '';
    if (!reason) return jsonError('대관은 사유·사용 부서를 입력해 주세요');
  }

  var warnings = [];
  var rooms = readAssignTable(ss, '강의실').rows.map(function(r){ return String(r['강의실명']); });
  if (rooms.length && rooms.indexOf(room) === -1) warnings.push('강의실 목록에 없는 이름입니다');
  var periods = readAssignTable(ss, '교시표').rows.map(function(r){ return Number(r['교시']); }).filter(function(n){ return isFinite(n); });
  if (periods.length && (periods.indexOf(startP) === -1 || periods.indexOf(endP) === -1)) warnings.push('교시표에 없는 교시입니다');

  var sheet = ensureReserveSheet(ss);
  var cm = reserveColMap(sheet);
  var allRows = readAssignTable(ss, RESERVE_SHEET).rows;
  var editId = cleanText(params.예약ID, 60);
  var now = nowStamp();

  // 겹침 경고(저장은 허용): 같은 강의실·날짜·교시의 기존 편성·다른 예약
  var clash = {};
  readAssignTable(ss, SESSION_SHEET).rows.forEach(function(r){
    if (String(r['강의실'] || '') !== room || dates.indexOf(String(r['일자'])) === -1) return;
    if (Number(r['시작교시']) <= endP && startP <= Number(r['끝교시'])) clash[String(r['일자'])] = '편성';
  });
  allRows.forEach(function(r){
    if (String(r['상태']) !== '예약' || String(r['예약ID']) === editId) return;
    if (String(r['강의실'] || '') !== room || dates.indexOf(String(r['일자'])) === -1) return;
    if (Number(r['시작교시']) <= endP && startP <= Number(r['끝교시'])) clash[String(r['일자'])] = clash[String(r['일자'])] || '예약';
  });
  var clashDays = Object.keys(clash).sort();
  if (clashDays.length) warnings.push('같은 강의실·교시에 이미 편성 또는 예약이 있는 날: ' + clashDays.slice(0, 5).join(', ') + (clashDays.length > 5 ? ' 외 ' + (clashDays.length - 5) + '일' : ''));

  var hist = [];
  var values = function(date, id, existing) {
    return {
      '예약ID': id, '유형': type, '일자': date, '시작교시': startP, '끝교시': endP, '강의실': room, '개설키': key,
      '사유·사용부서': reason, '담당자·연락처': cleanText(params.연락처, 100), '상태': '예약', '전환편성ID': '',
      '비고': cleanText(params.비고, 200), '등록자': existing ? String(existing['등록자'] || '관리자') : '관리자',
      '등록일시': existing ? String(existing['등록일시'] || now) : now, '수정일시': now
    };
  };

  if (editId) {
    var found = allRows.filter(function(r){ return String(r['예약ID']) === editId; });
    if (!found.length) return jsonError('예약을 찾을 수 없습니다');
    var old = found[0];
    if (String(old['상태']) !== '예약') return jsonError('이미 취소되었거나 편성으로 전환된 예약은 수정할 수 없습니다');
    if (dates.length !== 1) return jsonError('수정할 때는 날짜를 하나만 지정할 수 있습니다');
    var nv = values(dates[0], editId, old);
    var rg = sheet.getRange(old._row, ASSIGN_FIRST_COL, 1, cm.width);
    rg.setNumberFormats([reserveRowArray(cm, {}).map(function(_, i){ return '@'; })]);
    rg.setValues([reserveRowArray(cm, nv)]);
    try {
      var before = String(old['일자']) + ' ' + reservePeriodText(old['시작교시'], old['끝교시']) + ' · ' + String(old['강의실']);
      hist.push(reserveLogEntry('강의실 예약 수정', nv, before, dates[0] + ' ' + reservePeriodText(startP, endP) + ' · ' + room));
      appendPlanHistory(ss, hist);
    } catch (err) { Logger.log('예약 이력 기록 오류: ' + err); }
    return jsonOut({ status: 'ok', 신규: false, 예약ID: editId, count: 1, warnings: warnings });
  }

  var used = {};
  allRows.forEach(function(r){ used[String(r['예약ID'])] = true; });
  var seq = 1, out = [], created = [];
  dates.forEach(function(date) {
    var nid = reserveNewId(used, seq); seq = nid.seq;
    var v = values(date, nid.id, null);
    created.push(v);
    out.push(reserveRowArray(cm, v));
  });
  var startRow = Math.max(sheet.getLastRow(), ASSIGN_HEADER_ROW) + 1;
  ensureSheetRows(sheet, startRow + out.length);
  var wr = sheet.getRange(startRow, ASSIGN_FIRST_COL, out.length, cm.width);
  var fm = [];
  out.forEach(function(){ fm.push(RESERVE_HEADERS.length ? reserveRowArray(cm, {}).map(function(_, i){ return '@'; }) : []); });
  wr.setNumberFormats(fm);
  wr.setValues(out);
  // 교시 열은 숫자로 보이도록 다시 지정
  RESERVE_NUMBER_COLS.forEach(function(h){ if (cm.map[h] !== undefined) sheet.getRange(startRow, ASSIGN_FIRST_COL + cm.map[h], out.length, 1).setNumberFormat('0'); });
  try {
    var dText = dates.length === 1 ? dates[0] : '날짜 ' + dates.length + '일(' + dates[0] + '~' + dates[dates.length - 1] + ')';
    hist.push(reserveLogEntry('강의실 예약 추가', created[0], '', dText + ' ' + reservePeriodText(startP, endP) + ' · ' + room));
    appendPlanHistory(ss, hist);
  } catch (err) { Logger.log('예약 이력 기록 오류: ' + err); }
  return jsonOut({ status: 'ok', 신규: true, count: created.length, data: created, warnings: warnings });
}

// 예약 취소(예약ID 하나 또는 예약IDs 배열). '예약' 상태만 취소됨
function cancelReservation(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var ids = (params.예약IDs && params.예약IDs.length) ? params.예약IDs : (params.예약ID ? [params.예약ID] : []);
  ids = ids.map(function(x){ return cleanText(x, 60); }).filter(Boolean);
  if (!ids.length) return jsonError('예약ID가 필요합니다');
  var sheet = ensureReserveSheet(ss);
  var cm = reserveColMap(sheet);
  var rows = readAssignTable(ss, RESERVE_SHEET).rows;
  var now = nowStamp(), n = 0, hist = [];
  rows.forEach(function(r){
    if (ids.indexOf(String(r['예약ID'])) === -1 || String(r['상태']) !== '예약') return;
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['상태']).setValue('취소');
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['수정일시']).setValue(now);
    n++;
    hist.push(reserveLogEntry('강의실 예약 취소', r, String(r['일자']) + ' ' + reservePeriodText(r['시작교시'], r['끝교시']), '취소'));
  });
  if (!n) return jsonError('취소할 예약을 찾지 못했습니다(이미 취소되었거나 편성으로 전환된 예약일 수 있습니다)');
  try { appendPlanHistory(ss, hist.length > 3 ? [reserveLogEntry('강의실 예약 취소', { 유형: hist.length + '건', 강의실: '', 개설키: '' }, '', '취소')] : hist); } catch (err) { Logger.log('예약 취소 이력 기록 오류: ' + err); }
  return jsonOut({ status: 'ok', count: n });
}

// 편성(sessionId)이 가져갔던 예약 구간을 '예약'으로 되돌림
function reserveRestoreForSession(ss, sessionId, hist) {
  var t = readAssignTable(ss, RESERVE_SHEET);
  if (t.missing) return 0;
  var sheet = ss.getSheetByName(RESERVE_SHEET), cm = reserveColMap(sheet), now = nowStamp(), n = 0;
  t.rows.forEach(function(r){
    if (String(r['상태']) !== '전환됨' || String(r['전환편성ID']) !== sessionId) return;
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['상태']).setValue('예약');
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['전환편성ID']).setValue('');
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['수정일시']).setValue(now);
    n++;
    hist.push(reserveLogEntry('강의실 예약 복구', r, '편성으로 전환됨', String(r['일자']) + ' ' + reservePeriodText(r['시작교시'], r['끝교시']) + ' 예약으로 되돌림'));
  });
  return n;
}

// 편성(같은 과정·강의실·일자, 교시가 겹침)이 사전확보 예약 위에 들어오면 겹친 구간만 '전환됨'으로 바꾸고 남는 구간은 예약으로 나눠 둠
function reserveConvertForSession(ss, sessionId, key, dateStr, room, s, e, subject, hist) {
  if (!room) return 0;
  var t = readAssignTable(ss, RESERVE_SHEET);
  if (t.missing) return 0;
  var sheet = ss.getSheetByName(RESERVE_SHEET), cm = reserveColMap(sheet), now = nowStamp(), n = 0;
  var used = {};
  t.rows.forEach(function(r){ used[String(r['예약ID'])] = true; });
  var seq = 1, extra = [];
  t.rows.forEach(function(r){
    if (String(r['상태']) !== '예약' || String(r['유형']) !== '사전확보') return;
    if (String(r['개설키']) !== key || String(r['일자']) !== dateStr || String(r['강의실']) !== room) return;
    var rs = Number(r['시작교시']), re = Number(r['끝교시']);
    if (rs > e || s > re) return;
    var os = Math.max(rs, s), oe = Math.min(re, e);
    function addPart(ps, pe) {
      var nid = reserveNewId(used, seq); seq = nid.seq;
      var v = {}; RESERVE_HEADERS.forEach(function(h){ v[h] = r[h] == null ? '' : r[h]; });
      v['예약ID'] = nid.id; v['시작교시'] = ps; v['끝교시'] = pe; v['상태'] = '예약'; v['전환편성ID'] = ''; v['수정일시'] = now;
      extra.push(reserveRowArray(cm, v));
    }
    if (rs < os) addPart(rs, os - 1);
    if (oe < re) addPart(oe + 1, re);
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['시작교시']).setValue(os);
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['끝교시']).setValue(oe);
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['상태']).setValue('전환됨');
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['전환편성ID']).setValue(sessionId);
    sheet.getRange(r._row, ASSIGN_FIRST_COL + cm.map['수정일시']).setValue(now);
    n++;
    hist.push(reserveLogEntry('강의실 예약 전환', r, '예약 ' + reservePeriodText(rs, re), '편성 ' + reservePeriodText(os, oe) + (subject ? ' (' + subject + ')' : '') + '으로 전환'));
  });
  if (extra.length) {
    var startRow = Math.max(sheet.getLastRow(), ASSIGN_HEADER_ROW) + 1;
    ensureSheetRows(sheet, startRow + extra.length);
    var rg = sheet.getRange(startRow, ASSIGN_FIRST_COL, extra.length, cm.width);
    rg.setNumberFormats(extra.map(function(){ return reserveRowArray(cm, {}).map(function(){ return '@'; }); }));
    rg.setValues(extra);
    RESERVE_NUMBER_COLS.forEach(function(h){ if (cm.map[h] !== undefined) sheet.getRange(startRow, ASSIGN_FIRST_COL + cm.map[h], extra.length, 1).setNumberFormat('0'); });
  }
  return n;
}

// =====================================================================
// 연간계획 변경: 날짜 변경(월 이동 포함)·기수 취소·취소 해제
// - 연간계획 시트에서는 입교·사이버·실습 날짜 칸과 '상태' 열만 고침(다른 열·수식은 건드리지 않음)
// - 날짜를 바꾸면 기수 수식 때문에 번호(개설키)가 바뀔 수 있어, 첫 변경 때 기수 열을 값으로 고정
// - 모든 변경은 '변경이력' 시트에 한 줄씩 기록
// =====================================================================
var PLAN_SHEET = '연간계획';
var PLAN_STATUS_HEADER = '상태';
var PLAN_STATUS_CANCELLED = '취소됨';
var PLAN_DATE_FIELDS = ['입교 시작일', '입교 종료일', '사이버 시작일', '사이버 종료일', '실습(외부) 시작일', '실습(외부) 종료일'];
var HISTORY_SHEET = '변경이력';
var HISTORY_FIELDS = [
  { key: '일시', name: '변경일시', alias: ['변경일시', '변경 일시', '일시', '변경일', '입력일시'] },
  { key: '개설키', name: '개설키', alias: ['개설키', '과정+기수', '과정·기수', '과정기수'] },
  { key: '유형', name: '유형', alias: ['유형', '변경 유형', '변경유형'] },
  { key: '항목', name: '항목', alias: ['항목', '변경 항목', '변경항목'] },
  { key: '전', name: '변경 전', alias: ['변경 전', '변경전'] },
  { key: '후', name: '변경 후', alias: ['변경 후', '변경후'] },
  { key: '사유', name: '사유', alias: ['사유', '변경 사유', '변경사유'] },
  { key: '역할', name: '입력 역할', alias: ['입력 역할', '입력자', '입력 담당'] }
];

function isPlanCancelled(row) {
  var v = String(row[PLAN_STATUS_HEADER] == null ? '' : row[PLAN_STATUS_HEADER]).replace(/\s+/g, '');
  return v === '취소됨' || v === '취소';
}

function planHeaderCols(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), ASSIGN_FIRST_COL);
  var headers = sheet.getRange(ASSIGN_HEADER_ROW, ASSIGN_FIRST_COL, 1, lastCol - ASSIGN_FIRST_COL + 1).getValues()[0].map(assignHeaderKey);
  var map = {};
  headers.forEach(function(h, i){ if (h && map[h] === undefined) map[h] = ASSIGN_FIRST_COL + i; });
  var last = ASSIGN_FIRST_COL - 1;
  headers.forEach(function(h, i){ if (h) last = ASSIGN_FIRST_COL + i; });
  return { map: map, last: last };
}

// 머리글 오른쪽 끝에 열 하나 추가(없을 때만). 서식은 바로 왼쪽 머리글을 따름.
function appendHeaderCol(sheet, name) {
  var hc = planHeaderCols(sheet);
  var col = hc.last + 1;
  if (sheet.getMaxColumns && sheet.getMaxColumns() < col && sheet.insertColumnsAfter) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
  }
  var cell = sheet.getRange(ASSIGN_HEADER_ROW, col);
  cell.setValue(name);
  try {
    if (hc.last >= ASSIGN_FIRST_COL) {
      sheet.getRange(ASSIGN_HEADER_ROW, hc.last).copyTo(cell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    }
  } catch (e) { Logger.log('머리글 서식 복사 실패: ' + e); }
  return col;
}

function ensurePlanStatusCol(sheet) {
  var hc = planHeaderCols(sheet);
  if (hc.map[PLAN_STATUS_HEADER] !== undefined) return hc.map[PLAN_STATUS_HEADER];
  var col = appendHeaderCol(sheet, PLAN_STATUS_HEADER);
  try {
    var rows = Math.max(sheet.getMaxRows() - ASSIGN_HEADER_ROW, 1);
    var rule = SpreadsheetApp.newDataValidation().requireValueInList([PLAN_STATUS_CANCELLED], true).setAllowInvalid(true).build();
    sheet.getRange(ASSIGN_HEADER_ROW + 1, col, rows, 1).setDataValidation(rule);
  } catch (e) { Logger.log('상태 열 드롭다운 설정 실패: ' + e); }
  return col;
}

// 변경이력 시트: 없으면 만들고, 필요한 열이 없으면 오른쪽 끝에 추가. 이미 있는 비슷한 이름의 열은 그대로 사용.
function ensureHistorySheet(ss) {
  var sheet = ss.getSheetByName(HISTORY_SHEET);
  if (!sheet) sheet = ss.insertSheet(HISTORY_SHEET);
  var hc = planHeaderCols(sheet);
  var colOf = {};
  HISTORY_FIELDS.forEach(function(f){
    for (var i = 0; i < f.alias.length; i++) {
      if (hc.map[f.alias[i]] !== undefined) { colOf[f.key] = hc.map[f.alias[i]]; break; }
    }
  });
  HISTORY_FIELDS.forEach(function(f){
    if (colOf[f.key] === undefined) {
      colOf[f.key] = appendHeaderCol(sheet, f.name);
    }
  });
  return { sheet: sheet, colOf: colOf };
}

function appendPlanHistory(ss, entries) {
  if (!entries.length) return;
  var h = ensureHistorySheet(ss);
  var sheet = h.sheet;
  var maxCol = 0;
  HISTORY_FIELDS.forEach(function(f){ if (h.colOf[f.key] > maxCol) maxCol = h.colOf[f.key]; });
  var width = maxCol - ASSIGN_FIRST_COL + 1;
  var rowNum = Math.max(sheet.getLastRow(), ASSIGN_HEADER_ROW) + 1;
  ensureSheetRows(sheet, rowNum + entries.length);
  entries.forEach(function(e, idx){
    var arr = [], fm = [];
    for (var i = 0; i < width; i++) { arr.push(''); fm.push('@'); }
    HISTORY_FIELDS.forEach(function(f){ arr[h.colOf[f.key] - ASSIGN_FIRST_COL] = e[f.key] == null ? '' : String(e[f.key]); });
    var range = sheet.getRange(rowNum + idx, ASSIGN_FIRST_COL, 1, width);
    // 이미 있는 값 칸 중 빈 칸만 덮어쓰도록 기존 값을 읽어 병합(사용자가 둔 다른 열 보존)
    var cur = range.getValues()[0];
    for (var j = 0; j < width; j++) {
      var mine = false;
      HISTORY_FIELDS.forEach(function(f){ if (h.colOf[f.key] - ASSIGN_FIRST_COL === j) mine = true; });
      if (!mine) arr[j] = cur[j];
    }
    try { range.clearDataValidations(); } catch (e) { Logger.log('변경이력 입력 규칙 해제 실패: ' + e); }
    range.setNumberFormats([fm]);
    range.setValues([arr]);
  });
}

// 변경이력을 화면용으로 읽음(시트가 없으면 빈 목록). 열 이름은 별칭으로 인식.
function readPlanHistory(ss) {
  var sheet = ss.getSheetByName(HISTORY_SHEET);
  if (!sheet) return [];
  var t = readAssignTable(ss, HISTORY_SHEET);
  var out = [];
  t.rows.forEach(function(r){
    var o = {};
    HISTORY_FIELDS.forEach(function(f){
      for (var i = 0; i < f.alias.length; i++) {
        if (r[f.alias[i]] !== undefined) { o[f.key] = String(r[f.alias[i]]); break; }
      }
      if (o[f.key] === undefined) o[f.key] = '';
    });
    if (o['개설키'] && o['유형']) out.push(o);
  });
  return out.slice(-2000);
}

function parseSheetDate(str, tz) {
  return Utilities.parseDate(str, tz, 'yyyy-MM-dd');
}

// 기수 열의 수식을 값으로 고정. 과정명·입교 시작일이 있는 줄만 대상. 고정한 줄 수를 돌려줌.
function freezeSeqColumn(sheet, cols, tz) {
  var seqCol = cols.map['기수'], nameCol = cols.map['과정명'], startCol = cols.map['입교 시작일'];
  if (!seqCol || !nameCol || !startCol) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow <= ASSIGN_HEADER_ROW) return 0;
  var n = lastRow - ASSIGN_HEADER_ROW;
  var seqRange = sheet.getRange(ASSIGN_HEADER_ROW + 1, seqCol, n, 1);
  var formulas = seqRange.getFormulas();
  var vals = seqRange.getValues();
  var names = sheet.getRange(ASSIGN_HEADER_ROW + 1, nameCol, n, 1).getValues();
  var starts = sheet.getRange(ASSIGN_HEADER_ROW + 1, startCol, n, 1).getValues();
  var count = 0;
  for (var i = 0; i < n; i++) {
    var f = String(formulas[i][0] || '');
    if (f.charAt(0) !== '=') continue;
    if (String(names[i][0]) === '' || String(starts[i][0]) === '') continue;
    sheet.getRange(ASSIGN_HEADER_ROW + 1 + i, seqCol).setValue(vals[i][0]);
    count++;
  }
  if (count) SpreadsheetApp.flush();
  return count;
}

function updatePlan(params) {
  try {
    return updatePlanCore(params);
  } catch (err) {
    Logger.log('updatePlan 오류: ' + err + (err && err.stack ? ' ' + err.stack : ''));
    return jsonError('연간계획 변경 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
  }
}

function safeAppendHistory(ss, entries, doneText) {
  try {
    appendPlanHistory(ss, entries);
    return null;
  } catch (err) {
    Logger.log('변경이력 기록 오류: ' + err + (err && err.stack ? ' ' + err.stack : ''));
    return jsonError(doneText + ' 그러나 변경이력 시트에 기록하지 못했습니다: ' + (err && err.message ? err.message : err));
  }
}

function updatePlanCore(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();
  var sheet = ss.getSheetByName(PLAN_SHEET);
  if (!sheet) return jsonError('연간계획 시트를 찾을 수 없습니다');

  var key = cleanText(params.개설키, 200);
  if (!key) return jsonError('개설키(과정+기수)가 필요합니다');
  var kind = cleanText(params.종류, 20);
  if (['dates', 'cancel', 'restore'].indexOf(kind) === -1) return jsonError('변경 종류가 올바르지 않습니다');
  var reason = cleanText(params.사유, 200);
  if (!reason) return jsonError('사유를 입력해 주세요');

  var tz = ss.getSpreadsheetTimeZone();
  var table = readAssignTable(ss, PLAN_SHEET);
  var matches = table.rows.filter(function(r){ return String(r['과정명']) !== '' && String(r['과정+기수']) === key; });
  if (matches.length === 0) return jsonError('연간계획에 없는 개설키입니다: ' + key);
  if (matches.length > 1) return jsonError('같은 과정+기수가 여러 줄 있어 변경할 수 없습니다. 시트에서 중복을 먼저 정리해 주세요.');
  var row = matches[0];
  var rowNum = row._row;
  var cancelled = isPlanCancelled(row);
  var cols = planHeaderCols(sheet);
  var history = [];
  var stamp = nowStamp();
  var role = '관리자';

  function addHist(type, item, before, after) {
    history.push({ 일시: stamp, 개설키: key, 유형: type, 항목: item, 전: before, 후: after, 사유: reason, 역할: role });
  }

  if (kind === 'cancel' || kind === 'restore') {
    if (kind === 'cancel' && cancelled) return jsonError('이미 취소된 기수입니다');
    if (kind === 'restore' && !cancelled) return jsonError('취소된 기수가 아닙니다');
    var stCol = ensurePlanStatusCol(sheet);
    sheet.getRange(rowNum, stCol).setValue(kind === 'cancel' ? PLAN_STATUS_CANCELLED : '');
    addHist(kind === 'cancel' ? '기수 취소' : '취소 해제', '상태', kind === 'cancel' ? '(진행)' : PLAN_STATUS_CANCELLED, kind === 'cancel' ? PLAN_STATUS_CANCELLED : '(진행)');
    var herr1 = safeAppendHistory(ss, history, '상태는 이미 ' + (kind === 'cancel' ? '취소됨으로 바뀌었습니다.' : '진행으로 바뀌었습니다.'));
    if (herr1) return herr1;
    return jsonOut({ status: 'ok', 종류: kind, 개설키: key, 상태: kind === 'cancel' ? PLAN_STATUS_CANCELLED : '' });
  }

  // 날짜 변경
  if (cancelled) return jsonError('취소된 기수는 날짜를 변경할 수 없습니다. 먼저 취소를 해제해 주세요.');
  var changes = [];
  var newVals = {};
  PLAN_DATE_FIELDS.forEach(function(f){
    if (params[f] === undefined || params[f] === null) return;
    newVals[f] = cleanText(params[f], 10);
  });
  var startNew = newVals['입교 시작일'] !== undefined ? newVals['입교 시작일'] : String(row['입교 시작일'] || '');
  var endNew = newVals['입교 종료일'] !== undefined ? newVals['입교 종료일'] : String(row['입교 종료일'] || '');
  if (!isValidDateStr(startNew) || !isValidDateStr(endNew)) return jsonError('입교 시작일과 종료일은 yyyy-MM-dd 형식으로 입력해 주세요');
  if (startNew > endNew) return jsonError('입교 종료일이 시작일보다 빠릅니다');
  var pairs = [['사이버 시작일', '사이버 종료일'], ['실습(외부) 시작일', '실습(외부) 종료일']];
  for (var pi = 0; pi < pairs.length; pi++) {
    var a = newVals[pairs[pi][0]] !== undefined ? newVals[pairs[pi][0]] : String(row[pairs[pi][0]] || '');
    var b = newVals[pairs[pi][1]] !== undefined ? newVals[pairs[pi][1]] : String(row[pairs[pi][1]] || '');
    if ((a === '') !== (b === '')) return jsonError(pairs[pi][0].replace(' 시작일', '') + ' 시작일과 종료일은 함께 입력하거나 함께 비워야 합니다');
    if (a !== '' && (!isValidDateStr(a) || !isValidDateStr(b))) return jsonError(pairs[pi][0].replace(' 시작일', '') + ' 날짜는 yyyy-MM-dd 형식이어야 합니다');
    if (a !== '' && a > b) return jsonError(pairs[pi][0].replace(' 시작일', '') + ' 종료일이 시작일보다 빠릅니다');
  }
  // 화면이 본 값과 시트 값이 다르면 중단(다른 사람이 그사이 고친 경우)
  var expect = params.기존 || {};
  for (var ei = 0; ei < PLAN_DATE_FIELDS.length; ei++) {
    var ef = PLAN_DATE_FIELDS[ei];
    if (expect[ef] !== undefined && String(expect[ef]) !== String(row[ef] || '')) {
      return jsonError('시트의 날짜가 화면과 다릅니다(다른 곳에서 먼저 변경됨). 새로고침 후 다시 시도해 주세요.');
    }
  }
  PLAN_DATE_FIELDS.forEach(function(f){
    var cur = String(row[f] || '');
    var nv = newVals[f] !== undefined ? newVals[f] : cur;
    if (f === '입교 시작일') nv = startNew;
    if (f === '입교 종료일') nv = endNew;
    if (nv !== cur) {
      if (cols.map[f] === undefined) return;
      changes.push({ f: f, before: cur, after: nv });
    }
  });
  if (changes.length === 0) return jsonError('변경된 날짜가 없습니다');

  // 기수 번호가 날짜에 따라 바뀌지 않도록 먼저 값으로 고정
  var frozen = freezeSeqColumn(sheet, cols, tz);
  var oldKey = key;
  changes.forEach(function(c){
    var cell = sheet.getRange(rowNum, cols.map[c.f]);
    if (c.after === '') cell.clearContent(); else cell.setValue(parseSheetDate(c.after, tz));
  });
  SpreadsheetApp.flush();
  // 안전 확인: 과정+기수가 그대로여야 함. 달라졌으면 원래 날짜로 되돌림
  var keyCol = cols.map['과정+기수'];
  var nowKey = keyCol ? String(sheet.getRange(rowNum, keyCol).getValue()) : oldKey;
  if (nowKey !== oldKey) {
    changes.forEach(function(c){
      var cell = sheet.getRange(rowNum, cols.map[c.f]);
      if (c.before === '') cell.clearContent(); else cell.setValue(parseSheetDate(c.before, tz));
    });
    SpreadsheetApp.flush();
    return jsonError('날짜를 바꾸면 기수 번호(과정+기수)가 달라져 변경을 취소했습니다. 시트의 기수 열을 확인해 주세요.');
  }
  if (frozen) addHist('시스템', '기수 열', '수식', '값으로 고정(' + frozen + '줄)');
  changes.forEach(function(c){ addHist('일정 변경', c.f, c.before, c.after); });
  var herr2 = safeAppendHistory(ss, history, '날짜는 이미 변경되었습니다(시트에서 확인).');
  if (herr2) return herr2;

  var sessions = readSessions(ss, key);
  return jsonOut({ status: 'ok', 종류: 'dates', 개설키: key, 변경: changes.map(function(c){ return { 항목: c.f, 전: c.before, 후: c.after }; }),
    기수고정: frozen, 편성수: sessions.length });
}

// =====================================================================
// 겹침 경고 확인 처리: 화면이 계산한 겹침(서명)을 "확인했음"으로 기록하거나 취소
// - 겹침 자체는 화면에서 계산하며, 확인 내역은 '변경이력' 시트에만 한 줄씩 남김(별도 열·시트 추가 없음)
// - 서명에 포함된 편성(날짜·교시·강사·강의실)이 바뀌면 서명이 달라져 확인은 자동으로 무효가 됨
// - 최신 기록이 우선: '겹침 확인' 다음에 '겹침 확인 해제'가 있으면 미확인
// =====================================================================
var CONFLICT_SIG_RE = /^ov-[a-z]-[0-9a-f]{1,8}-[0-9a-f]{1,8}$/;

function confirmConflict(params) {
  try {
    return confirmConflictCore(params);
  } catch (err) {
    Logger.log('confirmConflict 오류: ' + err + (err && err.stack ? ' ' + err.stack : ''));
    return jsonError('겹침 확인 처리 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
  }
}

function confirmConflictCore(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();

  var kind = cleanText(params.종류, 20);
  if (['confirm', 'unconfirm'].indexOf(kind) === -1) return jsonError('처리 종류가 올바르지 않습니다');
  var sig = cleanText(params.서명, 80);
  if (!CONFLICT_SIG_RE.test(sig)) return jsonError('겹침 서명이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.');
  var key = cleanText(params.개설키, 200);
  if (!key) return jsonError('개설키(과정+기수)가 필요합니다');
  var plans = readAssignTable(ss, PLAN_SHEET).rows.filter(function(r){ return String(r['과정+기수']) === key; });
  if (plans.length === 0) return jsonError('연간계획에 없는 개설키입니다: ' + key);

  var ids = (Array.isArray(params.편성ID들) ? params.편성ID들 : []).map(function(v){ return cleanText(v, 60); }).filter(Boolean);
  if (kind === 'confirm') {
    if (!ids.length) return jsonError('겹침에 포함된 편성 정보가 없습니다');
    var have = {};
    readAssignTable(ss, SESSION_SHEET).rows.forEach(function(r){ have[String(r['편성ID'])] = true; });
    for (var i = 0; i < ids.length; i++) {
      if (!have[ids[i]]) return jsonError('겹침에 포함된 편성이 시트에 없습니다(삭제되었을 수 있음). 새로고침 후 다시 확인해 주세요.');
    }
  }

  // 현재 상태 확인(이미 같은 상태면 그대로 성공 처리)
  var cur = false;
  readPlanHistory(ss).forEach(function(h){
    if (h['항목'] !== sig) return;
    if (h['유형'] === '겹침 확인') cur = true;
    else if (h['유형'] === '겹침 확인 해제') cur = false;
  });
  var stamp = nowStamp();
  if ((kind === 'confirm') === cur) {
    return jsonOut({ status: 'ok', 종류: kind, 서명: sig, 일시: stamp, 역할: '관리자', 변경없음: true });
  }
  var entry = {
    일시: stamp, 개설키: key, 유형: kind === 'confirm' ? '겹침 확인' : '겹침 확인 해제', 항목: sig,
    전: kind === 'confirm' ? '(미확인)' : '확인됨', 후: kind === 'confirm' ? '확인됨' : '(미확인)',
    사유: cleanText(params.설명, 200), 역할: '관리자'
  };
  try {
    appendPlanHistory(ss, [entry]);
  } catch (err) {
    Logger.log('겹침 확인 기록 오류: ' + err + (err && err.stack ? ' ' + err.stack : ''));
    return jsonError('변경이력 시트에 기록하지 못해 처리하지 않았습니다: ' + (err && err.message ? err.message : err));
  }
  return jsonOut({ status: 'ok', 종류: kind, 서명: sig, 일시: stamp, 역할: '관리자' });
}

// =====================================================================
// 이전 기수 교과목 복사: 화면이 날짜를 옮겨 만든 여러 줄을 한 번에 저장
// - 대상 기수에 이미 편성이 하나라도 있으면 거부(덮어쓰기·중복 방지)
// - 줄마다 saveSession과 같은 규칙으로 검증하고, 범위 밖·없는 교시·없는 강의실 등은 warnings로만 알림
// - 강사ID가 강사DB에 없으면 그 줄의 강사는 비우고 알림. 수기 입력 이름은 그대로 저장
// - 시트에는 값 한 덩어리를 한 번에 씀. 기록은 변경이력에 한 줄(유형 '편성 복사')
// =====================================================================
var COPY_MAX_ROWS = 500;

function copySessions(params) {
  try {
    return copySessionsCore(params);
  } catch (err) {
    Logger.log('copySessions 오류: ' + err + (err && err.stack ? ' ' + err.stack : ''));
    return jsonError('편성 복사 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
  }
}

function copySessionsCore(params) {
  if (!checkPassword(params.password)) return jsonError(writeAccessDeniedMessage(params.password));
  var ss = openAssignSS();
  if (!ss) return assignNotConnectedError();

  var key = cleanText(params.개설키, 200);
  if (!key) return jsonError('개설키(과정+기수)가 필요합니다');
  var plan = readAssignTable(ss, PLAN_SHEET).rows.filter(function(r){ return String(r['과정+기수']) === key; });
  if (plan.length === 0) return jsonError('연간계획에 없는 개설키입니다: ' + key);
  var course = plan[0];
  if (isPlanCancelled(course)) return jsonError('취소된 기수에는 교과목을 복사할 수 없습니다. 취소 해제 후 다시 시도해 주세요.');
  var srcKey = cleanText(params.원본키, 200);

  var input = Array.isArray(params.rows) ? params.rows : [];
  if (!input.length) return jsonError('복사할 교과목이 없습니다');
  if (input.length > COPY_MAX_ROWS) return jsonError('한 번에 ' + COPY_MAX_ROWS + '줄까지 복사할 수 있습니다');

  var existing = readAssignTable(ss, SESSION_SHEET).rows;
  if (existing.some(function(r){ return String(r['개설키']) === key; })) {
    return jsonError('이 기수에는 이미 편성된 교과목이 있어 복사할 수 없습니다. 새로고침 후 확인해 주세요.');
  }

  var periods = readAssignTable(ss, '교시표').rows.map(function(r){ return Number(r['교시']); }).filter(function(n){ return isFinite(n); });
  var roomNames = readAssignTable(ss, '강의실').rows.map(function(r){ return String(r['강의실명']); });
  var ranges = [['입교 시작일', '입교 종료일'], ['사이버 시작일', '사이버 종료일'], ['실습(외부) 시작일', '실습(외부) 종료일']].map(function(p){
    return [String(course[p[0]] || ''), String(course[p[1]] || '')];
  }).filter(function(r){ return r[0] && r[1]; });

  var instCache = {};
  var cnt = { outRange: 0, badPeriod: 0, badRoom: 0, instState: 0, instMissing: 0 };
  var usedIds = {};
  existing.forEach(function(r){ usedIds[String(r['편성ID'])] = true; });
  var now = nowStamp();
  var out = [];

  for (var i = 0; i < input.length; i++) {
    var x = input[i] || {};
    var label = (i + 1) + '번째 줄: ';
    var klass = cleanText(x.반 || '전체', 10);
    if (SESSION_CLASS_VALUES.indexOf(klass) === -1) return jsonError(label + '반은 전체, A, B 중 하나여야 합니다');
    var dateStr = cleanText(x.일자, 10);
    if (!isValidDateStr(dateStr)) return jsonError(label + '일자는 yyyy-MM-dd 형식이어야 합니다');
    var sp = Number(x.시작교시), ep = Number(x.끝교시);
    if (!isFinite(sp) || !isFinite(ep) || sp % 1 !== 0 || ep % 1 !== 0 || sp < 1 || ep < 1) return jsonError(label + '교시는 1 이상의 정수여야 합니다');
    if (sp > ep) return jsonError(label + '시작교시가 끝교시보다 클 수 없습니다');
    var subject = cleanText(x.교과목, 100);
    if (!subject) return jsonError(label + '교과목이 비어 있습니다');

    var instId = cleanText(x.강사ID, 50), instName = '';
    if (instId) {
      if (instCache[instId] === undefined) instCache[instId] = findInstructor(instId) || null;
      var inst = instCache[instId];
      if (!inst) { instId = ''; instName = ''; cnt.instMissing++; }
      else {
        instName = String(inst.성명 || '');
        if (inst.상태 && ['활성', '승인', '정식'].indexOf(String(inst.상태)) === -1) cnt.instState++;
      }
    } else {
      instName = cleanText(x.강사명, 50);
    }
    var instRole = cleanText(x['강사 역할'], 10);
    if (instRole && SESSION_ROLE_VALUES.indexOf(instRole) === -1) return jsonError(label + '강사 역할은 주강사 또는 보조강사여야 합니다');
    if (!instId && !instName) instRole = '';
    else if (!instRole) instRole = '주강사';
    var room = cleanText(x.강의실, 100);
    if (room && roomNames.length && roomNames.indexOf(room) === -1) cnt.badRoom++;
    var inRange = ranges.some(function(r){ return dateStr >= r[0] && dateStr <= r[1]; });
    if (!inRange) cnt.outRange++;
    if (periods.length && (periods.indexOf(sp) === -1 || periods.indexOf(ep) === -1)) cnt.badPeriod++;

    var id;
    do {
      id = 'S' + Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMddHHmmss') + '-' + ('000' + Math.floor(Math.random() * 1000)).slice(-3);
    } while (usedIds[id]);
    usedIds[id] = true;
    out.push({
      '편성ID': id, '개설키': key, '반': klass, '일자': dateStr, '시작교시': sp, '끝교시': ep,
      '교과목': subject, '교과목 구분': cleanText(x['교과목 구분'], 50),
      '강사ID': instId, '강사명': instName, '강의실': room, '비고': cleanText(x.비고, 200),
      '입력일시': now, '수정일시': now, '입력 역할': '관리자', '강사 역할': instRole,
      '계획서제출일시': '', '계획서파일ID': ''
    });
  }

  var sheet = ensureSessionSheet(ss);
  var cm = sessionColMap(sheet);
  var width = SESSION_HEADERS.length;
  var startRow = Math.max(sheet.getLastRow(), ASSIGN_HEADER_ROW) + 1;
  ensureSheetRows(sheet, startRow + out.length);
  var block = out.map(function(v){
    var arr = [];
    for (var c = 0; c < width; c++) arr.push('');
    SESSION_HEADERS.forEach(function(h){ if (cm.map[h] !== undefined && cm.map[h] < width) arr[cm.map[h]] = (v[h] === undefined ? '' : v[h]); });
    return arr;
  });
  var fmtRow = SESSION_HEADERS.map(function(h){ return SESSION_NUMBER_COLS.indexOf(h) > -1 ? '0' : '@'; });
  var range = sheet.getRange(startRow, ASSIGN_FIRST_COL, out.length, width);
  range.setNumberFormats(block.map(function(){ return fmtRow; }));
  range.setValues(block);

  var warnings = [];
  if (cnt.outRange) warnings.push('일자가 해당 과정의 입교·사이버·실습 기간 밖인 줄이 ' + cnt.outRange + '개 있습니다');
  if (cnt.badPeriod) warnings.push('교시표에 없는 교시가 있는 줄이 ' + cnt.badPeriod + '개 있습니다');
  if (cnt.badRoom) warnings.push('강의실 목록에 없는 이름이 있는 줄이 ' + cnt.badRoom + '개 있습니다(정식 등록 대기 대상)');
  if (cnt.instState) warnings.push('강사 상태가 활성이 아닌 줄이 ' + cnt.instState + '개 있습니다');
  if (cnt.instMissing) warnings.push('강사DB에서 찾을 수 없는 강사가 있어 ' + cnt.instMissing + '개 줄의 강사를 비웠습니다');

  var histNote = '';
  try {
    appendPlanHistory(ss, [{ 일시: now, 개설키: key, 유형: '편성 복사', 항목: '교과목 편성', 전: '(없음)', 후: out.length + '줄 복사',
      사유: '이전 기수 복사' + (srcKey ? '(원본: ' + srcKey + ')' : ''), 역할: '관리자' }]);
  } catch (err) {
    Logger.log('편성 복사 이력 기록 오류: ' + err);
    histNote = '변경이력에는 기록하지 못했습니다.';
  }
  return jsonOut({ status: 'ok', 개설키: key, 원본키: srcKey, 개수: out.length, data: out, warnings: warnings, 이력메모: histNote });
}


// 비밀번호 잠금을 즉시 해제 (Apps Script 편집기에서 이 함수를 선택해 실행)
function unlockNow() {
  var cache = CacheService.getScriptCache();
  cache.remove('pwfail');
  cache.remove('pwlast');
  Logger.log('비밀번호 잠금 해제됨');
}
