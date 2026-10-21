/* 평가관리 계산 모듈 (화면과 분리한 순수 계산 코드 · 서버/네트워크 사용 안 함)
 * - 설문 결과 CSV 읽기, 문항 열 찾기, 교과목·강사별 집계, 누적 별점 계산, 편성에서 강사 찾기
 * - (v4) 응답자 기본정보(소속·근무기간·보직) 집계, 서술형 의견 규칙 분류(주제·성격·개인정보 의심·의견 없음)
 * - 브라우저에서는 window.EvalCore, Node 시험에서는 module.exports 로 사용 */
(function (root) {
  'use strict';

  var MIN_SESSION = 20;   // 한 회차 점수를 표시하는 최소 응답 수
  var MIN_CUM = 20;       // 누적 별점을 표시하는 최소 응답 수(한 과정 20~30명 기준)
  var Q = ['태도', '목표', '전달', '효과'];                 // 강의 문항
  var QT = ['태도', '준비성', '전문성', '적용성'];          // 훈련(현장교관) 문항
  var QT_ONLY = ['준비성', '전문성', '적용성'];
  /* 공통 문항(과정 전체에 한 번씩 묻는 분야별 문항). 설문 생성기의 COMMON_SECTIONS 와 같은 이름을 써야 합니다 */
  var COMMON_SECTIONS = [
    { title: '교육시설환경', items: ['교재의 품질', '강의실 및 교육기자재', '편의시설', '교직원의 친절도'] },
    { title: '구내식당', items: ['구내식당 이용', '음식의 간', '메뉴의 다양성', '청결도', '친절도'] }
  ];
  function qList(set) { return set === 'T' ? QT : Q; }
  /* 응답자 기본정보(설문 첫 쪽, 필수). 설문 생성기 v4 의 BASIC_FIELDS 와 같은 이름(폼 문항 제목)을 써야 합니다. 점수 계산에는 쓰지 않음 */
  var BASIC_FIELDS = ['소속', '근무기간', '보직'];
  function basicField(h) {
    var t = String(h || '').replace(/^\s*기본\s*정보\s*[|:：·\-]?\s*/, '').replace(/\s+/g, '').replace(/[()（）]/g, '');
    for (var i = 0; i < BASIC_FIELDS.length; i++) if (t === BASIC_FIELDS[i]) return BASIC_FIELDS[i];
    return null;
  }

  /* ---------- CSV 읽기 ---------- */
  function detectDelim(text) {
    var line = String(text).split(/\r?\n/, 1)[0] || '';
    var c = (line.match(/,/g) || []).length, t = (line.match(/\t/g) || []).length, s = (line.match(/;/g) || []).length;
    return t > c && t >= s ? '\t' : (s > c ? ';' : ',');
  }
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var d = detectDelim(text), rows = [], row = [], cur = '', q = false, i = 0, n = text.length, ch;
    while (i < n) {
      ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
        cur += ch; i++; continue;
      }
      if (ch === '"') { q = true; i++; continue; }
      if (ch === d) { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ---------- 응답 값 → 1~5점 ---------- */
  var CIRCLED = { '①': 5, '②': 4, '③': 3, '④': 2, '⑤': 1 };   // 설문지 보기 순서(① 매우만족 … ⑤ 매우불만족) 기준
  function answerScore(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var c = s.charAt(0);
    if (CIRCLED[c]) return CIRCLED[c];
    var t = s.replace(/\s+/g, '');
    if (/^[1-5](점)?$/.test(t)) return Number(t.charAt(0));
    if (t.indexOf('매우불만족') > -1) return 1;
    if (t.indexOf('매우만족') > -1) return 5;
    if (t.indexOf('불만족') > -1) return 2;
    if (t.indexOf('만족') > -1) return 4;
    if (t.indexOf('보통') > -1) return 3;
    return null;
  }

  /* ---------- 문항 열 찾기 ----------
   * 머리글에서 문항(태도·목표·전달·효과·서술)을 찾고, 나머지 글자를 교과목명으로 봄.
   * 예) "소방기본법 | 태도", "[소방기본법] 강의 태도", "소방기본법_효과" */
  var QPAT = [
    ['준비성', /준비성|훈련\s*환경/],
    ['전문성', /전문성|숙련/],
    ['적용성', /적용성|실무\s*적용|현장\s*적용/],
    ['태도', /태도|열의|성실/],
    ['목표', /목표|목적/],
    ['전달', /전달|이해|명확|설명/],
    ['효과', /효과|도움|유용|적용|활용/],
    ['서술', /의견|서술|건의|주관|자유|기타|하고\s*싶|바라는|아쉬운|좋았던/]
  ];
  /* 쪽별 표의 줄 이름(공백 제거) → 문항. 설문 생성기 v3 의 QUESTIONS/TRAIN_QUESTIONS row 와 같아야 함 */
  var ROW_Q = { '태도': '태도', '목표달성': '목표', '전달력': '전달', '효과(업무도움)': '효과', '준비성': '준비성', '전문성': '전문성', '적용성': '적용성' };
  function splitHeader(h) {
    return String(h || '').split(/[\n|\/\[\]()（）:：_]+|\s-\s|\s{2,}/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function cleanSubject(s) {
    return String(s || '')
      .replace(/(교과목|과목)\s*(명)?\s*$/, '')
      .replace(/^(\d+[.)]?\s*)/, '')
      .replace(/\s+/g, ' ').trim();
  }
  /* 머리글에서 문항을 찾고, 나머지 조각(교과목명·강사명, 순서 무관)을 names로 돌려줌. 문항은 보통 맨 뒤에 있으므로 뒤에서부터 찾음 */
  function classifyHeader(h) {
    var bf = basicField(h);
    if (bf) return { basic: true, field: bf };
    /* 구글 폼 표(그리드) 문항: "강의 태도 [소방기본법 (김가상)]" — 대괄호 앞이 문항, 안쪽이 교과목·강사 */
    var gm = String(h || '').match(/^([^\[\]]+?)\s*\[(.+)\]\s*$/);
    if (gm) {
      /* 공통 문항: "교육시설환경 [교재의 품질]" — 대괄호 앞이 분야 이름 */
      var secKey = normSubject(gm[1]), si;
      for (si = 0; si < COMMON_SECTIONS.length; si++) {
        if (normSubject(COMMON_SECTIONS[si].title) === secKey) return { common: true, section: COMMON_SECTIONS[si].title, item: String(gm[2]).replace(/\s+/g, ' ').trim() };
      }
      /* 쪽별 표(설문 생성기 v3): "소방기본법 (김가상) 강의 [태도]" / "화재진압 (박교관) 훈련 [준비성]" — 대괄호 앞이 교과목·강사+강의/훈련, 안쪽이 문항 */
      var nm = gm[1].match(/^(.*\S)\s+(강의|훈련)\s*$/);
      if (nm && ROW_Q[String(gm[2]).replace(/\s+/g, '')]) {
        var pm = nm[1].match(/^(.*\S)\s*[(（]([^()（）]+)[)）]\s*$/);   // "교과목 (강사)" — 교과목명 안의 기호는 그대로 둠
        var rn = pm ? [cleanSubject(pm[1]), pm[2].trim()].filter(Boolean) : splitHeader(nm[1]).map(cleanSubject).filter(Boolean);
        return { q: ROW_Q[String(gm[2]).replace(/\s+/g, '')], names: rn, subject: rn.join(' '), set: nm[2] === '훈련' ? 'T' : 'L' };
      }
      var gq = null, gk;
      for (gk = 0; gk < QPAT.length && !gq; gk++) if (QPAT[gk][1].test(gm[1])) gq = QPAT[gk][0];
      if (gq) {
        var gn = splitHeader(gm[2]).map(cleanSubject).filter(Boolean);
        return { q: gq, names: gn, subject: gn.join(' '), set: /^\s*훈련/.test(gm[1]) ? 'T' : null };
      }
    }
    /* 설문 생성기 v3 의견 문항: "교과목 (강사) 의견" */
    var om = String(h || '').match(/^(.*\S)\s*[(（]([^()（）]+)[)）]\s*의견\s*$/);
    if (om) { var on = [cleanSubject(om[1]), om[2].trim()].filter(Boolean); return { q: '서술', names: on, subject: on.join(' ') }; }
    var parts = splitHeader(h), q = null, qi = -1, i, k;
    for (i = parts.length - 1; i >= 0 && !q; i--) {
      for (k = 0; k < QPAT.length; k++) if (QPAT[k][1].test(parts[i])) { q = QPAT[k][0]; qi = i; break; }
    }
    if (!q) return null;
    var rest = parts.filter(function (p, idx) { return idx !== qi; });
    /* 한 조각에 교과목명과 문항이 함께 있는 경우("소방기본법 강의태도"): 문항 단어 앞부분을 교과목명으로 */
    if (!rest.length && parts[qi]) {
      var m = parts[qi].match(/^(.*?)\s*(강의|강사|교수)?\s*(태도|열의|성실|목표|목적|전달|이해|명확|설명|효과|도움|유용|적용|활용|의견|서술|건의)/);
      if (m && m[1]) rest = [m[1]];
    }
    var names = rest.map(cleanSubject).filter(Boolean);
    return { q: q, names: names, subject: names.join(' ') };
  }
  /* 반환: [{subject, names, set:'L'|'T', cols:{태도:열번호,…,서술:열번호}}] (머리글 순서 유지)
   * set: 'T' = 훈련(현장교관) 문항 묶음, 'L' = 강의 문항 묶음. 의견(서술) 열은 이름이 같은 묶음에 붙임 */
  function detectGroups(headers) {
    var groups = [], byKey = {}, last = null;
    headers.forEach(function (h, idx) {
      var c = classifyHeader(h);
      if (!c || c.common || c.basic) return;
      var names = c.names;
      if (!names.join('|') && last) names = last.names;   // 이름이 없는 열은 직전 묶음에 붙임
      var nk = names.join('|');
      var g = null;
      if (c.q === '서술') {   // 의견 열: 같은 이름의 묶음(강의/훈련 무관)에 붙임
        groups.forEach(function (x) { if (!g && x.names.join('|') === nk && x.cols['서술'] === undefined) g = x; });
      } else {
        var key = (c.set || '') + '|' + nk;
        g = byKey[key];
        if (g && g.cols[c.q] !== undefined) g = null;
      }
      if (!g) {
        g = { subject: names.join(' '), names: names, set: c.set || null, cols: {} };
        groups.push(g);
        if (c.q !== '서술') byKey[(c.set || '') + '|' + nk] = g;
      }
      g.cols[c.q] = idx;
      last = g;
    });
    groups.forEach(function (g) {
      if (!g.set) g.set = QT_ONLY.some(function (k) { return g.cols[k] !== undefined; }) ? 'T' : 'L';
    });
    return groups;
  }
  /* 공통 문항 열: [{section,item,col}] */
  function detectCommons(headers) {
    var out = [];
    headers.forEach(function (h, idx) {
      var c = classifyHeader(h);
      if (c && c.common) out.push({ section: c.section, item: c.item, col: idx });
    });
    return out;
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  /* ---------- 집계 ----------
   * rows: parseCSV 결과(머리글 포함). 반환: {headers, groups, fileCount, items:[{subject,n,avg:{태도..},overall,comments:[]}], skipped}
   * fileCount = 값이 하나라도 있는 응답 줄 수 */
  function aggregate(rows) {
    if (!rows || rows.length < 2) return { headers: [], groups: [], fileCount: 0, items: [], commons: [], skipped: 0, basics: {}, basicCols: 0, noneCount: 0 };
    var headers = rows[0].map(function (h) { return String(h || ''); });
    var groups = detectGroups(headers);
    var data = rows.slice(1).filter(function (r) { return r.some(function (c) { return String(c || '').trim() !== ''; }); });
    var skipped = 0;
    var items = groups.map(function (g) {
      var sums = {}, cnts = {}, comments = [], nones = 0, n = 0, QS = qList(g.set);
      QS.forEach(function (k) { sums[k] = 0; cnts[k] = 0; });
      data.forEach(function (r) {
        var any = false;
        QS.forEach(function (k) {
          if (g.cols[k] === undefined) return;
          var sc = answerScore(r[g.cols[k]]);
          if (sc === null) { if (String(r[g.cols[k]] || '').trim() !== '') skipped++; return; }
          sums[k] += sc; cnts[k]++; any = true;
        });
        if (any) n++;
        if (g.cols['서술'] !== undefined) {
          var t = String(r[g.cols['서술']] || '').replace(/\s+/g, ' ').trim();
          if (t && isNoneComment(t)) nones++;          // "없음"·"." 같은 응답은 의견 건수에서 빼고 따로 셈
          else if (t) comments.push(t);
        }
      });
      var avg = {}, ok = true, tot = 0;
      QS.forEach(function (k) {
        if (cnts[k] > 0) { avg[k] = round2(sums[k] / cnts[k]); tot += avg[k]; } else { avg[k] = null; ok = false; }   // 종합은 화면에 보이는(소수 둘째 자리) 문항 평균 4개의 평균 — 서버 저장 계산과 같음
      });
      return { subject: g.subject, names: g.names, set: g.set, n: n, avg: avg, overall: ok ? round2(tot / 4) : null, comments: comments, nones: nones, hasAll: ok };
    }).filter(function (it) { return it.n > 0 || it.comments.length > 0 || it.nones > 0; });
    var commons = detectCommons(headers).map(function (c) {
      var sum = 0, cnt = 0;
      data.forEach(function (r) { var sc = answerScore(r[c.col]); if (sc !== null) { sum += sc; cnt++; } });
      return { section: c.section, item: c.item, n: cnt, avg: cnt ? round2(sum / cnt) : null };
    }).filter(function (c) { return c.n > 0; });
    /* 기본정보: 열별 응답 값 → 인원 */
    var basics = {}, basicCols = 0;
    headers.forEach(function (h, idx) {
      var c = classifyHeader(h);
      if (!c || !c.basic) return;
      basicCols++;
      var m = basics[c.field] || (basics[c.field] = {});
      data.forEach(function (r) { var v = String(r[idx] || '').replace(/\s+/g, ' ').trim() || '(응답 없음)'; m[v] = (m[v] || 0) + 1; });
    });
    var noneCount = items.reduce(function (sum, it) { return sum + it.nones; }, 0);
    return { headers: headers, groups: groups, fileCount: data.length, items: items, commons: commons, skipped: skipped, basics: basics, basicCols: basicCols, noneCount: noneCount };
  }

  /* ---------- 점수 표시 ---------- */
  function stars(score) { return Math.round(score * 2) / 2; }            // 0.5 단위
  function starPct(score) { return Math.round(stars(score) / 5 * 100); }  // 별 채움 비율(%)
  function to50(score) { return Math.round(score * 10 * 10) / 10; }       // 업로드 미리보기 전용

  /* 한 강사의 저장 행(응답수·종합 포함)에서 누적 계산 — 응답 수로 가중한 평균 */
  function cumulative(list) {
    var n = 0, sum = 0;
    list.forEach(function (r) { var c = Number(r.응답수), s = Number(r.종합); if (c >= MIN_SESSION && isFinite(s)) { n += c; sum += s * c; } });
    return { n: n, avg: n ? round2(sum / n) : null };
  }

  /* ---------- 편성에서 강사 찾기 ----------
   * 편성 한 줄의 '현장교관' 값: 빈칸 = 일반(강의 문항), '대표' = 평가 대상 현장교관(훈련 문항), '제외' = 설문 대상 아님 */
  function normSubject(s) { return String(s == null ? '' : s).replace(/[\s·ㆍ.,()\[\]]/g, '').toLowerCase(); }
  function normPerson(s) {
    return normSubject(String(s || '').replace(/\s*(교수님|강사님|선생님|교수|강사|박사|님)\s*$/, ''));
  }
  function rowSet(s) {
    var t = String(s['현장교관'] || '').trim();
    return t === '대표' ? 'T' : (t === '제외' ? 'X' : 'L');
  }
  /* 그 문항 세트(L 강의 / T 훈련)의 설문 대상 줄인가. 강의는 강사ID가 있어야 하고, 훈련은 이름만 있어도 됨 */
  function usable(s, set) {
    var rs = rowSet(s), id = String(s['강사ID'] || '').trim(), nm = String(s['강사명'] || '').trim();
    if (set === 'T') return rs === 'T' && !!(id || nm);
    return rs === 'L' && !!id;
  }
  function personKey(s) {
    var id = String(s['강사ID'] || '').trim();
    return id || ('N:' + normPerson(s['강사명']));
  }
  /* sessions: 한 과정(개설키)의 교과목시간표 줄들. 반환: 교과목(정규화) → {label, list:[{id,key,name,main}]} */
  function subjectMap(sessions, set) {
    var map = {};
    sessions.forEach(function (s) {
      if (!usable(s, set)) return;
      var k = normSubject(s['교과목']);
      if (!k) return;
      var pk = personKey(s), role = String(s['강사 역할'] || '').trim();
      var o = map[k] || (map[k] = { label: String(s['교과목']), list: [] });
      var f = o.list.filter(function (x) { return x.key === pk; })[0];
      if (!f) o.list.push({ id: String(s['강사ID'] || '').trim(), key: pk, name: String(s['강사명'] || ''), main: role !== '보조강사' });
      else if (role !== '보조강사') f.main = true;
    });
    return map;
  }
  function pickOf(x) { return { id: x.id, key: x.key, name: x.name }; }
  /* 결과: {state:'auto'|'ambiguous'|'none', picks:[{id,key,name}], label} */
  function matchInstructor(map, subject) {
    var o = map[normSubject(subject)];
    if (!o) return { state: 'none', picks: [], label: '' };
    var mains = o.list.filter(function (x) { return x.main; });
    if (mains.length === 1) return { state: 'auto', picks: [pickOf(mains[0])], label: o.label };
    return { state: 'ambiguous', picks: o.list.map(pickOf), label: o.label };
  }
  /* ---------- 강사명 우선 연결 ----------
   * names: 머리글에서 읽은 이름 조각(교과목명·강사명, 순서 무관). 먼저 편성의 강사 이름과 맞춰 보고, 안 맞으면 교과목명으로 맞춤.
   * set: 'T'면 대표 현장교관 줄에서, 아니면 일반 강의 줄에서 찾음.
   * 결과: {state:'auto'|'ambiguous'|'none', picks:[{id,key,name}], label(교과목명), how:'강사명'|'교과목'|''} */
  function resolveGroup(sessions, names, set) {
    names = (names || []).filter(Boolean);
    var map = subjectMap(sessions, set);
    var people = {};   // 사람 키 → {id,key,name,subjects:[라벨]}
    sessions.forEach(function (s) {
      if (!usable(s, set) || String(s['강사 역할'] || '').trim() === '보조강사') return;
      var pk = personKey(s);
      var o = people[pk] || (people[pk] = { id: String(s['강사ID'] || '').trim(), key: pk, name: String(s['강사명'] || ''), subjects: [] });
      var sub = String(s['교과목'] || '');
      if (sub && o.subjects.indexOf(sub) < 0) o.subjects.push(sub);
    });
    var list = Object.keys(people).map(function (k) { return people[k]; });
    var hit = [], subjPart = [];
    names.forEach(function (nm) {
      var f = list.filter(function (p) { return p.name && normPerson(p.name) === normPerson(nm); });
      if (f.length) f.forEach(function (p) { if (hit.indexOf(p) < 0) hit.push(p); });
      else subjPart.push(nm);
    });
    if (hit.length) {
      /* 교과목 조각이 있으면 그 교과목을 맡은 강사로 좁힘(동명이인 구분) */
      var narrowed = hit;
      if (hit.length > 1 && subjPart.length) {
        var k2 = subjPart.map(normSubject);
        narrowed = hit.filter(function (p) { return p.subjects.some(function (sb) { return k2.indexOf(normSubject(sb)) > -1; }); });
        if (!narrowed.length) narrowed = hit;
      }
      var label = '', mm = subjPart.length ? map[normSubject(subjPart[0])] : null;
      if (mm) label = mm.label;                                                                      // 파일의 교과목명이 편성과 같음
      else if (narrowed.length === 1 && narrowed[0].subjects.length === 1) label = narrowed[0].subjects[0];   // 틀려 썼어도 그 강사의 편성 교과목명을 사용
      else label = subjPart[0] || '';
      var fileSubject = subjPart[0] || '';
      if (narrowed.length === 1) return { state: 'auto', picks: [pickOf(narrowed[0])], label: label, how: '강사명', fileSubject: fileSubject };
      return { state: 'ambiguous', picks: narrowed.map(pickOf), label: label, how: '강사명', fileSubject: fileSubject };
    }
    var m = matchInstructor(map, names.join(' '));
    if (m.state === 'none' && names.length > 1) {
      for (var i = 0; i < names.length && m.state === 'none'; i++) m = matchInstructor(map, names[i]);
    }
    m.how = m.state === 'none' ? '' : '교과목';
    return m;
  }
  /* 설문 열 제목 목록용·설문 생성용: 과정 편성의 (교과목, 강사) 쌍을 날짜·교시 순으로, 주강사만.
   * 일반 강사는 set 'L', 대표 현장교관은 set 'T', '제외' 줄은 빠짐 */
  function surveyPairs(sessions) {
    var rows = sessions.filter(function (s) {
      if (!String(s['교과목'] || '').trim() || String(s['강사 역할'] || '').trim() === '보조강사') return false;
      return usable(s, 'L') || usable(s, 'T');
    }).sort(function (a, b) { return (String(a['일자']) + ('0' + a['시작교시']).slice(-2)).localeCompare(String(b['일자']) + ('0' + b['시작교시']).slice(-2)); });
    var seen = {}, out = [];
    rows.forEach(function (s) {
      var set = rowSet(s) === 'T' ? 'T' : 'L';
      var k = set + '|' + normSubject(s['교과목']) + '|' + personKey(s);
      if (!seen[k]) { seen[k] = 1; out.push({ subject: String(s['교과목']), id: String(s['강사ID'] || ''), name: String(s['강사명'] || ''), set: set }); }
    });
    return out;
  }
  function surveyHeader(pairs) {
    var h = ['타임스탬프'];
    pairs.forEach(function (p) { qList(p.set).concat(['의견']).forEach(function (q) { h.push(p.subject + ' | ' + p.name + ' | ' + q); }); });
    return h;
  }

  function allInstructors(sessions, set) {
    var seen = {}, out = [];
    sessions.forEach(function (s) {
      if (!usable(s, set === 'T' ? 'T' : 'L')) return;
      var pk = personKey(s);
      if (!seen[pk]) { seen[pk] = 1; out.push({ id: String(s['강사ID'] || '').trim(), key: pk, name: String(s['강사명'] || '') }); }
    });
    return out;
  }

  /* ---------- 응답 인원 확인 ---------- */
  function checkCounts(enter, fileN, confirm) {
    if (!(enter > 0)) return { level: 'err', text: '입교 인원을 입력해 주세요.' };
    if (!(confirm > 0)) return { level: 'err', text: '확정 응답 인원을 입력해 주세요.' };
    if (confirm > enter) return { level: 'err', text: '확정 응답 인원이 입교 인원보다 많습니다. 숫자를 다시 확인해 주세요.' };
    if (fileN > confirm) return { level: 'warn', text: '파일의 응답이 ' + (fileN - confirm) + '건 더 많습니다. 중복·시험 응답일 수 있으니 파일에서 해당 줄을 지우고 다시 올려 주세요.' };
    if (fileN < confirm) return { level: 'warn', text: '확정 응답 인원이 파일보다 ' + (confirm - fileN) + '명 많습니다. 숫자를 다시 확인해 주세요. 점수는 파일의 ' + fileN + '건으로 계산합니다.' };
    return { level: 'ok', text: '파일의 응답 건수와 확정 응답 인원이 같습니다.' };
  }

  /* ---------- 서술형 의견 규칙 분류 (AI 없음, 낱말 규칙) ----------
   * 주제: 아래 규칙에서 낱말이 가장 많이 걸린 주제(같으면 위에 있는 주제). 아무것도 안 걸리면 '기타'.
   * 성격: 개선을 바라는 낱말이 있으면 '개선 요청', 칭찬 낱말만 있으면 '칭찬', 둘 다 없으면 '기타'.
   * 규칙은 아래 표만 고치면 바뀝니다. */
  var TOPIC_RULES = [
    ['실습·훈련', /실습|훈련|장비|체험|실기|시연|조작|교보재/g],
    ['현장 적용', /현장|실무|업무|활용|적용|써먹|도움/g],
    ['강의 내용', /내용|이론|사례|자료|교재|피피티|ppt|법령|지식|정보|예시|영상/gi],
    ['전달·진행', /설명|전달|이해|목소리|발음|속도|빠르|빨랐|빨라|느리|느렸|진행|질문|소통|집중|재미|재밌|지루|열정|열의|쉽게|어렵|어려웠|강의력|강의\s*방식/g],
    ['시간·일정', /시간|일정|짧|길었|길어|길게|연장|늘려|늘렸|줄여|쉬는|휴식|오전|오후/g],
    ['시설·환경', /강의실|냉방|난방|에어컨|추웠|추워|더웠|더워|의자|마이크|음향|빔|스크린|시설|환경|주차|식당|숙소|화장실/g]
  ];
  var TOPICS = TOPIC_RULES.map(function (r) { return r[0]; }).concat(['기타']);
  var TONES = ['칭찬', '개선 요청', '기타'];
  var RE_IMPROVE = /아쉬|개선|않았|않아서|못했|못해서|부족|했으면|하면\s*좋|면\s*좋겠|바랍|바람|필요|불편|힘들|지루|길었|짧았|빨랐|늘려|늘렸으면|줄여|추가|더\s*많|어려웠|어렵/;
  var RE_PRAISE = /좋았|좋습|좋은|좋아|유익|유용|감사|최고|훌륭|만족|재미있|재밌|알찬|인상|명강|추천|도움이\s*(됐|되었|많이|됩니다|되었습니다)|잘\s*들었|잘\s*정리|쉬웠|쉽게\s*(설명|이해|알려)|명확|수\s*있었|수고|고생/;
  var RE_PII = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+|\d{6}[-\s]?[1-4]\d{6}/;
  var NONE_WORDS = ['없음', '없습니다', '없어요', '없다', '없슴', '없읍니다', '없음니다', '무', 'x', 'ㄴ', 'ㅇ', 'ㅇㅇ', 'no', 'none', 'nothing', 'na', 'n/a',
    '특이사항없음', '특이사항없습니다', '특별히없음', '특별히없습니다', '딱히없음', '딱히없습니다', '해당없음', '해당사항없음', '의견없음', '의견없습니다', '별도의견없음'];
  function isNoneComment(t) {
    var s = String(t || '').toLowerCase().replace(/[\s.,!~·\-_'"`。]+/g, '');
    if (!s) return true;
    if (NONE_WORDS.indexOf(s) > -1) return true;
    return s.length <= 14 && /^(특이|특별히|딱히|해당|별도|별다른|특별한)?(사항|의견|건의사항|내용)?(은|는|이|도)?(없|無)(음|습니다|어요|다|슴|읍니다|네요|고요|음니다)?$/.test(s);
  }
  function classifyComment(t) {
    var text = String(t || ''), best = '기타', bestN = 0;
    TOPIC_RULES.forEach(function (r) { var m = text.match(r[1]); var n = m ? m.length : 0; if (n > bestN) { best = r[0]; bestN = n; } });
    var tone = RE_IMPROVE.test(text) ? '개선 요청' : (RE_PRAISE.test(text) ? '칭찬' : '기타');
    return { topic: best, tone: tone, pii: RE_PII.test(text) };
  }

  var api = {
    MIN_SESSION: MIN_SESSION, MIN_CUM: MIN_CUM, Q: Q, QT: QT, COMMON_SECTIONS: COMMON_SECTIONS, qList: qList, detectCommons: detectCommons, rowSet: rowSet,
    parseCSV: parseCSV, answerScore: answerScore, classifyHeader: classifyHeader, detectGroups: detectGroups,
    aggregate: aggregate, stars: stars, starPct: starPct, to50: to50, cumulative: cumulative,
    normSubject: normSubject, subjectMap: subjectMap, matchInstructor: matchInstructor, allInstructors: allInstructors, resolveGroup: resolveGroup, surveyPairs: surveyPairs, surveyHeader: surveyHeader,
    checkCounts: checkCounts, round2: round2,
    BASIC_FIELDS: BASIC_FIELDS, basicField: basicField, TOPICS: TOPICS, TONES: TONES, TOPIC_RULES: TOPIC_RULES, isNoneComment: isNoneComment, classifyComment: classifyComment
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EvalCore = api;
})(typeof window !== 'undefined' ? window : this);
