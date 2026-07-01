// ==UserScript==
// @name         SOOP 타임라인 에디터
// @namespace    http://tampermonkey.net/
// @version      10.2
// @description  5000자 기준 자동/수동 페이지 분할로 대용량 렉 전면 박멸, 입력 디바운스·rAF 드래그 성능 최적화, Cmd(Alt)+Backspace 즉시 삭제 및 스마트 단축키 커스텀 집대성 버전
// @author       소해999
// @match        https://vod.sooplive.com/player/*
// @match        https://vod.sooplive.co.kr/player/*
// @match        https://vod.afreecatv.com/player/*
// @match        https://play.sooplive.com/*
// @match        https://play.sooplive.co.kr/*
// @match        https://play.afreecatv.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.m.sooplive.com
// ==/UserScript==

(function () {
    'use strict';

    // --- 1. OS 및 현재 페이지 모드(VOD / LIVE) 판별 ---
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
    const mainModKeyText = isMac ? 'Cmd' : 'Alt';
    const isLiveMode = window.location.href.includes('play.sooplive') || window.location.href.includes('play.afreecatv');

    // --- 2. 단축키 순정 기본값 매핑 정의 부문 ---
    const defaultHotkeys = {
        addTimestamp: { ctrl: false, alt: !isMac, shift: false, meta: isMac, key: 'Enter', label: '타임스탬프 추가/완료' },
        addTextTimestamp: { ctrl: false, alt: !isMac, shift: true, meta: isMac, key: 'Enter', label: '텍스트 타임스탬프 추가' },
        scrollTop: { ctrl: false, alt: !isMac, shift: false, meta: isMac, key: 'ArrowUp', label: '창 맨 위로 스크롤' },
        scrollBottom: { ctrl: false, alt: !isMac, shift: false, meta: isMac, key: 'ArrowDown', label: '창 맨 아래로 스크롤' },
        timeMinus1: { ctrl: false, alt: false, shift: false, meta: false, key: '[', label: '선택 항목 -1초 가감' },
        timePlus1: { ctrl: false, alt: false, shift: false, meta: false, key: ']', label: '선택 항목 +1초 가감' },
        timeMinus5: { ctrl: false, alt: false, shift: true, meta: false, key: '{', label: '선택 항목 -5초 대폭 가감' },
        timePlus5: { ctrl: false, alt: false, shift: true, meta: false, key: '}', label: '선택 항목 +5초 대폭 가감' },
        tabDepth: { ctrl: false, alt: false, shift: false, meta: false, key: 'Tab', label: '들여쓰기 늘리기/줄이기(Shift)' }
    };

    let hotkeys = GM_getValue('soop_global_hotkeys_v9_5', JSON.parse(JSON.stringify(defaultHotkeys)));
    if (!hotkeys.addTextTimestamp) hotkeys.addTextTimestamp = defaultHotkeys.addTextTimestamp;
    // 보조 단축키: 기본(primary) 단축키는 고정하고, 이 목록의 키를 추가로 눌러도 동일 기능이 발동한다. tabDepth는 지원하지 않음.
    const defaultSecondaryHotkeys = {
        addTimestamp: { ctrl: false, alt: false, shift: false, meta: false, key: 'y', code: 'KeyY' },
        addTextTimestamp: { ctrl: false, alt: false, shift: true, meta: false, key: 'Y', code: 'KeyY' }
    };
    let secondaryHotkeys = GM_getValue('soop_global_hotkeys_secondary_v1', JSON.parse(JSON.stringify(defaultSecondaryHotkeys)));

    // --- 3. 🌟 2차원 데이터 레이어 로드 및 구조 마이그레이션 가드 ---
    let skipSeconds = GM_getValue('soop_global_skip_seconds', 5);
    let liveOffsetSeconds = GM_getValue('soop_global_live_offset', 0);
    const initialEmojiPreset = ["💜", "💛", "💙", "🩷", "🩵", "💚"];
    let customEmojis = GM_getValue('soop_global_custom_emojis', initialEmojiPreset);

    // 하위 호환 마이그레이션 로직 포함 수집 처리
    let rawStoredTimelines = GM_getValue('soop_global_timelines', []);
    let storedPageStructure = GM_getValue('soop_global_page_structure_v9_5', null);

    if (!storedPageStructure) {
        // 기존 1차원 유저 데이터가 존재할 경우, 유실 없이 1페이지 리스트로 안전하게 흡수 격리
        storedPageStructure = {
            currentPageIdx: 0,
            pages: [
                { pageName: "댓글 1", list: Array.isArray(rawStoredTimelines) ? rawStoredTimelines : [] }
            ]
        };
        GM_setValue('soop_global_page_structure_v9_5', storedPageStructure);
    }

    let pageState = storedPageStructure;
    let activeVideo = null;
    let lastFocusedInput = null;
    let currentFocusedIdx = -1;
    let recordingHotkeyAction = null;
    let lastPlainEnterTime = 0; // 타임스탬프 완료: 조합키 없는 Enter를 빠르게 두 번 누르면 완료 처리 (고정 동작, 단축키 커스텀 대상 아님)

    // --- 파트 오프셋 상태 ---
    let partOffsets = [0];
    let partDurations = [];
    let currentPartIdx = 0;
    let pendingSeekAbsSec = null; // 크로스-파트 seek 대기 중인 절대 시간(초)

    // 현재 선택된 active 타임라인 리스트 단축 가리키기 포인터
    function getActiveList() {
        if (!pageState.pages[pageState.currentPageIdx]) {
            pageState.currentPageIdx = 0;
            if (pageState.pages.length === 0) { pageState.pages.push({ pageName: "댓글 1", list: [] }); }
        }
        return pageState.pages[pageState.currentPageIdx].list;
    }

    function savePageState() {
        GM_setValue('soop_global_page_structure_v9_5', pageState);
    }

    function debounce(fn, ms) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    }
    const debouncedSave = debounce(savePageState, 800);
    const debouncedUpdateCounter = debounce(() => updateCounterUI(), 200);

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function autoResizeTextarea(el) {
        el.style.height = '0';
        el.style.height = el.scrollHeight + 'px';
    }

    function getHotkeyString(hk) {
        const parts = [];
        if (hk.ctrl) parts.push('Ctrl');
        if (hk.alt) parts.push(isMac ? 'Option' : 'Alt');
        if (hk.shift) parts.push('Shift');
        if (hk.meta) parts.push(isMac ? 'Cmd' : 'Win');
        parts.push(hk.key === ' ' ? 'Space' : hk.key);
        return parts.join(' + ');
    }

    function isHotkeyMatch(hk, e) {
        if (!hk) return false;
        // 한/영 키 전환과 무관하게 매칭: code(물리적 키 위치)가 저장돼 있으면 우선 사용, 없으면 key로 폴백(구버전 저장 데이터 호환)
        const keyMatches = hk.code ? (e.code === hk.code) : (e.key.toLowerCase() === hk.key.toLowerCase());
        const basicMatch = keyMatches &&
            (e.ctrlKey === hk.ctrl) && (e.shiftKey === hk.shift) &&
            (isMac ? (e.metaKey === hk.meta) : (e.altKey === hk.alt));
        if (!basicMatch) return false;
        // Shift만으로는 실제 조합키로 보지 않음: Shift+문자키는 대문자 입력과 동일한 형태라 타이핑 보호 대상에 포함
        const noRealMods = !hk.ctrl && !hk.alt && !hk.meta;
        const isTextTarget = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
        const isPrintableChar = hk.code ? /^(Key|Digit)/.test(hk.code) : hk.key.length === 1;
        if (noRealMods && isPrintableChar && isTextTarget) return false; // 입력창 타이핑 보호: 문자/숫자 키(+Shift)는 입력 중 무시
        return true;
    }

    function matchesAction(actionKey, e) {
        if (actionKey === 'tabDepth') return isHotkeyMatch(hotkeys[actionKey], e); // tabDepth는 보조 단축키 미지원
        return isHotkeyMatch(hotkeys[actionKey], e) || isHotkeyMatch(secondaryHotkeys[actionKey], e);
    }

    function refreshSecondaryCell(actionKey) {
        const kbd = document.getElementById(`kbd-text-secondary-${actionKey}`);
        if (!kbd) return;
        const hk = secondaryHotkeys[actionKey];
        kbd.innerText = hk ? getHotkeyString(hk) : '미설정';
        const clearBtn = document.querySelector(`.tl-kbd-btn-clear[data-action="${actionKey}"]`);
        if (clearBtn) clearBtn.style.display = hk ? '' : 'none';
    }

    function matchPartByDuration(dur) {
        if (!dur || isNaN(dur) || partDurations.length === 0) return;
        let bestIdx = 0, bestDiff = Infinity;
        for (let i = 0; i < partDurations.length; i++) {
            const diff = Math.abs(dur - partDurations[i]);
            if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        if (bestDiff >= 10) return;
        currentPartIdx = bestIdx;

        // 크로스-파트 seek 대기 중이면 처리
        if (pendingSeekAbsSec === null || !activeVideo) return;
        const targetIdx = getTargetPartIdx(pendingSeekAbsSec);
        if (targetIdx === currentPartIdx) {
            // 목표 파트 도달: 상대 시간으로 seek
            activeVideo.currentTime = Math.max(0, pendingSeekAbsSec - (partOffsets[currentPartIdx] || 0));
            pendingSeekAbsSec = null;
        } else if (targetIdx > currentPartIdx) {
            // 아직 앞 파트 더 필요: 새 파트 안정 후 끝으로 이동해 순방향 전환 체인
            const vid = activeVideo;
            setTimeout(() => {
                if (pendingSeekAbsSec !== null && activeVideo === vid) {
                    const d = vid.duration;
                    if (!d || !isFinite(d)) return;
                    vid.currentTime = d;
                    if (vid.paused) vid.play().catch(() => { });
                }
            }, 500);
        } else {
            // 이전 파트 더 필요: 파트 시작(0) → ← 키로 역방향 전환 체인
            const vid = activeVideo;
            setTimeout(() => {
                if (pendingSeekAbsSec !== null && activeVideo === vid) {
                    triggerPartReverse(vid, pendingSeekAbsSec);
                }
            }, 500);
        }
    }

    function attachPartDetector(video) {
        video.addEventListener('loadstart', () => {
            if (isLiveMode || partDurations.length === 0) return;
            video.addEventListener('loadedmetadata', () => {
                matchPartByDuration(video.duration);
            }, { once: true });
        });
    }

    function initVideoFinder() {
        function handleNewVideo(video) {
            if (video === activeVideo) return;
            activeVideo = video;
            if (!isLiveMode) {
                // 이미 메타데이터가 로드된 상태면 즉시 파트 인덱스 동기화
                if (video.readyState >= 1) {
                    matchPartByDuration(video.duration);
                } else if (partDurations.length > 0) {
                    // 아직 메타데이터 로드 전: loadedmetadata를 직접 대기
                    video.addEventListener('loadedmetadata', () => matchPartByDuration(video.duration), { once: true });
                }
            }
            attachPartDetector(video);
        }

        // 초기 video 감지
        const initial = document.querySelector('video');
        if (initial) handleNewVideo(initial);

        // MutationObserver: SOOP이 파트 전환 시 새 <video> 엘리먼트 생성하는 경우 즉시 감지
        // (1s interval보다 빠르게 반응해 loadedmetadata를 놓치지 않음)
        const observer = new MutationObserver(() => {
            const video = document.querySelector('video');
            if (video && video !== activeVideo) handleNewVideo(video);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        // interval 폴백: MutationObserver가 놓친 경우 대비
        setInterval(() => {
            const video = document.querySelector('video');
            if (video && video !== activeVideo) handleNewVideo(video);
        }, 1000);
    }

    function getCurrentPartOffset() {
        return partOffsets[currentPartIdx] || 0;
    }

    function getTargetPartIdx(absoluteSec) {
        let idx = 0;
        for (let i = partOffsets.length - 1; i >= 0; i--) {
            if (absoluteSec >= partOffsets[i]) { idx = i; break; }
        }
        return idx;
    }

    function trySeekViaSOOPBar(absoluteSec) {
        const totalDuration = partOffsets[partOffsets.length - 1] + (partDurations[partDurations.length - 1] || 0);
        if (totalDuration <= 0) return false;
        const ratio = Math.min(1, Math.max(0, absoluteSec / totalDuration));

        // 1. input[type=range] 중 max 값이 전체 시간(초 또는 ms)과 일치하는 엘리먼트 탐색
        const allRanges = document.querySelectorAll('input[type=range]');
        for (const inp of allRanges) {
            const maxVal = parseFloat(inp.max);
            if (!maxVal) continue;
            const isMs = Math.abs(maxVal - totalDuration * 1000) < totalDuration * 50; // ms scale (5% tolerance)
            const isSec = Math.abs(maxVal - totalDuration) < totalDuration * 0.05;     // sec scale
            if (!isMs && !isSec) continue;
            inp.value = isMs ? absoluteSec * 1000 : absoluteSec;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        // 2. 고정 셀렉터 후보 (div/span 기반 커스텀 시크바)
        const barSelectors = ['.vod-progress-bar', '.seekBar', '#seekBar', '.player-progress',
            '[class*="progressBar"]', '[class*="seekbar" i]', '[class*="seek-bar" i]'];
        for (const sel of barSelectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10) continue;
            const cx = rect.left + rect.width * ratio;
            const cy = rect.top + rect.height / 2;
            ['mousedown', 'mouseup', 'click'].forEach(t =>
                el.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: cx, clientY: cy }))
            );
            return true;
        }
        return false;
    }

    function dispatchSOOPArrowKey(dir) {
        const key = dir === 'right' ? 'ArrowRight' : 'ArrowLeft';
        const keyCode = dir === 'right' ? 39 : 37;
        const opts = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
        const target = activeVideo?.closest('[class*="player"]') || activeVideo?.parentElement || document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', opts));
        target.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    function triggerPartAdvance(vid, targetAbsSec) {
        pendingSeekAbsSec = targetAbsSec;
        const d = vid.duration;
        if (!d || !isFinite(d)) return;
        // duration 끝으로 seek → play() 호출 시 ended가 즉시 발생해 SOOP이 다음 파트 로드
        vid.currentTime = d;
        if (vid.paused) vid.play().catch(() => { });
    }

    function triggerPartReverse(vid, targetAbsSec) {
        pendingSeekAbsSec = targetAbsSec;
        // 현재 파트 시작으로 이동 후 ← 키 → SOOP이 이전 파트로 이동
        vid.currentTime = 0;
        setTimeout(() => dispatchSOOPArrowKey('left'), 300);
    }

    function seekToTime(absoluteSec) {
        if (!activeVideo) return;

        const targetPartIdx = getTargetPartIdx(absoluteSec);
        const relativeTime = absoluteSec - (partOffsets[targetPartIdx] || 0);

        if (targetPartIdx === currentPartIdx || partDurations.length === 0) {
            pendingSeekAbsSec = null;
            const relTime = Math.max(0, relativeTime);
            if (activeVideo.duration && relTime > activeVideo.duration) {
                if (!trySeekViaSOOPBar(absoluteSec)) triggerPartAdvance(activeVideo, absoluteSec);
            } else {
                activeVideo.currentTime = relTime;
            }
            return;
        }

        // 크로스-파트 seek: SOOP 시크바 먼저 시도
        if (trySeekViaSOOPBar(absoluteSec)) return;

        if (targetPartIdx > currentPartIdx) {
            // 순방향: ended 이벤트로 파트 전환 체인
            triggerPartAdvance(activeVideo, absoluteSec);
        } else {
            // 역방향: 현재 파트 시작(0) → ← 키 → SOOP 이전 파트 진입 → 체인 반복
            triggerPartReverse(activeVideo, absoluteSec);
        }
    }

    function initPartOffsets() {
        if (isLiveMode) return;
        const titleMatch = window.location.href.match(/\/player\/(\d+)/);
        if (!titleMatch) return;
        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://api.m.sooplive.com/station/video/a/view',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: `nTitleNo=${titleMatch[1]}`,
            onload(resp) {
                try {
                    const files = JSON.parse(resp.responseText)?.data?.files;
                    if (Array.isArray(files) && files.length > 1) {
                        let cum = 0;
                        const offsets = [], durations = [];
                        for (const f of files) {
                            offsets.push(cum);
                            const dur = (f.duration || 18000000) / 1000;
                            durations.push(dur);
                            cum += dur;
                        }
                        partOffsets = offsets;
                        partDurations = durations;
                    }
                } catch (e) { }
            },
            onerror() { } // 18000초 폴백: 파트 전환 시 onLoadStart에서 자동 확장
        });
    }

    // 🌟 가공 복사 시 오직 '현재 활성화된 페이지 내부' 텍스트만 조율 연산
    function buildExportText() {
        const activeList = getActiveList();
        return activeList.map(item => {
            const currentDepth = item.depth || 0;
            const lines = item.text.split('\n');
            const prefix = currentDepth === 0 ? '' : 'ㅤ'.repeat(currentDepth - 1) + 'ㄴ';

            return lines.map((line, idx) => {
                if (idx === 0) return item.isText ? `${prefix}${line}` : `${prefix}${item.timeStr} ${line}`;
                const fallbackSpace = currentDepth === 0 ? 'ㅤㅤㅤㅤㅤㅤㅤㅤㅤ' : 'ㅤ'.repeat(currentDepth - 1) + 'ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ';
                return `${fallbackSpace}${line}`;
            }).join('\n');
        }).join('\n');
    }

    // 🌟 글자 수 카운팅 및 댓글 용량 트래커 연산 대상도 현재 페이지로 격리
    function calculateTextMetrics() {
        const textResult = buildExportText();
        return { length: textResult.length, comments: Math.ceil(textResult.length / 5000) };
    }

    function updateCounterUI() {
        const metrics = calculateTextMetrics();
        counterDisplay.innerText = `${metrics.length}/5000 (현재 페이지)`;
        const colorClass = metrics.length >= 4000 ? 'cnt-red' : metrics.length >= 3000 ? 'cnt-orange' : 'cnt-green';
        counterDisplay.className = `tl-counter ${colorClass}`;
        renderPageTabs();
    }

    // --- 드래그 유틸 엔진 ---
    function makeElementDraggable(targetElement, handleClassName, isMainSidebar = false) {
        const dragHandle = targetElement.querySelector('.' + handleClassName);
        if (!dragHandle) return;

        if (isMainSidebar) {
            targetElement.style.right = '20px'; targetElement.style.top = '100px'; targetElement.style.left = 'auto';
        } else {
            const modalWidth = 420; const modalHeight = targetElement.offsetHeight || 320;
            targetElement.style.left = ((window.innerWidth - modalWidth) / 2) + 'px';
            targetElement.style.top = ((window.innerHeight - modalHeight) / 2) + 'px';
        }

        let isDragging = false; let offsetX = 0; let offsetY = 0; let rafPending = false;

        dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            if (isMainSidebar && targetElement.style.right !== 'auto') {
                const rect = targetElement.getBoundingClientRect();
                targetElement.style.left = rect.left + 'px'; targetElement.style.top = rect.top + 'px'; targetElement.style.right = 'auto';
            }
            offsetX = e.clientX - targetElement.offsetLeft; offsetY = e.clientY - targetElement.offsetTop;
            document.body.style.userSelect = 'none'; e.preventDefault(); e.stopPropagation();
        }, true);

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return; e.preventDefault();
            if (!rafPending) { rafPending = true; requestAnimationFrame(() => { targetElement.style.left = (e.clientX - offsetX) + 'px'; targetElement.style.top = (e.clientY - offsetY) + 'px'; rafPending = false; }); }
        }, true);
        window.addEventListener('mouseup', (e) => { if (isDragging) { isDragging = false; document.body.style.userSelect = ''; e.stopPropagation(); } }, true);
    }

    // --- 4. 스타일 시트 주입 ---
    GM_addStyle(`
        #tl-sidebar {
            position: fixed; width: 390px; height: 620px;
            background: #18181c; color: #eeeeee; border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 999999;
            display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            border: 1px solid #2f2f37; transition: height 0.2s, width 0.2s;
        }
        #tl-sidebar.minimized { height: 45px !important; width: 240px !important; overflow: hidden; }
        #tl-sidebar.minimized .tl-page-nav-bar, #tl-sidebar.minimized .tl-toolbar, #tl-sidebar.minimized .tl-body, #tl-sidebar.minimized .tl-footer { display: none !important; }
        
        .tl-header { padding: 14px; background: #22222a; border-top-left-radius: 12px; border-top-right-radius: 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #2f2f37; }
        .tl-counter { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; min-width: 140px; text-align: center; box-sizing: border-box; }
        .tl-counter.cnt-green  { color: #00b074; background: rgba(0,176,116,0.12); }
        .tl-counter.cnt-orange { color: #ff9030; background: rgba(255,144,48,0.12); }
        .tl-counter.cnt-red    { color: #e54444; background: rgba(229,68,68,0.12); }
        .tl-mode-badge { font-size: 10px; padding: 2px 5px; border-radius: 4px; font-weight: bold; margin-left: 4px; }
        .tl-mode-badge.live { background: #e54444; color: white; }
        .tl-mode-badge.vod { background: #00b074; color: white; }
        .tl-header-actions { display: flex; gap: 8px; align-items: center; }
        .tl-action-icon { cursor: pointer; font-size: 12px; user-select: none; color: #a0a0a5; padding: 2px; }
        .tl-action-icon:hover { color: #00b074; }
        
        /* 🌟 새로 추가된 시원시원한 페이지 네비게이션 스타일 레이어 */
        .tl-page-nav-bar { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: #1a1a22; border-bottom: 1px solid #2f2f37; gap: 6px; }
        .tl-page-arrow-btn { background: #2a2a34; border: 1px solid #3a3a46; color: #ccc; font-weight: bold; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
        .tl-page-arrow-btn:hover { background: #3a3a46; color: white; }
        .tl-page-central-display { flex: 1; text-align: center; font-size: 12px; font-weight: bold; color: #00b074; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; background: #111115; padding: 4px 2px; border-radius: 4px; border: 1px solid #23232a; }
        .tl-page-add-trigger { background: #00b074; color: white; border: none; font-size: 11px; font-weight: bold; padding: 5px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
        .tl-page-add-trigger:hover { background: #008f5e; }
        .tl-page-del-trigger { background: transparent; border: 1px solid #555; color: #e06060; font-size: 13px; padding: 3px 7px; border-radius: 4px; cursor: pointer; line-height: 1; }
        .tl-page-del-trigger:hover { background: #3a1a1a; border-color: #e06060; }

        .tl-toolbar { padding: 8px 12px; background: #1f1f24; border-bottom: 1px solid #2f2f37; display: flex; align-items: center; min-height: 32px; justify-content: center; }
        .tl-emoji-container { display: flex; gap: 6px; align-items: center; flex: 1; overflow-x: auto; white-space: nowrap; }
        .tl-emoji-container::-webkit-scrollbar { height: 4px; }
        .tl-emoji-container::-webkit-scrollbar-thumb { background: #3a3a44; border-radius: 2px; }
        .tl-emoji-btn { background: #2a2a32; border: 1px solid #3a3a44; color: white; padding: 5px 9px; border-radius: 6px; font-size: 13px; cursor: pointer; user-select: none; display: inline-block; }
        .tl-emoji-btn:hover { background: #3a3a44; border-color: #00b074; }
        
        .tl-time-panel-wrapper { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px; }
        .tl-adjust-group { display: flex; gap: 4px; background: #18181c; padding: 2px; border-radius: 6px; border: 1px solid #2f2f37; }
        .tl-adj-btn { background: #22222a; border: none; color: #ff9999; font-size: 11px; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .tl-adj-btn.plus { color: #99ff99; }
        .tl-adj-btn:hover { background: #3a3a44; }
        .tl-toolbar-btn-group { display: flex; gap: 4px; align-items: center; justify-content: center; flex: 1; }
        .tl-btn-huge-modify { background: #00b074; color: white; border: none; font-size: 11px; font-weight: bold; padding: 5px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2); user-select: none; }
        .tl-btn-huge-modify:hover { background: #008f5e; }
        .tl-btn-all-select { background: #3a3a44; color: #ffbc00; border: 1px solid #4a4a55; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; user-select: none; }
        .tl-btn-all-select:hover { background: #4a4a55; color: #ffcc22; }
        .tl-btn-type-toggle { background: #3a3a44; color: #a0c8ff; border: 1px solid #4a4a55; font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; user-select: none; }
        .tl-btn-type-toggle:hover { background: #4a4a55; color: #c0d8ff; }

        .tl-body { flex: 1; overflow-y: auto; padding: 12px; }
        .tl-row { display: flex; align-items: flex-start; margin-bottom: 6px; gap: 6px; padding: 4px; border-radius: 6px; transition: background-color 0.1s; }
        .tl-depth-0 { padding-left: 4px; }
        .tl-depth-1 { padding-left: 24px; border-left: 2px dashed #3a3a44; }
        .tl-depth-2 { padding-left: 44px; border-left: 2px dashed #4a4a55; }
        .tl-depth-3 { padding-left: 64px; border-left: 2px dashed #00b074; }
        .tl-row.tl-selected, .tl-row.tl-focused { background-color: rgba(0, 176, 116, 0.15) !important; border-right: 3px solid #00b074; }
        
        .tl-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: #00b074; margin-top: 6px; }
        .tl-time-btn { background: #00b074; color: white; border: none; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600; white-space: nowrap; user-select: none; margin-top: 2px; }
        .tl-time-btn:hover { background: #008f5e; }
        .tl-time-btn.live-btn { background: #4e4e56; cursor: default; }
        .tl-time-btn.text-mode { background: #4e4e56; color: #999; cursor: pointer; }
        .tl-time-btn.text-mode:hover { background: #5e5e68; }

        .tl-input { 
            flex: 1; background: #232329; border: 1px solid #3a3a44; color: white; 
            padding: 5px 10px; border-radius: 6px; font-size: 13px; 
            resize: none; font-family: inherit; line-height: 1.4; height: 20px; min-height: 20px; overflow-y: hidden;
        }
        .tl-input:focus { border-color: #00b074; outline: none; }
        #tl-sidebar button:focus, #tl-sidebar input[type="checkbox"]:focus { outline: none; }
        .tl-del-btn { background: #e54444; border: none; color: white; border-radius: 6px; cursor: pointer; padding: 5px 8px; font-size: 11px; user-select: none; margin-top: 2px; }
        .tl-del-btn:hover { background: #bd3232; }
        
        .tl-footer { padding: 12px; background: #22222a; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; display: flex; gap: 6px; border-top: 1px solid #2f2f37; align-items: center; }
        .tl-btn-main { flex: 2; background: #00b074; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px; }
        .tl-btn-main:hover { background: #008f5e; }
        .tl-btn-sub { flex: 1; background: #3a3a44; color: white; border: none; padding: 10px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; }
        .tl-btn-sub:hover { background: #2f2f37; }
        .tl-btn-danger { background: #5a2424; color: #ff9999; border: 1px solid #733333; }
        .tl-btn-danger:hover { background: #bd3232; color: white; }
        
        .tl-modal-mask { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); z-index: 2000000; }
        .tledit-popup-box { 
            position: fixed !important; background: #22222a !important; color: white !important; padding: 20px !important; border-radius: 12px !important; 
            width: 420px !important; max-height: 85vh !important; display: flex !important; flex-direction: column !important; 
            border: 1px solid #3a3a44 !important; box-shadow: 0 10px 30px rgba(0,0,0,0.6) !important; z-index: 99999999 !important;
            right: auto !important; bottom: auto !important;
        }
        .tledit-popup-header-area { border-bottom: 1px solid #3a3a44; padding-bottom: 10px; margin-bottom: 15px; user-select: none; position: relative; min-height: 20px; }
        .tledit-popup-title-text { font-size: 16px; font-weight: bold; color: white; display: inline-block; cursor: move !important; width: 100%; }
        
        .tl-emoji-highlight-input { background: rgb(24, 45, 35) !important; border: 1px solid rgb(50, 85, 65) !important; color: #ffffff !important; font-weight: 500 !important; transition: border-color 0.15s, background-color 0.15s; }
        .tl-emoji-highlight-input:focus { border-color: #00b074 !important; background: rgb(20, 55, 40) !important; outline: none !important; }
        
        .tl-help-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; line-height: 1.5; }
        .tl-help-table th, .tl-help-table td { padding: 8px 10px; border-bottom: 1px solid #3a3a44; text-align: left; color: white; }
        .tl-help-table th { color: #00b074; font-weight: bold; background: #1c1c24; }
        .tl-help-kbd { background: #4e4e56; color: white; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; box-shadow: 0 1px 2px rgba(0,0,0,0.4); margin-right: 2px; }
        .tl-kbd-btn-change { background: #00b074; color: white; border: none; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; float: right; }
        .tl-kbd-btn-change.recording { background: #e54444 !important; animation: tl-blink 1s infinite; }
        .tl-hotkey-secondary-cell { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .tl-kbd-btn-clear { background: #4e4e56; color: white; border: none; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; cursor: pointer; }
        #tl-help-modal { width: 520px !important; }
        @keyframes tl-blink { 50% { opacity: 0.5; } }

        .tl-modal-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid #3a3a44; }
        .tl-h-input-grid { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
        .tl-h-time-box { background: #232329; border: 1px solid #3a3a44; color: white; padding: 6px 8px; border-radius: 6px; font-size: 13px; width: 56px; text-align: center; }
        .tl-h-time-box:focus { border-color: #00b074; outline: none; }
        .tl-h-select { background: #232329; border: 1px solid #3a3a44; color: white; padding: 6px 8px; border-radius: 6px; font-size: 13px; cursor: pointer; }
    `);

    // --- 5. UI 레이아웃 빌드 ---
    const sidebar = document.createElement('div');
    sidebar.id = 'tl-sidebar';
    const modeBadgeHtml = isLiveMode
        ? '<span class="tl-mode-badge live">LIVE</span>'
        : '<span class="tl-mode-badge vod">VOD</span>';
    sidebar.innerHTML = `
        <div class="tl-header">
            <span style="font-size:13px; font-weight:bold; cursor:move; user-select:none;">🗒 타임라인 에디터</span>
            <div class="tl-header-actions">
                ${modeBadgeHtml}
                <span id="tl-char-counter" class="tl-counter cnt-green">0/5000 (현재 페이지)</span>
                <span class="tl-action-icon" id="tl-btn-settings" title="설정">⚙️</span>
                <span class="tl-action-icon" id="tl-btn-help" title="단축키 도움말">❓</span>
                <span class="tl-action-icon" id="tl-btn-minimize" title="최소화">➖</span>
            </div>
        </div>
        <div id="tl-dynamic-toolbar" class="tl-toolbar"></div>
        <div id="tl-body" class="tl-body"></div>
        <div class="tl-footer">
            <button id="tl-btn-export" class="tl-btn-main">📋 복사</button>
            <button id="tl-btn-import" class="tl-btn-sub">📥 가져오기</button>
            <button id="tl-btn-clear" class="tl-btn-sub tl-btn-danger">🗑 삭제</button>
        </div>
    `;
    document.body.appendChild(sidebar);
    makeElementDraggable(sidebar, 'tl-header', true);
    sidebar.querySelector('#tl-btn-minimize').addEventListener('click', () => {
        sidebar.classList.toggle('minimized');
    });

    const mainDragWrapper = sidebar;
    const bodyContainer = sidebar.querySelector('#tl-body');
    const dynamicToolbar = sidebar.querySelector('#tl-dynamic-toolbar');
    const counterDisplay = sidebar.querySelector('#tl-char-counter');

    function showConfirmPopup(message, onConfirm) {
        document.getElementById('tl-confirm-mask')?.remove();
        document.getElementById('tl-confirm-modal')?.remove();

        const mask = document.createElement('div');
        mask.id = 'tl-confirm-mask';
        Object.assign(mask.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)', zIndex: '2147483645' });

        const modal = document.createElement('div');
        modal.id = 'tl-confirm-modal';
        Object.assign(modal.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#222', color: '#fff', borderRadius: '8px', padding: '20px 24px',
            zIndex: '2147483646', minWidth: '240px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            fontFamily: 'sans-serif', fontSize: '14px'
        });
        modal.innerHTML = `
            <div style="margin-bottom:10px;font-size:15px;">${message}</div>
            <div style="color:#aaa;font-size:12px;margin-bottom:14px;">예(Enter) / 아니오(Esc)</div>
            <div style="display:flex;gap:8px;justify-content:center;">
                <button id="tl-confirm-yes" style="padding:6px 18px;background:#4a9eff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">예</button>
                <button id="tl-confirm-no"  style="padding:6px 18px;background:#555;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">아니오</button>
            </div>
        `;

        function close() {
            mask.remove(); modal.remove();
            window.removeEventListener('keydown', keyHandler, true);
        }
        function confirm() { close(); onConfirm(); }

        function keyHandler(e) {
            if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); confirm(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
        }
        modal.querySelector('#tl-confirm-yes').addEventListener('click', confirm);
        modal.querySelector('#tl-confirm-no').addEventListener('click', close);
        mask.addEventListener('click', close);
        window.addEventListener('keydown', keyHandler, true);
        document.body.appendChild(mask);
        document.body.appendChild(modal);
        modal.querySelector('#tl-confirm-yes').focus();
    }

    function showNoticePopup(message) {
        document.getElementById('tl-notice-mask')?.remove();
        document.getElementById('tl-notice-modal')?.remove();
        const mask = document.createElement('div');
        mask.id = 'tl-notice-mask';
        Object.assign(mask.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.45)', zIndex: '2147483645' });
        const modal = document.createElement('div');
        modal.id = 'tl-notice-modal';
        Object.assign(modal.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#222', color: '#fff', borderRadius: '8px', padding: '20px 24px',
            zIndex: '2147483646', minWidth: '240px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            fontFamily: 'sans-serif', fontSize: '14px'
        });
        modal.innerHTML = `
            <div style="margin-bottom:10px;font-size:15px;">${message}</div>
            <div style="color:#aaa;font-size:12px;margin-bottom:14px;">Enter 또는 Esc로 닫기</div>
            <button id="tl-notice-close" style="padding:6px 18px;background:#4a9eff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;">확인</button>
        `;
        function close() { mask.remove(); modal.remove(); window.removeEventListener('keydown', kh, true); }
        function kh(e) { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } }
        modal.querySelector('#tl-notice-close').addEventListener('click', close);
        mask.addEventListener('click', close);
        window.addEventListener('keydown', kh, true);
        document.body.appendChild(mask);
        document.body.appendChild(modal);
        modal.querySelector('#tl-notice-close').focus();
    }

    function checkAndOverflowPage() {
        const metrics = calculateTextMetrics();
        if (metrics.length <= 5000) return;
        const activeList = getActiveList();
        if (activeList.length === 0) return;
        // 마지막 아이템을 다음 페이지로 이동
        const overflowItem = activeList.splice(activeList.length - 1, 1)[0];
        const nextIdx = pageState.currentPageIdx + 1;
        if (nextIdx >= pageState.pages.length) {
            pageState.pages.push({ pageName: `댓글 ${pageState.pages.length + 1}`, list: [] });
        }
        pageState.pages[nextIdx].list.push(overflowItem);
        pageState.pages[nextIdx].list.sort((a, b) => a.seconds - b.seconds);
        savePageState(); render(); refreshToolbarUI();
        showNoticePopup(`⚠️ 5000자를 초과하여 마지막 항목을 ${nextIdx + 1}페이지로 이동했습니다.`);
    }

    // 페이지 인디케이터 컨테이너 상단 윗줄 개설 주입
    const pageNavBar = document.createElement('div');
    pageNavBar.className = 'tl-page-nav-bar';
    sidebar.insertBefore(pageNavBar, dynamicToolbar);

    let pageTabsInitialized = false;
    let pageCentralDisplay = null;

    function renderPageTabs() {
        if (!pageTabsInitialized) {
            pageNavBar.innerHTML = `
                <button class="tl-page-arrow-btn" id="tl-page-btn-prev">◀</button>
                <div class="tl-page-central-display" id="tl-page-central"></div>
                <button class="tl-page-arrow-btn" id="tl-page-btn-next">▶</button>
                <button class="tl-page-add-trigger" id="tl-page-btn-add">➕ 페이지 추가</button>
                <button class="tl-page-del-trigger" id="tl-page-btn-del" title="현재 페이지 삭제">🗑</button>
            `;
            pageCentralDisplay = pageNavBar.querySelector('#tl-page-central');

            pageNavBar.querySelector('#tl-page-btn-prev').addEventListener('click', () => {
                if (pageState.currentPageIdx > 0) { pageState.currentPageIdx--; currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI(); }
            });
            pageNavBar.querySelector('#tl-page-btn-next').addEventListener('click', () => {
                if (pageState.currentPageIdx < pageState.pages.length - 1) { pageState.currentPageIdx++; currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI(); }
            });
            pageNavBar.querySelector('#tl-page-btn-add').addEventListener('click', () => {
                const nextNum = pageState.pages.length + 1;
                pageState.pages.push({ pageName: `댓글 ${nextNum}`, list: [] });
                pageState.currentPageIdx = pageState.pages.length - 1;
                currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI();
            });
            pageNavBar.querySelector('#tl-page-btn-del').addEventListener('click', () => {
                if (pageState.pages.length <= 1) return;
                showConfirmPopup('현재 페이지를 삭제하시겠습니까?', () => {
                    pageState.pages.splice(pageState.currentPageIdx, 1);
                    if (pageState.currentPageIdx >= pageState.pages.length) pageState.currentPageIdx = pageState.pages.length - 1;
                    currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI();
                });
            });
            pageTabsInitialized = true;
        }

        pageCentralDisplay.textContent = `PAGE: ${pageState.currentPageIdx + 1} / ${pageState.pages.length}`;
    }

    function refreshToolbarUI() {
        const activeList = getActiveList();
        const hasChecked = activeList.some(item => item.selected);
        const isAllChecked = activeList.length > 0 && activeList.every(item => item.selected);
        dynamicToolbar.innerHTML = '';

        if (hasChecked) {
            const panelWrapper = document.createElement('div');
            panelWrapper.className = 'tl-time-panel-wrapper';
            const toggleSelectText = isAllChecked ? '❌ 전체 해제' : '☑️ 전체선택';
            const selectedItems = activeList.filter(item => item.selected);
            const allSelectedAreText = selectedItems.length > 0 && selectedItems.every(item => item.isText);
            const typeToggleLabel = allSelectedAreText ? '⏱ 타임라인으로 변경' : '📝 텍스트로 변경';

            panelWrapper.innerHTML = `
                <div class="tl-adjust-group"><button class="tl-adj-btn" id="tl-dyn-m5">-5s</button><button class="tl-adj-btn" id="tl-dyn-m1">-1s</button></div>
                <div class="tl-toolbar-btn-group">
                    <button class="tl-btn-huge-modify" id="tl-dyn-huge">⏳ 일괄조정</button>
                    <button class="tl-btn-all-select" id="tl-dyn-all-toggle">${toggleSelectText}</button>
                    <button class="tl-btn-type-toggle" id="tl-dyn-type-toggle">${typeToggleLabel}</button>
                </div>
                <div class="tl-adjust-group"><button class="tl-adj-btn plus" id="tl-dyn-p1">+1s</button><button class="tl-adj-btn plus" id="tl-dyn-p2">+5s</button></div>
            `;
            dynamicToolbar.appendChild(panelWrapper);

            panelWrapper.querySelector('#tl-dyn-m5').addEventListener('click', () => modifyTimelineSeconds(-5));
            panelWrapper.querySelector('#tl-dyn-m1').addEventListener('click', () => modifyTimelineSeconds(-1));
            panelWrapper.querySelector('#tl-dyn-p1').addEventListener('click', () => modifyTimelineSeconds(1));
            panelWrapper.querySelector('#tl-dyn-p2').addEventListener('click', () => modifyTimelineSeconds(5));
            panelWrapper.querySelector('#tl-dyn-huge').addEventListener('click', () => openHugeModifyModal());
            panelWrapper.querySelector('#tl-dyn-all-toggle').addEventListener('click', () => {
                const nextState = !isAllChecked; activeList.forEach(item => item.selected = nextState); render(); refreshToolbarUI();
            });
            panelWrapper.querySelector('#tl-dyn-type-toggle').addEventListener('click', () => {
                const newIsText = !allSelectedAreText;
                selectedItems.forEach(item => { item.isText = newIsText; });
                savePageState(); render(); refreshToolbarUI();
                if (!newIsText) checkAndOverflowPage(); // 텍스트 → 타임라인 전환 시만 체크
            });
        } else {
            const emojiContainer = document.createElement('div');
            emojiContainer.className = 'tl-emoji-container';
            customEmojis.forEach(text => {
                const btn = document.createElement('span'); btn.className = 'tl-emoji-btn'; btn.innerText = text; emojiContainer.appendChild(btn);
            });
            dynamicToolbar.appendChild(emojiContainer);
        }
    }

    function render() {
        const currentScrollPosition = bodyContainer.scrollTop;
        const activeList = getActiveList();

        bodyContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const textareas = [];

        activeList.forEach((item, index) => {
            const row = document.createElement('div');
            const isFocused = (index === currentFocusedIdx);
            row.className = `tl-row tl-depth-${item.depth || 0} ${item.selected ? 'tl-selected' : ''} ${isFocused ? 'tl-focused' : ''}`;
            row.dataset.index = index;

            const btnClass = isLiveMode ? 'tl-time-btn live-btn' : (item.isText ? 'tl-time-btn text-mode' : 'tl-time-btn');
            row.innerHTML = `
                <input type="checkbox" class="tl-checkbox" ${item.selected ? 'checked' : ''}>
                <button class="${btnClass}" data-time="${item.seconds}">${item.timeStr}</button>
                <textarea class="tl-input" rows="1" placeholder="내용 입력...">${item.text}</textarea>
                <button class="tl-del-btn">X</button>
            `;
            fragment.appendChild(row);
            textareas.push(row.querySelector('.tl-input'));
        });

        bodyContainer.appendChild(fragment);

        // 배치 read/write: N번 → 1번 레이아웃
        textareas.forEach(ta => { ta.style.height = '0'; });
        const heights = textareas.map(ta => ta.scrollHeight);
        heights.forEach((h, i) => { textareas[i].style.height = h + 'px'; });

        debouncedSave();
        debouncedUpdateCounter();
        bodyContainer.scrollTop = currentScrollPosition;
    }

    function modifyTimelineSeconds(delta) {
        const activeList = getActiveList();
        const preOrder = activeList.map(item => item);

        activeList.forEach(item => {
            if (item.selected) { item.seconds = Math.max(0, (item.seconds || 0) + delta); item.timeStr = formatTime(item.seconds); }
        });
        activeList.sort((a, b) => a.seconds - b.seconds);

        const orderChanged = preOrder.some((item, i) => activeList[i] !== item);

        if (!orderChanged) {
            activeList.forEach((item, i) => {
                if (!item.selected) return;
                const rowEl = bodyContainer.querySelector(`.tl-row[data-index="${i}"]`);
                if (!rowEl) return;
                const btn = rowEl.querySelector('.tl-time-btn');
                if (btn) { btn.textContent = item.timeStr; btn.dataset.time = item.seconds; }
            });
            debouncedSave();
        } else {
            render();
        }
    }

    function openHugeModifyModal() {
        const activeList = getActiveList();
        const checkedCount = activeList.filter(item => item.selected).length; if (checkedCount === 0) return;
        const mask = document.createElement('div'); mask.className = 'tl-modal-mask';
        const modal = document.createElement('div'); modal.className = 'tledit-popup-box';
        modal.innerHTML = `
            <div class="tledit-popup-header-area"><span class="tledit-popup-title-text">⏳ 현재페이지 일괄 조정 (${checkedCount}개)</span></div>
            <div class="tl-h-input-grid">
                <select id="tl-h-sign" class="tl-h-select"><option value="plus">+</option><option value="minus">-</option></select>
                <input type="number" id="tl-h-hr" class="tl-h-time-box" value="0"> 시
                <input type="number" id="tl-h-mn" class="tl-h-time-box" value="0"> 분
                <input type="number" id="tl-h-sc" class="tl-h-time-box" value="0"> 초
            </div>
            <div class="tl-modal-footer"><button class="tl-btn-sub" id="tl-h-btn-cancel">취소</button><button class="tl-btn-main" id="tl-h-btn-apply">적용</button></div>
        `;
        document.body.appendChild(mask); document.body.appendChild(modal);
        makeElementDraggable(modal, 'tledit-popup-title-text', false);
        const cleanUp = () => { mask.remove(); modal.remove(); };
        modal.querySelector('#tl-h-btn-cancel').addEventListener('click', cleanUp);
        modal.querySelector('#tl-h-btn-apply').addEventListener('click', () => {
            const sign = modal.querySelector('#tl-h-sign').value;
            const hr = parseInt(modal.querySelector('#tl-h-hr').value || 0, 10);
            const mn = parseInt(modal.querySelector('#tl-h-mn').value || 0, 10);
            const sc = parseInt(modal.querySelector('#tl-h-sc').value || 0, 10);
            let totalDelta = (hr * 3600) + (mn * 60) + sc; if (sign === 'minus') totalDelta = -totalDelta;
            activeList.forEach(item => { if (item.selected) { item.seconds = Math.max(0, item.seconds + totalDelta); item.timeStr = formatTime(item.seconds); } });
            activeList.sort((a, b) => a.seconds - b.seconds); render(); refreshToolbarUI(); cleanUp();
        });
    }

    function addTimestamp() {
        if (!activeVideo) return alert('재생 중인 영상을 찾을 수 없습니다.');

        // 🌟 성능 증폭 가드: 만약 현재 페이지가 이미 5000 임계점을 돌파해 있다면 강제로 새 자동 페이지를 개설해 파킹
        const metrics = calculateTextMetrics();
        if (metrics.length >= 4950) {
            const nextIndex = pageState.pages.length + 1;
            pageState.pages.push({ pageName: `댓글 ${nextIndex}`, list: [] });
            pageState.currentPageIdx = pageState.pages.length - 1;
        }

        let currentSec = activeVideo.currentTime + getCurrentPartOffset(); let timeStr = formatTime(currentSec);
        if (isLiveMode) {
            const liveTimeElement = document.getElementById('time');
            if (liveTimeElement) {
                const parts = liveTimeElement.innerText.trim().split(':');
                if (parts.length === 3) {
                    let extractedSec = (parseInt(parts[0], 10) * 3600) + (parseInt(parts[1], 10) * 60) + parseInt(parts[2], 10);
                    currentSec = Math.max(0, extractedSec - liveOffsetSeconds); timeStr = formatTime(currentSec);
                }
            }
        }

        let defaultDepth = 0; const activeList = getActiveList();
        try {
            const tempArray = [...activeList, { seconds: currentSec }]; tempArray.sort((a, b) => a.seconds - b.seconds);
            const virtualIdx = tempArray.findIndex(item => item.seconds === currentSec && !item.timeStr);
            if (virtualIdx > 0) defaultDepth = tempArray[virtualIdx - 1].depth || 0;
        } catch (e) { }

        const virtualObject = { seconds: currentSec, timeStr: timeStr, text: '', depth: defaultDepth, selected: false };
        activeList.push(virtualObject); activeList.sort((a, b) => a.seconds - b.seconds);

        const foundRealIdx = activeList.findIndex(item => item === virtualObject); currentFocusedIdx = foundRealIdx;
        render(); refreshToolbarUI();

        setTimeout(() => {
            const rows = bodyContainer.querySelectorAll('.tl-row');
            if (rows[foundRealIdx]) { rows[foundRealIdx].querySelector('.tl-input').focus(); rows[foundRealIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        }, 50);
    }

    function addTextTimestamp() {
        if (!activeVideo) return alert('재생 중인 영상을 찾을 수 없습니다.');

        const metrics = calculateTextMetrics();
        if (metrics.length >= 4950) {
            const nextIndex = pageState.pages.length + 1;
            pageState.pages.push({ pageName: `댓글 ${nextIndex}`, list: [] });
            pageState.currentPageIdx = pageState.pages.length - 1;
        }

        let currentSec = activeVideo.currentTime + getCurrentPartOffset(); let timeStr = formatTime(currentSec);
        if (isLiveMode) {
            const liveTimeElement = document.getElementById('time');
            if (liveTimeElement) {
                const parts = liveTimeElement.innerText.trim().split(':');
                if (parts.length === 3) {
                    let extractedSec = (parseInt(parts[0], 10) * 3600) + (parseInt(parts[1], 10) * 60) + parseInt(parts[2], 10);
                    currentSec = Math.max(0, extractedSec - liveOffsetSeconds); timeStr = formatTime(currentSec);
                }
            }
        }

        let defaultDepth = 0; const activeList = getActiveList();
        try {
            const tempArray = [...activeList, { seconds: currentSec }]; tempArray.sort((a, b) => a.seconds - b.seconds);
            const virtualIdx = tempArray.findIndex(item => item.seconds === currentSec && !item.timeStr);
            if (virtualIdx > 0) defaultDepth = tempArray[virtualIdx - 1].depth || 0;
        } catch (e) { }

        const virtualObject = { seconds: currentSec, timeStr: timeStr, text: '', depth: defaultDepth, selected: false, isText: true };
        activeList.push(virtualObject); activeList.sort((a, b) => a.seconds - b.seconds);

        const foundRealIdx = activeList.findIndex(item => item === virtualObject); currentFocusedIdx = foundRealIdx;
        render(); refreshToolbarUI();

        setTimeout(() => {
            const rows = bodyContainer.querySelectorAll('.tl-row');
            if (rows[foundRealIdx]) { rows[foundRealIdx].querySelector('.tl-input').focus(); rows[foundRealIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        }, 50);
    }

    // --- 6. 이벤트 통합 리스너 설계 레이어 ---
    dynamicToolbar.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tl-emoji-btn')) return;
        const insertText = e.target.innerText; let inputTarget = lastFocusedInput;
        if (!inputTarget || !document.body.contains(inputTarget)) {
            const allInputs = bodyContainer.querySelectorAll('.tl-input'); if (allInputs.length > 0) inputTarget = allInputs[allInputs.length - 1];
        }
        if (inputTarget) {
            const startPos = inputTarget.selectionStart; const endPos = inputTarget.selectionEnd; const oldText = inputTarget.value;
            const newText = oldText.substring(0, startPos) + insertText + oldText.substring(endPos, oldText.length); inputTarget.value = newText;
            const row = inputTarget.closest('.tl-row');
            if (row) { getActiveList()[parseInt(row.dataset.index)].text = newText; savePageState(); }
            updateCounterUI(); inputTarget.focus(); autoResizeTextarea(inputTarget);
            const newCursorPos = startPos + insertText.length; inputTarget.setSelectionRange(newCursorPos, newCursorPos);
        }
    });

    bodyContainer.addEventListener('click', (e) => {
        const row = e.target.closest('.tl-row'); if (!row) return;
        const idx = parseInt(row.dataset.index); const activeList = getActiveList();

        if (e.target.classList.contains('tl-checkbox')) {
            const targetChecked = e.target.checked;
            const parentDepth = activeList[idx].depth || 0;
            activeList[idx].selected = targetChecked;
            const affectedIndices = [idx];
            for (let i = idx + 1; i < activeList.length; i++) {
                if ((activeList[i].depth || 0) > parentDepth) { activeList[i].selected = targetChecked; affectedIndices.push(i); }
                else break;
            }
            affectedIndices.forEach(i => {
                const rowEl = bodyContainer.querySelector(`.tl-row[data-index="${i}"]`);
                if (!rowEl) return;
                rowEl.classList.toggle('tl-selected', targetChecked);
                const cb = rowEl.querySelector('.tl-checkbox');
                if (cb) cb.checked = targetChecked;
            });
            e.target.blur(); debouncedSave(); refreshToolbarUI(); return;
        }
        if (e.target.classList.contains('tl-time-btn')) { const t = parseFloat(e.target.dataset.time); if (t >= 0) seekToTime(t); return; }
        if (e.target.classList.contains('tl-del-btn')) {
            activeList.splice(idx, 1); if (currentFocusedIdx === idx) currentFocusedIdx = -1; render(); refreshToolbarUI(); return;
        }
    });

    bodyContainer.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('tl-input')) {
            lastFocusedInput = e.target; const currentRow = e.target.closest('.tl-row'); const targetIdx = parseInt(currentRow.dataset.index);
            if (currentFocusedIdx === targetIdx) return;
            bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused'));
            currentFocusedIdx = targetIdx; currentRow.classList.add('tl-focused');
        }
    });

    bodyContainer.addEventListener('input', (e) => {
        const row = e.target.closest('.tl-row');
        if (row && e.target.classList.contains('tl-input')) {
            getActiveList()[parseInt(row.dataset.index)].text = e.target.value; debouncedSave(); autoResizeTextarea(e.target); debouncedUpdateCounter();
        }
    });

    bodyContainer.addEventListener('keydown', (e) => {
        const row = e.target.closest('.tl-row'); if (!row) return;
        const currentIdx = parseInt(row.dataset.index); const activeList = getActiveList();

        if (e.key === 'Tab' && hotkeys.tabDepth.key === 'Tab' && !hotkeys.tabDepth.ctrl && !hotkeys.tabDepth.alt && !hotkeys.tabDepth.meta) {
            e.preventDefault(); e.stopPropagation();
            let targetIndices = activeList.map((item, idx) => item.selected ? idx : -1).filter(idx => idx !== -1);
            if (targetIndices.length === 0) targetIndices = [currentIdx];
            targetIndices.forEach(idx => { let d = activeList[idx].depth || 0; activeList[idx].depth = e.shiftKey ? Math.max(0, d - 1) : Math.min(3, d + 1); });
            const savedInputVal = e.target.value; const savedCursorPos = e.target.selectionStart; render();
            const targetInput = bodyContainer.querySelectorAll('.tl-row')[currentIdx].querySelector('.tl-input');
            targetInput.focus(); targetInput.value = savedInputVal; targetInput.setSelectionRange(savedCursorPos, savedCursorPos); return;
        }

        if (e.target.classList.contains('tl-input')) {
            const isMainModifier = isMac ? (e.metaKey || e.keyCode === 91 || e.keyCode === 93) : e.altKey;

            // 🌟 대망의 추가 요청 반영: 수정 단계창 내부에서 Cmd(Alt) + Backspace(지우기) 클릭 시 원터치 파괴폭파 기능 가동
            if (isMainModifier && (e.key === 'Backspace' || e.keyCode === 8)) {
                e.preventDefault(); e.stopPropagation();
                activeList.splice(currentIdx, 1); // 현재 수정 중인 라인 즉시 소멸
                currentFocusedIdx = -1; render(); refreshToolbarUI();
                if (activeVideo) activeVideo.focus(); // 소멸 즉시 비디오 화면 포커스 정상 사수 반환
                return;
            }

            const matchAddKey = matchesAction('addTimestamp', e);
            const matchAddTextKey = matchesAction('addTextTimestamp', e);

            if (matchAddKey) {
                e.preventDefault(); e.stopPropagation(); currentFocusedIdx = -1;
                bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused'));
                e.target.blur(); if (activeVideo) activeVideo.focus();
                checkAndOverflowPage(); return;
            }
            if (matchAddTextKey) {
                e.preventDefault(); e.stopPropagation(); currentFocusedIdx = -1;
                bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused'));
                e.target.blur(); if (activeVideo) activeVideo.focus();
                checkAndOverflowPage(); return;
            }
            if (e.key === 'Enter' || e.keyCode === 13) { e.stopPropagation(); setTimeout(() => autoResizeTextarea(e.target), 10); return; }
            if (e.key === 'Escape' || e.keyCode === 27) {
                e.preventDefault(); e.stopPropagation(); currentFocusedIdx = -1;
                bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused'));
                e.target.blur(); if (activeVideo) activeVideo.focus();
                checkAndOverflowPage(); return;
            }
            e.stopPropagation();
        }
    });

    document.getElementById('tl-btn-clear').addEventListener('click', () => {
        const activeList = getActiveList(); if (activeList.length === 0) return alert('삭제할 데이터가 없습니다.');
        if (confirm(`⚠️ 현재 페이지(${pageState.currentPageIdx + 1}번 탭)의 타임라인 데이터만 삭제됩니다. 정말 삭제하시겠습니까?`)) {
            pageState.pages[pageState.currentPageIdx].list = []; currentFocusedIdx = -1; render(); refreshToolbarUI();
        }
    });

    document.getElementById('tl-btn-export').addEventListener('click', () => {
        const activeList = getActiveList(); if (activeList.length === 0) return alert('작성된 데이터가 없습니다.');
        const textResult = buildExportText(); navigator.clipboard.writeText(textResult).then(() => alert(`현재 ${pageState.currentPageIdx + 1}페이지 복사 완료!`));
    });

    document.getElementById('tl-btn-import').addEventListener('click', () => {
        const rawText = prompt('타임라인 텍스트를 붙여넣으세요 (현재 탭에 추가 정렬됩니다):'); if (!rawText) return;
        const lines = rawText.split('\n'); const imported = getActiveList();
        const importStartIdx = imported.length; // 기존 항목과 병합되지 않도록 시작 인덱스 기록
        let lastSeconds = -1; // 임포트 내 마지막 아이템 시간 트래킹
        lines.forEach(line => {
            if (!line.trim()) return; // 빈 줄 무시
            const match = line.match(/(?:(\d{1,2}):)?(\d{2}):(\d{2})/);
            if (match) {
                const timeStr = match[0]; const totalSeconds = (match[1] ? parseInt(match[1]) * 3600 : 0) + parseInt(match[2]) * 60 + parseInt(match[3]);
                const spaceMatch = line.match(/^(ㅤ*)/), leadSpaces = spaceMatch ? spaceMatch[1].length : 0;
                lastSeconds = totalSeconds;
                imported.push({
                    seconds: totalSeconds, timeStr: timeStr.padStart(8, '0'),
                    text: line.replace(/^ㅤ*ㄴ*/, '').trim().replace(/\[?\s*(?:(?:\d{1,2}):)?(?:\d{2}):(?:\d{2})\s*\]?/, '').trim(),
                    depth: Math.min(3, line.includes('ㄴ') ? 1 + leadSpaces : 0), selected: false
                });
            } else {
                // 타임라인 형식이 아님: 직전 임포트 항목이 isText면 줄바꿈으로 병합
                const lastItem = imported.length > importStartIdx ? imported[imported.length - 1] : null;
                if (lastItem && lastItem.isText) {
                    lastItem.text += '\n' + line.replace(/^ㅤ*ㄴ*/, '').trim();
                } else {
                    const textSeconds = lastSeconds < 0 ? -1 : lastSeconds + 1;
                    if (textSeconds >= 0) lastSeconds = textSeconds;
                    const timeStr = textSeconds < 0 ? '--:--:--' : (() => { const h = Math.floor(textSeconds / 3600), m = Math.floor((textSeconds % 3600) / 60), s = textSeconds % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`.padStart(8, '0'); })();
                    const spaceMatch = line.match(/^(ㅤ*)/), leadSpaces = spaceMatch ? spaceMatch[1].length : 0;
                    imported.push({
                        seconds: textSeconds, timeStr,
                        text: line.replace(/^ㅤ*ㄴ*/, '').trim(),
                        depth: Math.min(3, line.includes('ㄴ') ? 1 + leadSpaces : 0),
                        selected: false, isText: true
                    });
                }
            }
        });
        if (imported.length > 0) { currentFocusedIdx = -1; pageState.pages[pageState.currentPageIdx].list = imported.sort((a, b) => a.seconds - b.seconds); render(); refreshToolbarUI(); }
    });

    // 도움말 단축키 커스텀 마운터 팝업
    function openHelpAndHotkeyModal() {
        const mask = document.createElement('div'); mask.className = 'tl-modal-mask'; mask.id = 'tl-help-mask';
        const modal = document.createElement('div'); modal.className = 'tledit-popup-box'; modal.id = 'tl-help-modal';
        let rowsHtml = '';
        for (const actionKey in hotkeys) {
            if (actionKey === 'tabDepth') continue; // 보조 단축키 미지원: 아래 고정 단축키 표에 별도 표기
            const action = hotkeys[actionKey]; const primaryKeyStr = getHotkeyString(action);
            const secondary = secondaryHotkeys[actionKey];
            rowsHtml += `<tr data-action="${actionKey}"><td style="font-weight:600; color:#eee;">${action.label}</td><td><kbd class="tl-help-kbd">${primaryKeyStr}</kbd></td><td><div class="tl-hotkey-secondary-cell"><kbd class="tl-help-kbd" id="kbd-text-secondary-${actionKey}">${secondary ? getHotkeyString(secondary) : '미설정'}</kbd><button class="tl-kbd-btn-change" data-action="${actionKey}">[ 추가/변경 ]</button><button class="tl-kbd-btn-clear" data-action="${actionKey}" style="${secondary ? '' : 'display:none;'}">[ 해제 ]</button></div></td></tr>`;
        }
        modal.innerHTML = `
            <div class="tledit-popup-header-area"><span class="tledit-popup-title-text" style="width:60%;">❓ 단축키 커스텀 & 가이드</span><button class="tl-btn-sub" id="tl-kbd-btn-reset" style="padding: 4px 10px; font-size:11px; float:right;">🔄 보조 단축키 전체 초기화</button></div>
            <div style="flex:1; overflow-y:auto; font-size:13px; color:#ddd; padding-right:4px;">
                <p style="margin:0 0 6px; font-size:11px; color:#999;">기본 단축키는 고정입니다. 보조 단축키를 추가로 등록하면 둘 중 어느 키를 눌러도 동일하게 동작합니다.</p>
                <table class="tl-help-table"><thead><tr><th>기능 종류</th><th>기본 단축키</th><th>보조 단축키</th></tr></thead><tbody id="tl-hotkey-table-body">${rowsHtml}</tbody></table>
                <table class="tl-help-table" style="margin-top:8px;"><thead><tr><th colspan="2">고정 단축키 (변경 불가)</th></tr></thead><tbody>
                    <tr><td style="font-weight:600; color:#eee;">이전 페이지로 이동</td><td><kbd class="tl-help-kbd">${mainModKeyText} + ←</kbd></td></tr>
                    <tr><td style="font-weight:600; color:#eee;">다음 페이지로 이동 / 새 페이지 생성</td><td><kbd class="tl-help-kbd">${mainModKeyText} + →</kbd></td></tr>
                    <tr><td style="font-weight:600; color:#eee;">동영상 N초 앞/뒤로 탐색 (VOD)</td><td><kbd class="tl-help-kbd">Shift + ← / →</kbd></td></tr>
                    <tr><td style="font-weight:600; color:#eee;">${hotkeys.tabDepth.label}</td><td><kbd class="tl-help-kbd">${getHotkeyString(hotkeys.tabDepth)}</kbd></td></tr>
                    <tr><td style="font-weight:600; color:#eee;">작성 중인 타임라인 라인 즉시 삭제 파괴</td><td><kbd class="tl-help-kbd">${mainModKeyText} + Backspace</kbd></td></tr>
                    <tr><td style="font-weight:600; color:#eee;">작성 중 빠르게 두 번 눌러 완료</td><td><kbd class="tl-help-kbd">Enter</kbd> x2</td></tr>
                </tbody></table>
            </div>
            <div class="tl-modal-footer"><button class="tl-btn-main" id="tl-help-close-btn" style="padding: 8px 24px;">닫기</button></div>
        `;
        document.body.appendChild(mask); document.body.appendChild(modal); makeElementDraggable(modal, 'tledit-popup-title-text', false);
        const cleanUpHelp = () => { recordingHotkeyAction = null; mask.remove(); modal.remove(); };
        modal.querySelector('#tl-help-close-btn').addEventListener('click', cleanUpHelp);
        modal.querySelector('#tl-kbd-btn-reset').addEventListener('click', () => {
            if (confirm('⚠️ 등록된 보조 단축키를 모두 초기화하시겠습니까? (기본 단축키는 영향 없음)')) { secondaryHotkeys = {}; GM_setValue('soop_global_hotkeys_secondary_v1', secondaryHotkeys); cleanUpHelp(); openHelpAndHotkeyModal(); }
        });
        modal.querySelector('#tl-hotkey-table-body').addEventListener('click', (e) => {
            const targetAction = e.target.dataset.action;
            if (e.target.classList.contains('tl-kbd-btn-clear')) {
                delete secondaryHotkeys[targetAction]; GM_setValue('soop_global_hotkeys_secondary_v1', secondaryHotkeys); refreshSecondaryCell(targetAction); return;
            }
            if (!e.target.classList.contains('tl-kbd-btn-change')) return;
            if (recordingHotkeyAction === targetAction) { recordingHotkeyAction = null; e.target.innerText = '[ 추가/변경 ]'; e.target.classList.remove('recording'); refreshSecondaryCell(targetAction); return; }
            modal.querySelectorAll('.tl-kbd-btn-change').forEach(btn => { btn.innerText = '[ 추가/변경 ]'; btn.classList.remove('recording'); });
            for (const act in secondaryHotkeys) { refreshSecondaryCell(act); }
            recordingHotkeyAction = targetAction; e.target.innerText = '[ 입력중... ]'; e.target.classList.add('recording'); document.getElementById(`kbd-text-secondary-${targetAction}`).innerText = '⌨️ 키를 누르세요...';
        });
    }

    function openSettingsModal() {
        const mask = document.createElement('div'); mask.className = 'tl-modal-mask'; mask.id = 'tl-sett-mask';
        const modal = document.createElement('div'); modal.className = 'tledit-popup-box'; modal.id = 'tl-sett-modal';
        modal.innerHTML = `
            <div class="tledit-popup-header-area"><span class="tledit-popup-title-text">⚙️ 설정</span></div>
            <div style="flex:1; overflow-y:auto; font-size:13px; color:#ddd;">
                <table class="tl-help-table">
                    <tr><td style="color:#00b074; font-weight:bold; white-space:nowrap;">탐색 간격 (초)</td>
                        <td><input type="number" id="tl-sett-skip" class="tl-h-time-box tl-emoji-highlight-input" value="${skipSeconds}" min="1" max="60"></td></tr>
                    ${isLiveMode ? `<tr><td style="color:#00b074; font-weight:bold; white-space:nowrap;">라이브 오프셋 (초)</td>
                        <td><input type="number" id="tl-sett-offset" class="tl-h-time-box tl-emoji-highlight-input" value="${liveOffsetSeconds}"></td></tr>` : ''}
                    <tr><td colspan="2" style="color:#00b074; font-weight:bold; padding-top:12px;">이모지 프리셋 (쉼표로 구분)</td></tr>
                    <tr><td colspan="2"><input type="text" id="tl-sett-emoji" class="tl-input tl-emoji-highlight-input" style="width:100%; box-sizing:border-box;" value="${customEmojis.join(',')}"></td></tr>
                </table>
            </div>
            <div class="tl-modal-footer">
                <button class="tl-btn-sub" id="tl-sett-cancel">취소</button>
                <button class="tl-btn-main" id="tl-sett-save">저장</button>
            </div>
        `;
        document.body.appendChild(mask); document.body.appendChild(modal);
        makeElementDraggable(modal, 'tledit-popup-title-text', false);

        window.saveTimelineSettingsData = () => {
            const skipVal = parseInt(modal.querySelector('#tl-sett-skip')?.value, 10);
            if (!isNaN(skipVal) && skipVal > 0) { skipSeconds = skipVal; GM_setValue('soop_global_skip_seconds', skipSeconds); }
            if (isLiveMode) {
                const offVal = parseInt(modal.querySelector('#tl-sett-offset')?.value, 10);
                if (!isNaN(offVal)) { liveOffsetSeconds = offVal; GM_setValue('soop_global_live_offset', liveOffsetSeconds); }
            }
            const emojiStr = modal.querySelector('#tl-sett-emoji')?.value || '';
            const newEmojis = emojiStr.split(',').map(s => s.trim()).filter(Boolean);
            if (newEmojis.length > 0) { customEmojis = newEmojis; GM_setValue('soop_global_custom_emojis', customEmojis); }
            refreshToolbarUI();
        };

        const cleanUp = () => { window.saveTimelineSettingsData = undefined; mask.remove(); modal.remove(); };
        modal.querySelector('#tl-sett-cancel').addEventListener('click', cleanUp);
        modal.querySelector('#tl-sett-save').addEventListener('click', () => { window.saveTimelineSettingsData(); cleanUp(); });
    }

    document.getElementById('tl-btn-help').addEventListener('click', openHelpAndHotkeyModal);
    document.getElementById('tl-btn-settings').addEventListener('click', openSettingsModal);

    // 글로벌 핫키 핸들러 계층
    window.addEventListener('keydown', (e) => {
        if (recordingHotkeyAction) {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Escape') {
                const btn = document.querySelector(`.tl-kbd-btn-change[data-action="${recordingHotkeyAction}"]`);
                if (btn) { btn.innerText = '[ 추가/변경 ]'; btn.classList.remove('recording'); }
                const existingSecondary = secondaryHotkeys[recordingHotkeyAction];
                document.getElementById(`kbd-text-secondary-${recordingHotkeyAction}`).innerText = existingSecondary ? getHotkeyString(existingSecondary) : '미설정';
                recordingHotkeyAction = null; return;
            }
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                let tempParts = []; if (e.ctrlKey) tempParts.push('Ctrl'); if (e.altKey) tempParts.push('Alt'); if (e.shiftKey) tempParts.push('Shift'); if (e.metaKey) tempParts.push(isMac ? 'Cmd' : 'Win');
                document.getElementById(`kbd-text-secondary-${recordingHotkeyAction}`).innerText = tempParts.join(' + ') + ' + ...'; return;
            }
            // 보조 단축키는 조합키 없는 단독 키(문자, 숫자 포함)도 제한 없이 허용
            secondaryHotkeys[recordingHotkeyAction] = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key: e.key, code: e.code };
            GM_setValue('soop_global_hotkeys_secondary_v1', secondaryHotkeys); const targetActSaved = recordingHotkeyAction; recordingHotkeyAction = null;
            const btn = document.querySelector(`.tl-kbd-btn-change[data-action="${targetActSaved}"]`); if (btn) { btn.innerText = '[ 추가/변경 ]'; btn.classList.remove('recording'); }
            refreshSecondaryCell(targetActSaved); return;
        }

        const isMainModifier = isMac ? (e.metaKey || e.keyCode === 91 || e.keyCode === 93) : e.altKey;

        if (e.key === 'Escape' || e.keyCode === 27) {
            let modalClosed = false;
            const helpMask = document.getElementById('tl-help-mask'), helpModal = document.getElementById('tl-help-modal'); if (helpMask && helpModal) { helpMask.remove(); helpModal.remove(); modalClosed = true; }
            const hugeMask = document.getElementById('tl-huge-mask'), hugeModal = document.getElementById('tl-huge-modal'); if (hugeMask && hugeModal) { hugeMask.remove(); hugeModal.remove(); modalClosed = true; }
            const settMask = document.getElementById('tl-sett-mask'), settModal = document.getElementById('tl-sett-modal'); if (settMask && settModal) { if (typeof window.saveTimelineSettingsData === 'function') { window.saveTimelineSettingsData(); } settMask.remove(); settModal.remove(); modalClosed = true; }
            if (modalClosed) { e.preventDefault(); e.stopPropagation(); return; }

            const activeList = getActiveList(); const hasCheckedItem = activeList.some(item => item.selected);
            if (hasCheckedItem && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); activeList.forEach(item => { item.selected = false; }); currentFocusedIdx = -1; render(); refreshToolbarUI(); return; }
        }

        if (document.getElementById('tl-sett-modal') || document.getElementById('tl-huge-modal') || document.getElementById('tl-confirm-modal') || document.getElementById('tl-notice-modal')) return;

        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            if (matchesAction('scrollTop', e)) { e.preventDefault(); e.stopPropagation(); bodyContainer.scrollTo({ top: 0, behavior: 'smooth' }); return; }
            if (matchesAction('scrollBottom', e)) { e.preventDefault(); e.stopPropagation(); bodyContainer.scrollTo({ top: bodyContainer.scrollHeight, behavior: 'smooth' }); return; }
        }

        const isInputFocused = e.target.classList.contains('tl-input'); const activeList = getActiveList();
        if (matchesAction('tabDepth', e) && isInputFocused) {
            e.preventDefault(); e.stopPropagation(); const currentIdx = parseInt(e.target.closest('.tl-row').dataset.index); let targetIndices = activeList.map((item, idx) => item.selected ? idx : -1).filter(idx => idx !== -1);
            if (targetIndices.length === 0) targetIndices = [currentIdx];
            targetIndices.forEach(idx => { let d = activeList[idx].depth || 0; activeList[idx].depth = e.shiftKey ? Math.max(0, d - 1) : Math.min(3, d + 1); });
            const val = e.target.value, cursor = e.target.selectionStart; render(); const tInput = bodyContainer.querySelectorAll('.tl-row')[currentIdx].querySelector('.tl-input');
            tInput.focus(); tInput.value = val; tInput.setSelectionRange(cursor, cursor); return;
        }

        if (matchesAction('addTimestamp', e)) { e.preventDefault(); e.stopPropagation(); if (isInputFocused) { currentFocusedIdx = -1; bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused')); e.target.blur(); if (activeVideo) activeVideo.focus(); } else { addTimestamp(); } return; }
        if (matchesAction('addTextTimestamp', e)) { e.preventDefault(); e.stopPropagation(); if (isInputFocused) { currentFocusedIdx = -1; bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused')); e.target.blur(); if (activeVideo) activeVideo.focus(); } else { addTextTimestamp(); } return; }

        // 타임스탬프 완료 전용 고정 동작(보조 단축키 미지원): 입력창에서 조합키 없는 Enter를 빠르게 두 번 누르면 완료 처리
        if (isInputFocused && e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
            const now = Date.now();
            if (now - lastPlainEnterTime < 400) {
                e.preventDefault(); e.stopPropagation(); lastPlainEnterTime = 0;
                if (e.target.value.endsWith('\n')) {
                    e.target.value = e.target.value.replace(/\n$/, '');
                    const row = e.target.closest('.tl-row'); const idx = row ? parseInt(row.dataset.index) : -1;
                    const item = getActiveList()[idx];
                    if (item) { item.text = e.target.value; debouncedSave(); }
                }
                currentFocusedIdx = -1; bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused'));
                e.target.blur(); if (activeVideo) activeVideo.focus(); checkAndOverflowPage(); return;
            }
            lastPlainEnterTime = now;
        }

        if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox')) { if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); e.stopPropagation(); currentFocusedIdx = -1; bodyContainer.querySelectorAll('.tl-row').forEach(r => r.classList.remove('tl-focused')); e.target.blur(); if (activeVideo) activeVideo.focus(); checkAndOverflowPage(); return; } return; }

        if (matchesAction('timeMinus1', e)) { e.preventDefault(); e.stopPropagation(); modifyTimelineSeconds(-1); return; }
        if (matchesAction('timePlus1', e)) { e.preventDefault(); e.stopPropagation(); modifyTimelineSeconds(1); return; }
        if (matchesAction('timeMinus5', e)) { e.preventDefault(); e.stopPropagation(); modifyTimelineSeconds(-5); return; }
        if (matchesAction('timePlus5', e)) { e.preventDefault(); e.stopPropagation(); modifyTimelineSeconds(5); return; }

        if (isMainModifier && e.key === 'ArrowLeft') {
            e.preventDefault(); e.stopPropagation();
            if (pageState.currentPageIdx > 0) { pageState.currentPageIdx--; currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI(); }
            return;
        }
        if (isMainModifier && e.key === 'ArrowRight') {
            e.preventDefault(); e.stopPropagation();
            if (pageState.currentPageIdx < pageState.pages.length - 1) {
                pageState.currentPageIdx++; currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI();
            } else {
                showConfirmPopup('새로운 페이지를 만드시겠습니까?', () => {
                    const nextNum = pageState.pages.length + 1;
                    pageState.pages.push({ pageName: `댓글 ${nextNum}`, list: [] });
                    pageState.currentPageIdx = pageState.pages.length - 1;
                    currentFocusedIdx = -1; savePageState(); render(); refreshToolbarUI();
                });
            }
            return;
        }

        if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (!isLiveMode && activeVideo) seekToTime(getCurrentPartOffset() + Math.max(0, activeVideo.currentTime - skipSeconds)); return; }
        if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (!isLiveMode && activeVideo) seekToTime(getCurrentPartOffset() + Math.min(activeVideo.duration, activeVideo.currentTime + skipSeconds)); return; }
    }, true);

    initVideoFinder(); initPartOffsets(); refreshToolbarUI(); render();

    // 이전 버전에서 저장된 stale reload seek 데이터 정리
    GM_setValue('soop_pending_seek_reload', null);
})();