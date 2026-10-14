/* 평가관리 계산 모듈 (화면과 분리한 순수 계산 코드 · 서버/네트워크 사용 안 함)
 * - 설문 결과 CSV 읽기, 문항 열 찾기, 교과목·강사별 집계, 누적 별점 계산, 편성에서 강사 찾기
 * - 브라우저에서는 window.EvalCore, Node 시험에서는 module.exports 로 사용 */
(function (root) {
  'use strict';

  var MIN_SESSION = 10;   // 한 회차 점수를 표시하는 최소 응답 수
  var MIN_CUM = 30;       // 누적 별점을 표시하는 최소 응답 수
  var Q = ['태도', '목표', '전달', '효과'];

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
    ['태도', /태도|열의|성실/],
    ['목표', /목표|목적/],
    ['전달', /전달|이해|명확|설명/],
    ['효과', /효과|도움|유용|적용|활용/],
    ['서술', /의견|서술|건의|주관|자유|기타|하고\s*싶|바라는|아쉬운|좋았던/]
  ];
  function splitHeader(h) {
    return String(h || '').split(/[\n|\/\[\]()（）:：_·]+|\s-\s|\s{2,}/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function cleanSubject(s) {
    return String(s || '')
      .replace(/(교과목|과목)\s*(명)?\s*$/, '')
      .replace(/^(\d+[.)]?\s*)/, '')
      .replace(/\s+/g, ' ').trim();
  }
  /* 머리글에서 문항을 찾고, 나머지 조각(교과목명·강사명, 순서 무관)을 names로 돌려줌. 문항은 보통 맨 뒤에 있으므로 뒤에서부터 찾음 */
  function classifyHeader(h) {
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
  /* 반환: [{subject, names, cols:{태도:열번호,…,서술:열번호}}] (머리글 순서 유지) */
  function detectGroups(headers) {
    var groups = [], byKey = {}, last = null;
    headers.forEach(function (h, idx) {
      var c = classifyHeader(h);
      if (!c) return;
      var names = c.names, key = names.join('|');
      if (!key && last) { names = last.names; key = names.join('|'); }   // 이름이 없는 열은 직전 묶음에 붙임
      var g = byKey[key];
      if (!g || g.cols[c.q] !== undefined) { g = { subject: names.join(' '), names: names, cols: {} }; groups.push(g); byKey[key] = g; }
      g.cols[c.q] = idx;
      last = g;
    });
    return groups;
  }

  function round2(x) { return Math.round(x * 100) / 100; }

  /* ---------- 집계 ----------
   * rows: parseCSV 결과(머리글 포함). 반환: {headers, groups, fileCount, items:[{subject,n,avg:{태도..},overall,comments:[]}], skipped}
   * fileCount = 값이 하나라도 있는 응답 줄 수 */
  function aggregate(rows) {
    if (!rows || rows.length < 2) return { headers: [], groups: [], fileCount: 0, items: [], skipped: 0 };
    var headers = rows[0].map(function (h) { return String(h || ''); });
    var groups = detectGroups(headers);
    var data = rows.slice(1).filter(function (r) { return r.some(function (c) { return String(c || '').trim() !== ''; }); });
    var skipped = 0;
    var items = groups.map(function (g) {
      var sums = {}, cnts = {}, comments = [], n = 0;
      Q.forEach(function (k) { sums[k] = 0; cnts[k] = 0; });
      data.forEach(function (r) {
        var any = false;
        Q.forEach(function (k) {
          if (g.cols[k] === undefined) return;
          var sc = answerScore(r[g.cols[k]]);
          if (sc === null) { if (String(r[g.cols[k]] || '').trim() !== '') skipped++; return; }
          sums[k] += sc; cnts[k]++; any = true;
        });
        if (any) n++;
        if (g.cols['서술'] !== undefined) {
          var t = String(r[g.cols['서술']] || '').replace(/\s+/g, ' ').trim();
          if (t) comments.push(t);
        }
      });
      var avg = {}, ok = true, tot = 0;
      Q.forEach(function (k) {
        if (cnts[k] > 0) { avg[k] = round2(sums[k] / cnts[k]); tot += sums[k] / cnts[k]; } else { avg[k] = null; ok = false; }   // 종합은 반올림 전 문항 평균으로 계산
      });
      return { subject: g.subject, names: g.names, n: n, avg: avg, overall: ok ? round2(tot / 4) : null, comments: comments, hasAll: ok };
    }).filter(function (it) { return it.n > 0 || it.comments.length > 0; });
    return { headers: headers, groups: groups, fileCount: data.length, items: items, skipped: skipped };
  }

  /* ---------- 점수 표시 ---------- */
  function stars(score) { return Math.round(score * 2) / 2; }            // 0.5 단위
  function starPct(score) { return Math.round(stars(score) / 5 * 100); }  // 별 채움 비율(%)
  function to50(score) { return Math.round(score * 10 * 10) / 10; }       // 업로드 미리보기 전용

  /* 한 강사의 저장 행(응답수·종합 포함)에서 누적 계산 — 응답 수로 가중한 평균 */
  function cumulative(list) {
    var n = 0, sum = 0;
    list.forEach(function (r) { var c = Number(r.응답수), s = Number(r.종합); if (c > 0 && isFinite(s)) { n += c; sum += s * c; } });
    return { n: n, avg: n ? round2(sum / n) : null };
  }

  /* ---------- 편성에서 강사 찾기 ---------- */
  function normSubject(s) { return String(s == null ? '' : s).replace(/[\s·ㆍ.,()\[\]]/g, '').toLowerCase(); }
  /* sessions: 한 과정(개설키)의 교과목시간표 줄들. 반환: 교과목(정규화) → [{id,name,main}] */
  function subjectMap(sessions) {
    var map = {};
    sessions.forEach(function (s) {
      var id = String(s['강사ID'] || '').trim();
      if (!id) return;
      var k = normSubject(s['교과목']);
      if (!k) return;
      var role = String(s['강사 역할'] || '').trim();
      var o = map[k] || (map[k] = { label: String(s['교과목']), list: [] });
      var f = o.list.filter(function (x) { return x.id === id; })[0];
      if (!f) o.list.push({ id: id, name: String(s['강사명'] || ''), main: role !== '보조강사' });
      else if (role !== '보조강사') f.main = true;
    });
    return map;
  }
  /* 결과: {state:'auto'|'ambiguous'|'none', picks:[{id,name}], label} */
  function matchInstructor(map, subject) {
    var o = map[normSubject(subject)];
    if (!o) return { state: 'none', picks: [], label: '' };
    var mains = o.list.filter(function (x) { return x.main; });
    if (mains.length === 1) return { state: 'auto', picks: [{ id: mains[0].id, name: mains[0].name }], label: o.label };
    return { state: 'ambiguous', picks: o.list.map(function (x) { return { id: x.id, name: x.name }; }), label: o.label };
  }
  /* ---------- 강사명 우선 연결 ----------
   * names: 머리글에서 읽은 이름 조각(교과목명·강사명, 순서 무관). 먼저 편성의 강사 이름과 맞춰 보고, 안 맞으면 교과목명으로 맞춤.
   * 결과: {state:'auto'|'ambiguous'|'none', picks:[{id,name}], label(교과목명), how:'강사명'|'교과목'|''} */
  function normPerson(s) {
    return normSubject(String(s || '').replace(/\s*(교수님|강사님|선생님|교수|강사|박사|님)\s*$/, ''));
  }
  function resolveGroup(sessions, names) {
    names = (names || []).filter(Boolean);
    var map = subjectMap(sessions);
    var people = {};   // 강사ID → {id,name,subjects:[라벨]}
    sessions.forEach(function (s) {
      var id = String(s['강사ID'] || '').trim();
      if (!id || String(s['강사 역할'] || '').trim() === '보조강사') return;
      var o = people[id] || (people[id] = { id: id, name: String(s['강사명'] || ''), subjects: [] });
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
      if (narrowed.length === 1) return { state: 'auto', picks: [{ id: narrowed[0].id, name: narrowed[0].name }], label: label, how: '강사명', fileSubject: fileSubject };
      return { state: 'ambiguous', picks: narrowed.map(function (p) { return { id: p.id, name: p.name }; }), label: label, how: '강사명', fileSubject: fileSubject };
    }
    var m = matchInstructor(map, names.join(' '));
    if (m.state === 'none' && names.length > 1) {
      for (var i = 0; i < names.length && m.state === 'none'; i++) m = matchInstructor(map, names[i]);
    }
    m.how = m.state === 'none' ? '' : '교과목';
    return m;
  }
  /* 설문 열 제목 목록용: 과정 편성의 (교과목, 강사) 쌍을 날짜·교시 순으로, 주강사만 */
  function surveyPairs(sessions) {
    var rows = sessions.filter(function (s) { return String(s['강사ID'] || '').trim() && String(s['교과목'] || '').trim() && String(s['강사 역할'] || '').trim() !== '보조강사'; })
      .sort(function (a, b) { return (String(a['일자']) + ('0' + a['시작교시']).slice(-2)).localeCompare(String(b['일자']) + ('0' + b['시작교시']).slice(-2)); });
    var seen = {}, out = [];
    rows.forEach(function (s) {
      var k = normSubject(s['교과목']) + '|' + String(s['강사ID']);
      if (!seen[k]) { seen[k] = 1; out.push({ subject: String(s['교과목']), id: String(s['강사ID']), name: String(s['강사명'] || '') }); }
    });
    return out;
  }
  function surveyHeader(pairs) {
    var h = ['타임스탬프'];
    pairs.forEach(function (p) { ['태도', '목표', '전달', '효과', '의견'].forEach(function (q) { h.push(p.subject + ' | ' + p.name + ' | ' + q); }); });
    return h;
  }

  function allInstructors(sessions) {
    var seen = {}, out = [];
    sessions.forEach(function (s) {
      var id = String(s['강사ID'] || '').trim();
      if (id && !seen[id]) { seen[id] = 1; out.push({ id: id, name: String(s['강사명'] || '') }); }
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

  var api = {
    MIN_SESSION: MIN_SESSION, MIN_CUM: MIN_CUM, Q: Q,
    parseCSV: parseCSV, answerScore: answerScore, classifyHeader: classifyHeader, detectGroups: detectGroups,
    aggregate: aggregate, stars: stars, starPct: starPct, to50: to50, cumulative: cumulative,
    normSubject: normSubject, subjectMap: subjectMap, matchInstructor: matchInstructor, allInstructors: allInstructors, resolveGroup: resolveGroup, surveyPairs: surveyPairs, surveyHeader: surveyHeader,
    checkCounts: checkCounts, round2: round2
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EvalCore = api;
})(typeof window !== 'undefined' ? window : this);
