/* ===== 테마 (다크 글래스 / 라이트 글래스) =====
 * - 저장된 선택이 없으면 OS(브라우저) 시스템 테마를 따름
 * - 좌측 하단 토글로 전환하면 localStorage 에 저장
 * - <head> 에서 동기 로드해 첫 화면 깜빡임(FOUC) 방지
 */
(function () {
    var KEY = 'oneproqa-theme';
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function getStored() {
        try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }
    function setStored(v) {
        try { localStorage.setItem(KEY, v); } catch (e) { /* 저장 불가 환경 무시 */ }
    }
    function systemTheme() {
        return mq && mq.matches ? 'dark' : 'light';
    }
    function apply(theme) {
        var root = document.documentElement;
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
        var btn = document.getElementById('themeToggle');
        if (btn) {
            btn.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
            var label = btn.querySelector('.theme-toggle-text');
            if (label) label.textContent = theme === 'dark' ? '다크 모드' : '라이트 모드';
        }
    }

    // 최초 적용 (body 렌더 전)
    apply(getStored() || systemTheme());

    // 시스템 테마 변경 감지: 사용자가 직접 고르지 않았을 때만 따라감
    if (mq) {
        var onChange = function () { if (!getStored()) apply(systemTheme()); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    window.toggleTheme = function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        setStored(next);
        apply(next);
    };

    // 토글 버튼 상태 동기화 (DOM 준비 후)
    document.addEventListener('DOMContentLoaded', function () {
        apply(document.documentElement.getAttribute('data-theme') || systemTheme());

        // 사이드바: 메뉴를 클릭하면 즉시 접힘 (데스크탑)
        // 마우스가 레일을 벗어나면 다시 호버로 펼칠 수 있게 해제
        var sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        sidebar.addEventListener('click', function (e) {
            var item = e.target.closest('.nav-item, .side-brand');
            if (!item || window.innerWidth < 768) return;
            sidebar.classList.add('force-collapse');
            if (item.blur) item.blur();
        });
        sidebar.addEventListener('mouseleave', function () {
            sidebar.classList.remove('force-collapse');
        });
    });
})();
