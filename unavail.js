/* 출강 불가 시기(선택 입력) — 강사등록·초대·제출·강사관리·강의배정 공용
 * 저장 형식(시트 '출강불가시기' 열 한 칸): 규칙을 ' | '로 이음, 최대 3개
 *   규칙 = <기간> <요일> <시간>
 *   기간 : 'YYYY-MM-DD~YYYY-MM-DD' | 'YYYY-MM-DD~' | '~YYYY-MM-DD' | '상시'
 *   요일 : '월,화' (월~일) | '모든요일'
 *   시간 : '종일' | '오전'(1~3교시) | '오후'(4교시~)
 *   예   : '상시 화,목 종일 | 2026-03-01~2026-06-30 수 오전'
 * 기간이 끝난 규칙은 자동으로 무시(경고·추천에 쓰지 않음). 기간과 요일이 모두 비면 규칙으로 인정하지 않음 */
(function () {
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일'];
  var TIMES = { 종일: '종일', 오전: '오전(1~3교시)', 오후: '오후(4교시~)' };
  var AM_LAST = 3;   // 오전 = 1~3교시, 오후 = 4교시부터
  var MAX = 3;
  var RE_D = /^\d{4}-\d{2}-\d{2}$/;

  function today() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);   // 한국 시간 기준 날짜
    return d.toISOString().slice(0, 10);
  }
  function validDate(s) {
    if (!RE_D.test(s)) return false;
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function normRule(r) {
    var from = validDate(r.from || '') ? r.from : '', to = validDate(r.to || '') ? r.to : '';
    if (from && to && from > to) { var t = from; from = to; to = t; }
    var days = DAY_ORDER.filter(function (x) { return (r.days || []).indexOf(x) > -1; });
    var time = TIMES[r.time] ? r.time : '종일';
    if (!from && !to && !days.length) return null;
    return { from: from, to: to, days: days, time: time };
  }
  function parse(str) {
    return String(str || '').split('|').map(function (part) {
      var t = part.trim().split(/\s+/);
      if (t.length < 3) return null;
      var per = t[0], from = '', to = '';
      if (per !== '상시') { var m = per.match(/^(\d{4}-\d{2}-\d{2})?~(\d{4}-\d{2}-\d{2})?$/); if (!m) return null; from = m[1] || ''; to = m[2] || ''; }
      var days = t[1] === '모든요일' ? [] : t[1].split(',');
      return normRule({ from: from, to: to, days: days, time: t[2] });
    }).filter(Boolean).slice(0, MAX);
  }
  function format(rules) {
    return (rules || []).map(normRule).filter(Boolean).slice(0, MAX).map(function (r) {
      var per = (r.from || r.to) ? (r.from + '~' + r.to) : '상시';
      return per + ' ' + (r.days.length ? r.days.join(',') : '모든요일') + ' ' + r.time;
    }).join(' | ');
  }
  function expired(r, base) { return !!(r.to && r.to < (base || today())); }
  function md(s) { var p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function ymdText(s, base) { return s.slice(0, 4) === (base || today()).slice(0, 4) ? md(s) : s.slice(0, 4) + '.' + md(s); }
  /* 사람이 읽는 한 줄: '항상 · 화·목 · 종일', '3/1~6/30 · 수 · 오전(1~3교시)' */
  function text(r) {
    var per = (r.from || r.to) ? ((r.from ? ymdText(r.from) : '') + '~' + (r.to ? ymdText(r.to) : '')) : '항상';
    return per + ' · ' + (r.days.length ? r.days.join('·') + '요일' : '모든 요일') + ' · ' + TIMES[r.time];
  }
  /* 강의 일자·교시가 불가 규칙에 걸리면 걸린 규칙 목록을 돌려줌(끝난 규칙은 날짜로 자연히 제외) */
  function hits(str, ymd, s, e) {
    if (!str || !validDate(String(ymd || ''))) return [];
    var p = ymd.split('-').map(Number), dow = DAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
    s = Number(s) || 0; e = Number(e) || s;
    return parse(str).filter(function (r) {
      if (r.from && ymd < r.from) return false;
      if (r.to && ymd > r.to) return false;
      if (r.days.length && r.days.indexOf(dow) < 0) return false;
      if (r.time === '오전' && s && s > AM_LAST) return false;
      if (r.time === '오후' && e && e <= AM_LAST) return false;
      return true;
    });
  }
  function activeRules(str) { return parse(str).filter(function (r) { return !expired(r); }); }

  /* ---- 입력 편집기 (prefix로 여러 개를 한 화면에 둘 수 있음) ---- */
  var css =
    '.uv-row{position:relative;border:1px solid #D5DCE4;border-radius:8px;padding:10px 12px;margin-top:8px;background:#FAFBFC;}' +
    '.uv-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px;font-size:13px;color:#3C4650;}' +
    '.uv-line:last-child{margin-bottom:0;}' +
    '.uv-line .uv-k{width:34px;font-weight:700;color:#5F6B7A;font-size:12.5px;}' +
    '.uv-line input[type=date]{height:34px;border:1px solid #C9D2DC;border-radius:6px;padding:0 8px;font-family:inherit;font-size:13px;background:#fff;width:auto;max-width:150px;}' +
    '.uv-line select{height:34px;border:1px solid #C9D2DC;border-radius:6px;padding:0 8px;font-family:inherit;font-size:13px;background:#fff;width:auto;}' +
    '.uv-day{position:relative;}' +
    '.uv-day input{position:absolute;opacity:0;width:1px;height:1px;}' +
    '.uv-day span{display:inline-flex;align-items:center;justify-content:center;width:34px;height:32px;border:1px solid #C9D2DC;border-radius:999px;font-size:13px;color:#3C4650;background:#fff;cursor:pointer;user-select:none;}' +
    '.uv-day input:checked + span{background:#1B3A5F;border-color:#1B3A5F;color:#fff;font-weight:700;}' +
    '.uv-day input:focus-visible + span{outline:2px solid #1B3A5F;outline-offset:2px;}' +
    '.uv-btn{height:32px;padding:0 12px;border:1px solid #C9D2DC;border-radius:6px;background:#fff;color:#3C4650;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;}' +
    '.uv-del{position:absolute;top:10px;right:10px;height:28px;padding:0 10px;font-size:12px;}' +
    '.uv-row .uv-line:first-child{padding-right:56px;}' +
    '@media (max-width:480px){.uv-row .uv-line:first-child{padding-right:0;}.uv-line .uv-k{width:100%;line-height:28px;}.uv-line input[type=date]{flex:1;min-width:0;max-width:none;}.uv-day span{width:32px;}.uv-line{gap:4px;}}' +
    '.uv-sub{font-size:12px;color:#6B7580;margin-top:6px;line-height:1.5;}';
  function ensureCss() {
    if (document.getElementById('uvCss')) return;
    var st = document.createElement('style'); st.id = 'uvCss'; st.textContent = css; document.head.appendChild(st);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rowHtml(px, i, r) {
    r = r || { from: '', to: '', days: [], time: '종일' };
    return '<div class="uv-row" data-uvrow="' + i + '">' +
      '<div class="uv-line"><span class="uv-k">기간</span>' +
        '<input type="date" data-uv="from" value="' + esc(r.from) + '" aria-label="불가 기간 시작일"> ~ ' +
        '<input type="date" data-uv="to" value="' + esc(r.to) + '" aria-label="불가 기간 종료일"></div>' +
        '<button type="button" class="uv-btn uv-del" data-uvdel="' + i + '">삭제</button>' +
      '<div class="uv-line"><span class="uv-k">요일</span>' + DAY_ORDER.map(function (d, k) {
        var id = px + '_d' + i + '_' + k;
        return '<label class="uv-day" for="' + id + '"><input type="checkbox" id="' + id + '" data-uv="day" value="' + d + '"' + (r.days.indexOf(d) > -1 ? ' checked' : '') + '><span>' + d + '</span></label>';
      }).join('') + '</div>' +
      '<div class="uv-line"><span class="uv-k">시간</span><select data-uv="time" aria-label="불가 시간">' + Object.keys(TIMES).map(function (k) {
        return '<option value="' + k + '"' + (r.time === k ? ' selected' : '') + '>' + TIMES[k] + '</option>';
      }).join('') + '</select></div>' +
    '</div>';
  }
  /* box 안에 편집기를 그림. 처음 값(str)이 비어 있고 folded=true면 [입력하기] 한 줄만 보여 줌 */
  function mountEditor(box, px, str, folded) {
    ensureCss();
    var rules = parse(str);
    var open = !folded || rules.length > 0;
    function readRows() {
      return Array.prototype.map.call(box.querySelectorAll('.uv-row'), function (row) {
        return {
          from: row.querySelector('[data-uv=from]').value, to: row.querySelector('[data-uv=to]').value,
          days: Array.prototype.map.call(row.querySelectorAll('[data-uv=day]:checked'), function (x) { return x.value; }),
          time: row.querySelector('[data-uv=time]').value
        };
      });
    }
    function draw(list) {
      if (!open) {
        box.innerHTML = '<button type="button" class="uv-btn" data-uvopen="1">+ 입력하기</button>';
        box.querySelector('[data-uvopen]').addEventListener('click', function () { open = true; draw([null]); });
        return;
      }
      if (!list.length) list = [null];
      box.innerHTML = list.map(function (r, i) { return rowHtml(px, i, r ? (normRule(r) || r) : null); }).join('') +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">' +
          (list.length < MAX ? '<button type="button" class="uv-btn" data-uvadd="1">+ 한 줄 더</button>' : '') +
        '</div>' +
        '<div class="uv-sub">기간만 적으면 그 기간 전체, 요일만 고르면 매주 그 요일입니다.</div>';
      var add = box.querySelector('[data-uvadd]');
      if (add) add.addEventListener('click', function () { var cur = readRows(); cur.push(null); draw(cur); });
      Array.prototype.forEach.call(box.querySelectorAll('[data-uvdel]'), function (b) {
        b.addEventListener('click', function () {
          var cur = readRows(); cur.splice(Number(b.getAttribute('data-uvdel')), 1);
          if (!cur.length && folded) { open = false; draw([]); } else draw(cur);
        });
      });
    }
    draw(rules);
    return { value: function () { return open ? format(readRows()) : ''; } };
  }

  window.Unavail = { parse: parse, format: format, text: text, hits: hits, expired: expired, activeRules: activeRules, mountEditor: mountEditor, AM_LAST: AM_LAST };
})();
