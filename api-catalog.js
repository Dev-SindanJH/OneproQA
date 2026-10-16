// =====================================================================
// API 호출 지도 탭
// - 데이터: api-catalog.json (tools/api_catalog/build_catalog.py 로 생성, 정적 파일)
// - 클라이언트가 어느 씬에서 어떤 상황에 어떤 서버 API 를 부르는지 보여준다
// - script.js 의 escapeHtml, showToast 사용
// =====================================================================

// API 클래스 → 기능 묶음
const AC_GROUPS = [
    { key: 'boot', label: '부팅·설정' },
    { key: 'auth', label: '인증·계정·프로필' },
    { key: 'learning', label: '학습' },
    { key: 'leveltest', label: 'AI 레벨테스트' },
    { key: 'game', label: '미니게임' },
    { key: 'netgame', label: '실시간 대전' },
    { key: 'ranking', label: '랭킹' },
    { key: 'avatar', label: '아바타·꾸미기' },
    { key: 'shop', label: '결제·재화·이용권' },
    { key: 'event', label: '출석·미션·이벤트' },
    { key: 'comm', label: '소식·문의' },
    { key: 'dev', label: '개발자' },
];

// 씬 파일 이름 → 표시 이름·묶음
const AC_SCENE_GROUPS = [
    { key: 'boot', label: '부팅·로그인' },
    { key: 'lobby', label: '로비·공통' },
    { key: 'learning', label: '학습' },
    { key: 'leveltest', label: 'AI 레벨테스트' },
    { key: 'game', label: '게임' },
    { key: 'avatar', label: '꾸미기·상점·랭킹' },
    { key: 'etc', label: '기타' },
];
const AC_SCENES = {
    AssetBundleScene: ['부팅 (번들 다운로드)', 'boot'],
    TitleScene: ['타이틀·로그인', 'boot'],
    LoadingScene: ['씬 전환 로딩', 'boot'],
    CreateProfileScene: ['프로필 생성', 'boot'],
    '공통': ['공통 (어느 씬에서든)', 'lobby'],
    MainLobbyScene_v4: ['메인 로비', 'lobby'],
    DailyStudyScene: ['오늘의 학습', 'learning'],
    ChallengeScene: ['챌린지', 'learning'],
    FreeStudyScene: ['자유 학습', 'learning'],
    WorldStudyScene: ['월드 학습', 'learning'],
    MathWorld: ['매쓰월드', 'learning'],
    '스테이지': ['스테이지 (문제 풀이)', 'learning'],
    StageResultScene: ['스테이지 결과', 'learning'],
    LearningResultScene: ['학습 결과', 'learning'],
    VideoCenterScene: ['영상센터', 'learning'],
    Study_1: ['스테이지 (문제 풀이)', 'learning'],
    AILevelTestScene_L1: ['AI 레벨테스트 L1', 'leveltest'],
    AILevelTestScene_L2: ['AI 레벨테스트 L2', 'leveltest'],
    AILevelTestScene_L3: ['AI 레벨테스트 L3', 'leveltest'],
    AILevelTestScene_L3_2: ['AI 레벨테스트 L3-2', 'leveltest'],
    AILevelTestScene_L3_Retest: ['AI 레벨테스트 재시험', 'leveltest'],
    MathRun_Lobby: ['매쓰런 로비', 'game'],
    MathRun_Ingame: ['매쓰런 인게임', 'game'],
    MathRun_Tutorial: ['매쓰런 튜토리얼', 'game'],
    MathGalaxyLobby: ['매쓰갤럭시 로비', 'game'],
    MathGalaxyInGame: ['매쓰갤럭시 인게임', 'game'],
    MathLympics: ['매쓰림픽', 'game'],
    MakeTenScene: ['텐텐팡', 'game'],
    MathBattleLobby: ['매쓰배틀 로비', 'game'],
    MathBattleInGame: ['매쓰배틀 인게임', 'game'],
    Card_SelectMode: ['카드 게임 모드 선택', 'game'],
    Card_SelectStage: ['카드 게임 스테이지 선택', 'game'],
    Card_Play: ['카드 게임 플레이', 'game'],
    Card_SelectRankingMode: ['카드 게임 랭킹 모드', 'game'],
    Card_RankingPlay: ['카드 게임 랭킹 플레이', 'game'],
    Speed_TitleScene: ['스피드 게임 타이틀', 'game'],
    Speed_PlayScene: ['스피드 게임 플레이', 'game'],
    RunGame_TitleScene: ['런 게임 타이틀', 'game'],
    Rungame_practice_1: ['런 게임 연습', 'game'],
    InAppPurchaseScene: ['상점', 'avatar'],
    DiaRankingScene: ['다이아 랭킹', 'avatar'],
    AvatarContestScene: ['아바타 콘테스트', 'avatar'],
    FantasyAvatar_Lobby: ['판타지 아바타 로비', 'avatar'],
    FantasyAvatar_Play: ['판타지 아바타 플레이', 'avatar'],
    IdolAvatarScene: ['아이돌 아바타', 'avatar'],
    Customize: ['아바타 커스터마이즈', 'avatar'],
};
const AC_HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS'];

