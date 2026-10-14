/* 상단 주 메뉴의 '관리자' 항목 표시 — 관리자 비밀번호로 로그인한 경우에만 보이게 함(조회 전용 계정에는 숨김).
 * 로그인은 화면 안에서 이뤄지므로, 로그인 상태(sessionStorage의 역할 값)를 주기적으로 확인한다. 이 파일이 없어도 다른 기능에는 영향이 없다. */
(function () {
  'use strict';
  var el = document.getElementById('navAdmin');
  if (!el) return;
  function sync() {
    var admin = false;
    try { admin = sessionStorage.getItem('jsfa_dash_role') === 'admin'; } catch (e) {}
    el.style.display = admin ? '' : 'none';
  }
  sync();
  setInterval(sync, 1500);
  document.addEventListener('visibilitychange', sync);
})();
