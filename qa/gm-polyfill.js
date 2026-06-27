/**
 * GM_* API 폴리필 — Tampermonkey 유저스크립트를 일반 브라우저 페이지에서 실행하기 위한 목 구현
 */
(function () {
    const store = {};

    window.GM_setValue = function (key, value) {
        store[key] = JSON.parse(JSON.stringify(value));
    };

    window.GM_getValue = function (key, defaultValue) {
        return key in store ? JSON.parse(JSON.stringify(store[key])) : defaultValue;
    };

    window.GM_addStyle = function (css) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    };

    window.GM_xmlhttpRequest = function (opts) {
        // 테스트 환경에서는 외부 API를 호출하지 않음
        if (opts.onerror) opts.onerror({ status: 0, responseText: 'GM_xmlhttpRequest is mocked' });
    };

    // 테스트에서 현재 store 상태 확인용 헬퍼
    window.__GM_getStore = function () {
        return JSON.parse(JSON.stringify(store));
    };

    window.__GM_clearStore = function () {
        Object.keys(store).forEach(k => delete store[k]);
    };
})();
