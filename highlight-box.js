/* 화면 강조 사각형 — 공통 스크립트 (PC 마우스 전용)
 * 마우스 오른쪽 버튼을 누른 채 끌면 빨간 사각형이 그려지고, 버튼을 놓으면 즉시 사라진다(화면에 흔적 없음).
 * 충돌 방지:
 *   - 마우스 오른쪽 버튼만 사용 → 왼쪽 클릭·글자 선택·터치(스와이프)에는 관여하지 않음
 *   - 사각형은 클릭을 통과시킴(pointer-events:none), 놓는 순간 요소 자체를 삭제
 *   - 짧게 우클릭(5px 미만 이동)하면 기존 우클릭 메뉴가 그대로 나옴. 끌었을 때만 메뉴를 막음
 *   - 창 밖으로 나가거나, 다른 창으로 전환하거나, 전체화면이 바뀌면 자동 삭제
 * 이 파일이 로드되지 않아도 화면 동작에는 영향이 없다. */
(function () {
  'use strict';
  if (window.__hlBox) return;
  window.__hlBox = true;

  var MIN_MOVE = 5;      // 이 거리(px) 이상 끌어야 사각형 표시
  var start = null;      // { x, y, id }
  var box = null;
  var blockMenu = false;

  function host() { return document.fullscreenElement || document.webkitFullscreenElement || document.body; }

  function clear() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    start = null;
  }

  function draw(x, y) {
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;box-sizing:border-box;' +
        'border:3px solid #e11d48;border-radius:4px;background:rgba(225,29,72,.08);' +
        'box-shadow:0 0 0 1px rgba(255,255,255,.85);pointer-events:none;z-index:2147483646;';
      host().appendChild(box);
    }
    box.style.left = Math.min(start.x, x) + 'px';
    box.style.top = Math.min(start.y, y) + 'px';
    box.style.width = Math.abs(x - start.x) + 'px';
    box.style.height = Math.abs(y - start.y) + 'px';
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 2) return;
    clear();
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (err) {}
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!start || e.pointerId !== start.id) return;
    if (!(e.buttons & 2)) { clear(); return; }   // 놓은 신호를 놓친 경우
    if (!box && Math.abs(e.clientX - start.x) < MIN_MOVE && Math.abs(e.clientY - start.y) < MIN_MOVE) return;
    draw(e.clientX, e.clientY);
  }, true);

  document.addEventListener('pointerup', function (e) {
    if (!start || e.pointerId !== start.id) return;
    if (box) {
      blockMenu = true;
      setTimeout(function () { blockMenu = false; }, 400);
    }
    clear();
  }, true);

  document.addEventListener('contextmenu', function (e) {
    if (blockMenu) { e.preventDefault(); blockMenu = false; }
  }, true);

  document.addEventListener('pointercancel', clear, true);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  document.addEventListener('fullscreenchange', clear);
  document.addEventListener('webkitfullscreenchange', clear);
})();
