/* AI 맞춤 강사 정보(선택 입력) — 강사 등록·초대 등록·강의자료 제출(신규 강사) 화면 공용
 * 사용: <div id="aiProfile"></div> + <script src="ai-profile.js"></script>
 *       window.AIProfile.values() → 서버로 보낼 값 { 교과목명, 전문분야상세, 강의키워드, 교육대상경험, 강의방식, 대표강의경력, 출강불가시기 }
 *       출강 불가 시기 입력은 unavail.js(window.Unavail)가 그림 → 이 파일보다 먼저 불러올 것
 * 모든 항목은 선택. 성명·연락처 등 식별 정보는 이 묶음에 넣지 않음(추천에는 강사ID와 이 정보만 사용하는 것을 전제로 함) */
(function () {
  var FIELDS = ['화재진압', '구조', '구급·응급의료', '화재조사', '예방·안전점검', '소방시설', '위험물', '재난·상황관리',
    '소방차량·장비', '체력·안전관리', '법령·행정', '리더십·조직관리', '심리·스트레스', '인문·소양', '디지털·AI', '안전교육·교수법'];
  var TARGETS = ['신규임용자', '재직자(실무자)', '지휘관·관리자', '의용소방대', '일반 국민', '장애인·어린이·노인'];
  var METHODS = ['이론 강의', '실습·실기', '사례·토론', '시뮬레이션·VR', '현장 견학'];

  var css =
    '.aip-card .aip-lead{background:#F2F6FB;border:1px solid #D5E1EF;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.65;color:#1B3A5F;margin-bottom:14px;}' +
    '.aip-card .aip-lead b{font-weight:800;}' +
    '.aip-card .aip-more{border:none;background:none;padding:0;margin-left:6px;font-family:inherit;font-size:12.5px;font-weight:700;color:#1B3A5F;text-decoration:underline;cursor:pointer;}' +
    '.aip-card .aip-detail{display:none;margin-top:6px;font-weight:400;}' +
    '.aip-card .aip-lead.open .aip-detail{display:block;}' +
    '.aip-card .aip-opt{display:inline-block;font-size:11px;font-weight:700;color:#5F6B7A;background:#EEF1F4;border-radius:999px;padding:1px 8px;margin-left:6px;vertical-align:middle;}' +
    '.aip-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;}' +
    '.aip-chip{position:relative;}' +
    '.aip-chip input{position:absolute;opacity:0;width:1px;height:1px;}' +
    '.aip-chip span{display:inline-flex;align-items:center;height:32px;padding:0 12px;border:1px solid #C9D2DC;border-radius:999px;font-size:13px;color:#3C4650;background:#fff;cursor:pointer;user-select:none;}' +
    '.aip-chip input:checked + span{background:#1B3A5F;border-color:#1B3A5F;color:#fff;font-weight:700;}' +
    '.aip-chip input:focus-visible + span{outline:2px solid #1B3A5F;outline-offset:2px;}' +
    '.aip-card .aip-sub{font-size:12px;color:#6B7580;margin-top:4px;}';

  function chips(name, list) {
    return '<div class="aip-chips" role="group">' + list.map(function (v, i) {
      var id = 'aip_' + name + '_' + i;
      return '<label class="aip-chip" for="' + id + '"><input type="checkbox" id="' + id + '" name="aip_' + name + '" value="' + v + '"><span>' + v + '</span></label>';
    }).join('') + '</div>';
  }
  function picked(name) {
    return Array.prototype.map.call(document.querySelectorAll('input[name="aip_' + name + '"]:checked'), function (x) { return x.value; });
  }
  function val(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
  function splitList(s) { return s.split(/[,，、\n]+/).map(function (x) { return x.trim(); }).filter(Boolean); }

  function render(box) {
    if (!document.getElementById('aipCss')) { var st = document.createElement('style'); st.id = 'aipCss'; st.textContent = css; document.head.appendChild(st); }
    box.classList.add('card', 'aip-card');
    box.innerHTML =
      '<div class="card-title">강의 전문 정보 <span class="aip-opt">모두 선택 입력</span></div>' +
      '<div class="aip-lead" id="aipLead"><b>AI 맞춤 강사 추천에 쓰이는 정보입니다.</b>' +
        '<button type="button" class="aip-more" id="aipMore" aria-expanded="false">자세히</button>' +
        '<div class="aip-detail">전남소방학교는 앞으로 교과목을 편성할 때 강의 내용에 맞는 강사님을 찾는 <b>AI 맞춤 추천</b>을 도입할 예정입니다. ' +
        '아래 정보를 자세히 적어 주실수록 강사님의 전문 분야에 맞는 강의를 의뢰드릴 수 있습니다.<br>' +
        '입력하지 않으셔도 등록에는 지장이 없으며, 추천에는 이름·연락처 같은 개인 식별 정보를 쓰지 않습니다.</div></div>' +
      '<div class="field"><label>전문 분야 <span class="aip-opt">여러 개 선택</span></label>' + chips('field', FIELDS) +
        '<input type="text" id="aipFieldEtc" maxlength="100" placeholder="그 밖의 분야(직접 입력, 쉼표로 구분)" style="margin-top:8px;"></div>' +
      '<div class="field"><label for="aipSubject">강의 가능 교과목</label>' +
        '<input type="text" id="aipSubject" maxlength="300" placeholder="예 : 화재조사실무, 전기화재 감식 (여러 개는 쉼표로 구분)">' +
        '<div class="aip-sub">교과목 이름을 적어 주시면 같은 교과목을 편성할 때 먼저 찾아봅니다.</div></div>' +
      '<div class="field"><label for="aipKeywords">강의 키워드</label>' +
        '<input type="text" id="aipKeywords" maxlength="300" placeholder="예 : 리튬배터리 화재, 감식기법, 현장 사례 (쉼표로 구분)"></div>' +
      '<div class="field"><label>강의해 본 교육 대상 <span class="aip-opt">여러 개 선택</span></label>' + chips('target', TARGETS) + '</div>' +
      '<div class="field"><label>강의 방식 <span class="aip-opt">여러 개 선택</span></label>' + chips('method', METHODS) + '</div>' +
      '<div class="field"><label for="aipCareer">대표 강의 경력</label>' +
        '<textarea id="aipCareer" maxlength="600" placeholder="한 줄에 하나씩 · 기관 / 교과목 / 연도&#10;예 : 중앙소방학교 / 화재조사실무 / 2025"></textarea></div>' +
      '<div class="field" style="margin-bottom:0;"><label>출강이 어려운 기간·요일</label>' +
        '<div id="aipUnav"></div>' +
        '<div class="aip-sub">적어 주신 기간·요일에는 강의를 의뢰드리지 않도록 참고합니다.</div></div>';
    var more = document.getElementById('aipMore');
    if (more) more.addEventListener('click', function () {
      var lead = document.getElementById('aipLead'), on = !lead.classList.contains('open');
      lead.classList.toggle('open', on); more.setAttribute('aria-expanded', on ? 'true' : 'false'); more.textContent = on ? '접기' : '자세히';
    });
    unavEd = window.Unavail ? window.Unavail.mountEditor(document.getElementById('aipUnav'), 'aipU', '', true) : null;
  }
  var unavEd = null;

  window.AIProfile = {
    mount: function (id) { var box = document.getElementById(id || 'aiProfile'); if (box) render(box); },
    values: function () {
      var fields = picked('field').concat(splitList(val('aipFieldEtc')));
      return {
        교과목명: splitList(val('aipSubject')).join(', '),
        전문분야상세: fields.join(', '),
        강의키워드: splitList(val('aipKeywords')).join(', '),
        교육대상경험: picked('target').join(', '),
        강의방식: picked('method').join(', '),
        대표강의경력: val('aipCareer').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 5).join(' | '),
        출강불가시기: unavEd ? unavEd.value() : ''
      };
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.AIProfile.mount(); });
  else window.AIProfile.mount();
})();
