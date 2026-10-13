/* 처리 중 표시(버튼 스피너) — 공통 스크립트
 * 기존 화면 코드는 수정하지 않고, 서버 처리 중인 버튼에만 회전 표시를 붙인다.
 *  1) 비활성 상태이고 글자가 "…중...", "…중…", "저장 중 3 / 60" 형태인 버튼
 *  2) 방금(60초 이내) 누른 버튼이 비활성으로 바뀐 경우(글자 변경 없이 잠그는 버튼)
 * 버튼이 다시 활성화되면 표시를 자동으로 없앤다. 이 파일이 로드되지 않아도 화면 동작에는 영향이 없다. */
(function () {
  'use strict';
  if (window.__busyIndicator) return;
  window.__busyIndicator = true;

  try {
    var st = document.createElement('style');
    st.textContent =
      '@keyframes busySpin{to{transform:rotate(360deg)}}' +
      '.btn-busy::before{content:"";display:inline-block;box-sizing:border-box;width:.95em;height:.95em;' +
      'margin-right:.5em;vertical-align:-.14em;border:2px solid currentColor;border-right-color:transparent;' +
      'border-radius:50%;animation:busySpin .8s linear infinite;}' +
      '.btn-busy{cursor:progress;}' +
      '@media (prefers-reduced-motion:reduce){.btn-busy::before{animation:none;border-style:dotted;border-right-color:currentColor;}}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  var TXT = /(중\s*(\.{2,3}|…))|(중\s*\d+\s*\/\s*\d+)/;
  var lastBtn = null, lastAt = 0, MAX_AGE = 60000;

  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (b) { lastBtn = b; lastAt = Date.now(); }
  }, true);

  function update(b) {
    if (!b || b.tagName !== 'BUTTON') return;
    var busy = false;
    if (b.disabled) {
      if (TXT.test(b.textContent || '')) busy = true;
      else if (b === lastBtn && Date.now() - lastAt < MAX_AGE) busy = true;
      else if (b.classList.contains('btn-busy')) busy = true;
    }
    if (busy) {
      if (!b.classList.contains('btn-busy')) {
        b.classList.add('btn-busy');
        b.setAttribute('aria-busy', 'true');
        if (!b.title) { b.title = '처리 중입니다. 잠시만 기다려 주세요.'; b.setAttribute('data-busy-title', '1'); }
      }
    } else if (b.classList.contains('btn-busy')) {
      b.classList.remove('btn-busy');
      b.removeAttribute('aria-busy');
      if (b.getAttribute('data-busy-title')) { b.removeAttribute('title'); b.removeAttribute('data-busy-title'); }
    }
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'BUTTON') update(node);
    if (node.querySelectorAll) {
      var list = node.querySelectorAll('button:disabled');
      for (var i = 0; i < list.length; i++) update(list[i]);
    }
  }

  function start() {
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i], t = m.target;
          if (m.type === 'attributes') { update(t); continue; }
          if (m.type === 'characterData') t = t.parentNode;
          if (t && t.closest) update(t.closest('button'));
          if (m.type === 'childList') for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
        }
      }).observe(document.documentElement, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['disabled']
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