const acState = {
    loaded: false,
    data: null,
    view: 'api',
    http: new Set(),
    group: 'all',
    scene: null,
    open: new Set(),
};

// ---------------------------------------------------------------- 로드
async function loadApiCatalog(force) {
    if (acState.loaded && !force) return;
    _acShow('loading');
    try {
        const res = await fetch(`api-catalog.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        acState.data = await res.json();
        acState.loaded = true;
        _acRenderMeta();
        _acRenderHttpChips();
        renderApiCatalog();
        _acShow('content');
    } catch (e) {
        console.error('[API 호출 지도] 로드 실패', e);
        _acShow('empty', `API 목록을 불러오지 못했습니다.<br><span class="text-xs">${escapeHtml(e.message || e)} — 로컬 서버(start-server.ps1)로 열어야 합니다.</span>`);
    }
}

function _acShow(which, msg) {
    document.getElementById('ac-loading').classList.toggle('hidden', which !== 'loading');
    document.getElementById('ac-content').classList.toggle('hidden', which !== 'content');
    const empty = document.getElementById('ac-empty');
    empty.classList.toggle('hidden', which !== 'empty');
    if (which === 'empty') empty.innerHTML = msg || '';
}

// ---------------------------------------------------------------- 필터
function setApiCatalogView(view) {
    acState.view = view;
    document.getElementById('ac-view-api').classList.toggle('active', view === 'api');
    document.getElementById('ac-view-scene').classList.toggle('active', view === 'scene');
    document.getElementById('ac-api-view').classList.toggle('hidden', view !== 'api');
    document.getElementById('ac-scene-view').classList.toggle('hidden', view !== 'scene');
    document.getElementById('ac-view-map').classList.toggle('active', view === 'map');
    document.getElementById('ac-map-view').classList.toggle('hidden', view !== 'map');
    renderApiCatalog();
}

function toggleApiCatalogHttp(m) {
    if (acState.http.has(m)) acState.http.delete(m); else acState.http.add(m);
    _acRenderHttpChips();
    renderApiCatalog();
}

function setApiCatalogGroup(g) {
    acState.group = g;
    renderApiCatalog();
}

function _acHttpList(ep) {
    return String(ep.http || '').split('/').map(s => s.trim().toUpperCase()).filter(Boolean);
}

function _acCallText(c) {
    return [c.screen, c.trigger, c.on_fail, c.note, c.file, c.method, c.path, ...(c.scenes || []).map(_acSceneLabel)].join(' ');
}

// 검색·HTTP·묶음 필터를 통과한 엔드포인트. 검색어가 호출 지점에만 걸리면 그 호출 지점만 남긴다.
function _acFiltered(ignoreGroup) {
    const q = (document.getElementById('ac-search').value || '').trim().toLowerCase();
    const showUnused = document.getElementById('ac-f-unused').checked;
    const out = [];
    for (const ep of acState.data.endpoints) {
        if (ep.unused && !showUnused) continue;
        if (!ignoreGroup && acState.group !== 'all' && ep.group !== acState.group) continue;
        if (acState.http.size && !_acHttpList(ep).some(m => acState.http.has(m))) continue;
        if (!q) { out.push({ ep, calls: ep.calls, hit: false }); continue; }
        const head = [ep.key, ep.name, ep.desc, ...(ep.paths || [])].join(' ').toLowerCase();
        if (head.includes(q)) { out.push({ ep, calls: ep.calls, hit: true }); continue; }
        const calls = ep.calls.filter(c => _acCallText(c).toLowerCase().includes(q));
        if (calls.length) out.push({ ep, calls, hit: true });
    }
    return out;
}

// ---------------------------------------------------------------- 렌더
function renderApiCatalog() {
    if (!acState.data) return;
    _acRenderSummary();
    _acRenderGroupChips();
    if (acState.view === 'api') _acRenderApiView();
    else if (acState.view === 'scene') _acRenderSceneView();
    else if (typeof renderApiMap === 'function') renderApiMap();
}

function _acRenderMeta() {
    const d = acState.data;
    const item = (icon, text) => `<span><i class="fas ${icon} mr-1"></i>${text}</span>`;
    document.getElementById('ac-meta-bar').innerHTML = [
        item('fa-clock', `생성 ${escapeHtml(d.generated_at || '-')}`),
        item('fa-code-branch', `${escapeHtml(d.unity_branch || '-')} @ <span class="font-mono">${escapeHtml(d.unity_commit || '-')}</span>`),
        item('fa-file-code', `정의 <span class="font-mono">${escapeHtml(d.api_file || 'CommonAPI.cs')}</span>`),
        d.note ? item('fa-note-sticky', escapeHtml(d.note)) : '',
    ].join('');
}

function _acRenderSummary() {
    const eps = acState.data.endpoints;
    const used = eps.filter(e => !e.unused);
    const calls = used.reduce((n, e) => n + e.calls.length, 0);
    const scenes = new Set();
    used.forEach(e => e.calls.forEach(c => (c.scenes || []).forEach(s => scenes.add(s))));
    const http = {};
    used.forEach(e => _acHttpList(e).forEach(m => { http[m] = (http[m] || 0) + 1; }));
    const card = (label, value, sub) => `
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div class="text-xs text-gray-500 mb-1">${label}</div>
            <div class="text-2xl font-black text-slate-800">${value}</div>
            ${sub ? `<div class="text-xs text-gray-500 mt-1">${sub}</div>` : ''}
        </div>`;
    document.getElementById('ac-summary').innerHTML = [
        card('사용 중인 API', used.length, AC_HTTP.filter(m => http[m]).map(m => `<span class="ac-http ac-http-${m}">${m} ${http[m]}</span>`).join(' ')),
        card('호출 지점', calls, '코드에서 API 를 부르는 곳'),
        card('관련 씬', scenes.size, '“공통”·“스테이지” 포함'),
        card('정의만 있고 안 쓰는 API', eps.length - used.length, '“미사용 API 포함”으로 보기'),
    ].join('');
}

function _acRenderHttpChips() {
    const used = new Set();
    (acState.data?.endpoints || []).forEach(e => _acHttpList(e).forEach(m => used.add(m)));
    document.getElementById('ac-http-chips').innerHTML = AC_HTTP.filter(m => used.has(m)).map(m =>
        `<button onclick="toggleApiCatalogHttp('${m}')" class="ac-http ac-http-${m} ac-http-chip ${acState.http.has(m) ? 'on' : ''}">${m}</button>`
    ).join('');
}

function _acRenderGroupChips() {
    const base = _acFiltered(true);
    const count = {};
    base.forEach(({ ep }) => { count[ep.group] = (count[ep.group] || 0) + 1; });
    const chip = (key, label, n) =>
        `<button onclick="setApiCatalogGroup('${key}')" class="sa-rule-chip ${acState.group === key ? 'active' : ''}">${escapeHtml(label)}<span class="sa-rule-count">${n}</span></button>`;
    document.getElementById('ac-group-chips').innerHTML =
        chip('all', '전체', base.length) +
        AC_GROUPS.filter(g => count[g.key]).map(g => chip(g.key, g.label, count[g.key])).join('');
}

function _acSceneLabel(s) {
    return (AC_SCENES[s] || [s])[0];
}

function _acSceneChips(scenes) {
    if (!scenes || !scenes.length) return '<span class="text-xs text-gray-400">씬 미상</span>';
    return scenes.map(s =>
        `<button onclick="event.stopPropagation(); openApiCatalogScene('${escapeHtml(s)}')" class="ac-scene" title="${escapeHtml(s)} — 씬별 보기로 이동">${escapeHtml(_acSceneLabel(s))}</button>`
    ).join('');
}

function _acHttpBadges(ep) {
    return _acHttpList(ep).map(m => `<span class="ac-http ac-http-${m}">${m}</span>`).join('');
}

function _acLoc(c) {
    const loc = `${c.file}:${c.line}`;
    const short = c.file.replace(/^Assets\//, '').split('/').slice(-1)[0];
    // indirect: 공용 메서드(EditProfile 등)를 거쳐 부르는 상위 화면의 위치
    const via = c.indirect ? '<span class="ac-via" title="이 위치에서 공용 메서드를 거쳐 API 를 부릅니다">경유</span>' : '';
    return `<span class="ac-loc" title="${escapeHtml(loc)}">${via}<span class="font-mono">${escapeHtml(short)}:${c.line}</span>${c.method ? ` <span class="text-gray-400">${escapeHtml(c.method)}()</span>` : ''}` +
        `<button class="sa-copy" onclick="event.stopPropagation(); copyApiCatalogText('${escapeHtml(loc)}')" title="경로 복사"><i class="fas fa-copy"></i></button></span>`;
}

function _acCallRows(calls, withScene) {
    return calls.map(c => `
        <tr>
            ${withScene ? `<td class="ac-td-scene">${_acSceneChips(c.scenes)}</td>` : ''}
            <td>
                <div class="font-bold text-slate-800">${escapeHtml(c.screen || '-')}</div>
                ${c.path ? `<div class="font-mono text-xs text-gray-500 mt-0.5 ac-path">${escapeHtml(c.path)}</div>` : ''}
            </td>
            <td>
                <div class="text-slate-800">${escapeHtml(c.trigger || '-')}</div>
                ${c.note ? `<div class="ac-note">${escapeHtml(c.note)}</div>` : ''}
            </td>
            <td class="text-gray-500">${escapeHtml(c.on_fail || '')}</td>
            <td class="ac-td-loc">${_acLoc(c)}</td>
        </tr>`).join('');
}

function _acRenderApiView() {
    const list = _acFiltered(false);
    const root = document.getElementById('ac-api-view');
    if (!list.length) {
        root.innerHTML = '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center text-gray-400">조건에 맞는 API 가 없습니다.</div>';
        return;
    }
    const byGroup = {};
    list.forEach(x => (byGroup[x.ep.group] = byGroup[x.ep.group] || []).push(x));
    root.innerHTML = AC_GROUPS.filter(g => byGroup[g.key]).map(g => `
        <div class="mb-6">
            <div class="ac-group-title">${escapeHtml(g.label)} <span>${byGroup[g.key].length}</span></div>
            <div class="flex flex-col gap-2">
                ${byGroup[g.key].map(x => _acEndpointCard(x)).join('')}
            </div>
        </div>`).join('');
}

function _acEndpointCard({ ep, calls, hit }) {
    const open = hit || acState.open.has(ep.key);
    const scenes = [...new Set(ep.calls.flatMap(c => c.scenes || []))];
    const paths = ep.paths && ep.paths.length ? ep.paths : ['(경로 미상)'];
    return `
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm ac-card ${ep.unused ? 'ac-unused' : ''}">
            <div class="ac-card-head" onclick="toggleApiCatalogEndpoint('${escapeHtml(ep.key)}')">
                <div class="ac-card-main">
                    <div class="flex flex-wrap items-center gap-2">
                        ${_acHttpBadges(ep)}
                        <span class="font-bold text-slate-800">${escapeHtml(ep.name || ep.key)}</span>
                        ${ep.unused ? '<span class="sa-status">미사용</span>' : ''}
                        <span class="text-xs text-gray-400 font-mono">${escapeHtml(ep.key)}</span>
                    </div>
                    <div class="ac-paths">${paths.map(p => `<span class="font-mono ac-path">${escapeHtml(p)}</span>`).join('')}</div>
                    ${ep.desc ? `<div class="text-sm text-gray-500 mt-1">${escapeHtml(ep.desc)}</div>` : ''}
                    ${scenes.length ? `<div class="flex flex-wrap gap-1 mt-2">${_acSceneChips(scenes)}</div>` : ''}
                </div>
                <div class="ac-card-side">
                    <span class="text-xs text-gray-500">호출 ${ep.calls.length}곳</span>
                    <i class="fas fa-chevron-${open ? 'up' : 'down'} text-gray-400"></i>
                </div>
            </div>
            ${open && calls.length ? `
            <div class="ac-card-body overflow-x-auto">
                <table class="w-full text-left border-collapse text-sm ac-table">
                    <thead><tr><th style="width:13%">씬</th><th style="width:19%">화면</th><th style="width:36%">호출되는 상황</th><th style="width:18%">실패 시</th><th>코드 위치</th></tr></thead>
                    <tbody>${_acCallRows(calls, true)}</tbody>
                </table>
            </div>` : ''}
        </div>`;
}

function toggleApiCatalogEndpoint(key) {
    if (acState.open.has(key)) acState.open.delete(key); else acState.open.add(key);
    renderApiCatalog();
}

// ---------------------------------------------------------------- 씬별 보기
function _acSceneIndex(list) {
    const idx = {};
    list.forEach(({ ep, calls }) => calls.forEach(c => {
        const scenes = c.scenes && c.scenes.length ? c.scenes : ['(씬 미상)'];
        scenes.forEach(s => (idx[s] = idx[s] || []).push({ ep, c }));
    }));
    return idx;
}

function openApiCatalogScene(scene) {
    acState.scene = scene;
    if (acState.view !== 'scene') setApiCatalogView('scene');
    else renderApiCatalog();
    document.getElementById('ac-scene-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _acRenderSceneView() {
    const idx = _acSceneIndex(_acFiltered(false));
    const root = document.getElementById('ac-scene-view');
    const keys = Object.keys(idx);
    if (!keys.length) {
        root.innerHTML = '<div class="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center text-gray-400">조건에 맞는 API 가 없습니다.</div>';
        return;
    }
    if (!acState.scene || !idx[acState.scene]) {
        acState.scene = keys.includes('MainLobbyScene_v4') ? 'MainLobbyScene_v4' : keys[0];
    }
    const groupOf = s => (AC_SCENES[s] || [null, 'etc'])[1];
    const order = Object.keys(AC_SCENES);
    const sorted = keys.sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
    });
    const nav = AC_SCENE_GROUPS.map(g => {
        const items = sorted.filter(s => groupOf(s) === g.key);
        if (!items.length) return '';
        return `<div class="ac-scene-group">${escapeHtml(g.label)}</div>` + items.map(s => {
            const apiCount = new Set(idx[s].map(x => x.ep.key)).size;
            return `<button onclick="openApiCatalogScene('${escapeHtml(s)}')" class="ac-scene-item ${s === acState.scene ? 'active' : ''}" title="${escapeHtml(s)}">
                <span>${escapeHtml(_acSceneLabel(s))}</span><span class="ac-scene-n">${apiCount}</span></button>`;
        }).join('');
    }).join('');

    // 선택한 씬: 화면별로 묶어서 보여준다
    const entries = idx[acState.scene];
    const byScreen = {};
    entries.forEach(x => (byScreen[x.c.screen || '(화면 미상)'] = byScreen[x.c.screen || '(화면 미상)'] || []).push(x));
    const screens = Object.keys(byScreen).sort((a, b) => a.localeCompare(b, 'ko'));
    const detail = screens.map(sc => `
        <div class="mb-4">
            <div class="ac-screen-title"><i class="fas fa-window-maximize mr-1.5"></i>${escapeHtml(sc)}</div>
            <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm ac-table">
                <thead><tr><th style="width:30%">API</th><th style="width:38%">호출되는 상황</th><th style="width:18%">실패 시</th><th>코드 위치</th></tr></thead>
                <tbody>${byScreen[sc].map(({ ep, c }) => `
                    <tr>
                        <td>
                            <div class="flex flex-wrap items-center gap-1.5">${_acHttpBadges(ep)}<span class="font-bold text-slate-800">${escapeHtml(ep.name || ep.key)}</span></div>
                            <div class="font-mono text-xs text-gray-500 mt-0.5 ac-path">${escapeHtml(c.path || (ep.paths || [])[0] || '')}</div>
                        </td>
                        <td>
                            <div class="text-slate-800">${escapeHtml(c.trigger || '-')}</div>
                            ${c.note ? `<div class="ac-note">${escapeHtml(c.note)}</div>` : ''}
                        </td>
                        <td class="text-gray-500">${escapeHtml(c.on_fail || '')}</td>
                        <td class="ac-td-loc">${_acLoc(c)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>
        </div>`).join('');

    const apiCount = new Set(entries.map(x => x.ep.key)).size;
    root.innerHTML = `
        <div class="ac-scene-layout">
            <nav class="bg-white rounded-xl border border-gray-100 shadow-sm ac-scene-nav" aria-label="씬 목록">${nav}</nav>
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 min-w-0">
                <div class="flex flex-wrap items-baseline gap-2 mb-4">
                    <h3 class="text-lg font-bold text-slate-800">${escapeHtml(_acSceneLabel(acState.scene))}</h3>
                    <span class="font-mono text-xs text-gray-400">${escapeHtml(acState.scene)}</span>
                    <span class="text-xs text-gray-500">API ${apiCount}개 · 호출 지점 ${entries.length}곳</span>
                </div>
                ${detail}
            </div>
        </div>`;
}

function copyApiCatalogText(text) {
    navigator.clipboard.writeText(text).then(() => showToast('복사했습니다'), () => showToast('복사하지 못했습니다', 'error'));
}
