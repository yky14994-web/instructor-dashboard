/* 주 메뉴 스와이프 이동 — 공통 스크립트 (태블릿·휴대폰 터치 전용)
 * 홈 · 강의배정 · 강사관리 · 강의실 · 관리자 화면에서, 화면을 손가락으로 좌우로 길게 밀면 상단 주 메뉴의 이전/다음 메뉴로 이동한다.
 * 충돌 위험이 있는 경우에는 작동하지 않는다:
 *   - 가로로 스크롤되는 영역(격자·표 등) 안에서 시작한 동작, 입력창·선택창·슬라이더 위에서 시작한 동작
 *   - 팝업(오버레이)이 열려 있을 때, 입력 중(포커스·작성한 내용 있음)일 때, 글자를 선택 중일 때, 확대(핀치) 상태일 때
 *   - 화면 가장자리(브라우저 뒤로 가기 제스처 영역)에서 시작한 동작, 세로 움직임이 큰 동작, 느린 동작
 * 이동은 상단 메뉴 링크를 누르는 것과 같다(별도 주소 규칙 없음). 이 파일이 로드되지 않아도 화면 동작에는 영향이 없다. */
(function () {
  'use strict';
  if (window.__swipeNav) return;
  window.__swipeNav = true;

  var MIN_DX = 90;        // 가로 최소 이동(px)
  var MAX_DY = 60;        // 세로 최대 이동(px)
  var MAX_MS = 700;       // 최대 소요 시간
  var EDGE = 28;          // 화면 좌우 가장자리 제외 폭(px)
  var start = null;

  function items() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('.gnav .gnav-i'), function (el) {
      if (el.classList.contains('off') || el.getAttribute('aria-disabled') === 'true') return;
      if (!el.getClientRects().length) return;   // 숨겨진 메뉴(관리자 로그인 전의 '관리자' 등)는 건너뜀
      out.push(el);
    });
    return out;
  }
  function label(el) { return String(el.textContent || '').replace(/준비 중/, '').trim(); }

  function toast(t) {
    try {
      var d = document.createElement('div');
      d.textContent = t;
      d.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);background:rgba(16,38,63,.92);color:#fff;padding:9px 16px;border-radius:999px;font-size:13px;font-weight:700;z-index:100001;pointer-events:none;font-family:inherit;';
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 900);
    } catch (e) {}
  }

  function shown(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
  }

  /* 팝업(오버레이)이 열려 있는지 */
  function overlayOpen() {
    var list = document.querySelectorAll('[id$="Overlay"],[id$="Backdrop"],#tvOv,[style*="z-index:99999"],[style*="z-index: 99999"]');
    for (var i = 0; i < list.length; i++) if (shown(list[i])) return true;
    return false;
  }

  /* 입력 중: 포커스가 입력칸에 있거나, 교과목 편성 폼에 작성한 내용이 있으면 이동하지 않음 */
  function typing() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    var fp = document.getElementById('sFormPanel');
    if (fp && shown(fp)) {
      var f = fp.querySelectorAll('input[type=text],input:not([type]),input[type=search],textarea');
      for (var i = 0; i < f.length; i++) if (String(f[i].value || '').trim()) return true;
    }
    return false;
  }

  /* 시작 위치가 가로 스크롤 영역·입력 요소·드래그 영역 안인지 */
  function blockedTarget(t) {
    var el = t && t.nodeType === 1 ? t : (t && t.parentElement);
    while (el && el !== document.body && el !== document.documentElement) {
      var tag = el.tagName;
      if (/^(INPUT|TEXTAREA|SELECT|CANVAS|IFRAME|VIDEO|AUDIO)$/.test(tag) || el.isContentEditable) return true;
      if (el.classList && (el.classList.contains('gscroll') || el.hasAttribute('data-noswipe'))) return true;
      var cs = window.getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2) return true;
      el = el.parentElement;
    }
    return false;
  }

  function zoomed() { return !!(window.visualViewport && window.visualViewport.scale > 1.02); }
  function selecting() { try { return String(window.getSelection && window.getSelection().toString() || '').length > 0; } catch (e) { return false; } }

  document.addEventListener('touchstart', function (e) {
    start = null;
    if (!e.touches || e.touches.length !== 1) return;
    var t = e.touches[0], w = window.innerWidth || document.documentElement.clientWidth;
    if (t.clientX < EDGE || t.clientX > w - EDGE) return;
    if (blockedTarget(e.target) || overlayOpen() || typing() || zoomed() || selecting()) return;
    start = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) start = null;
  }, { passive: true });

  document.addEventListener('touchcancel', function () { start = null; }, { passive: true });

  document.addEventListener('touchend', function (e) {
    var s = start; start = null;
    if (!s || !e.changedTouches || !e.changedTouches.length) return;
    var t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Date.now() - s.t > MAX_MS) return;
    if (Math.abs(dx) < MIN_DX || Math.abs(dy) > MAX_DY || Math.abs(dy) > Math.abs(dx) * 0.5) return;
    if (overlayOpen() || typing() || selecting() || zoomed()) return;
    var list = items(), cur = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].classList.contains('on')) { cur = i; break; }
    if (cur < 0) return;
    var to = dx < 0 ? cur + 1 : cur - 1;   // 왼쪽으로 밀면 다음 메뉴, 오른쪽으로 밀면 이전 메뉴
    if (to < 0) { toast('첫 번째 메뉴입니다'); return; }
    if (to >= list.length) { toast('마지막 메뉴입니다'); return; }
    try { list[to].click(); } catch (er) {}   // 안내 문구 없이 바로 이동(문구가 깜빡이며 보이는 문제 방지). 끝 메뉴일 때만 문구 표시
  }, { passive: true });
})();
