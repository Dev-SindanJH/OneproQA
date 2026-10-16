// =====================================================================
// API 호출 지도 — 지도 보기 (api-catalog.js 의 세 번째 보기)
// - 기본은 3D 홀로그램(api-holo.js), 이 파일은 평면 지도·공용 데이터(_amCompute)·패널 내용(_amPanelHtml)
// - 씬을 구역(부팅·학습·게임…)별로 배치하고, 씬 이동 흐름(api-catalog.json flows)을 선으로 잇는다
// - 핀 크기 = 그 씬에서 부르는 API 수. 검색·HTTP·묶음 필터에 걸린 씬만 밝게 남는다
// - 씬을 누르면 오른쪽에 그 씬의 API, API 를 누르면 그 API 를 부르는 씬이 지도에 켜진다
// - api-catalog.js 의 acState, _acFiltered, _acSceneLabel, _acHttpBadges, escapeHtml 사용
// =====================================================================

const AM_W = 1440, AM_H = 920;

const AM_DISTRICTS = [
    { key: 'boot', label: '부팅·로그인', x: 20, y: 20, w: 560, h: 170, color: '#64748b' },
    { key: 'leveltest', label: 'AI 레벨테스트', x: 20, y: 210, w: 560, h: 225, color: '#0891b2' },
    { key: 'learning', label: '학습', x: 20, y: 455, w: 560, h: 445, color: '#16a34a' },
    { key: 'lobby', label: '로비', x: 600, y: 330, w: 240, h: 290, color: '#2743F2' },
    { key: 'avatar', label: '꾸미기·상점·랭킹', x: 660, y: 20, w: 760, h: 190, color: '#c026d3' },
    { key: 'game', label: '게임', x: 860, y: 230, w: 560, h: 670, color: '#ea580c' },
];

// 씬 → [x, y, 구역]. 여기 없는 씬은 지도 아래쪽 '기타' 줄에 자동으로 놓인다.
const AM_POS = {
    AssetBundleScene: [110, 110, 'boot'],
    TitleScene: [290, 110, 'boot'],
    CreateProfileScene: [470, 110, 'boot'],

    AILevelTestScene_L1: [100, 300, 'leveltest'],
    AILevelTestScene_L2: [240, 300, 'leveltest'],
    AILevelTestScene_L3: [380, 300, 'leveltest'],
    AILevelTestScene_L3_2: [500, 385, 'leveltest'],
    AILevelTestScene_L3_Retest: [300, 390, 'leveltest'],

    MainLobbyScene_v4: [720, 435, 'lobby'],
    '공통': [720, 560, 'lobby'],

    DailyStudyScene: [100, 540, 'learning'],
    ChallengeScene: [100, 650, 'learning'],
    FreeStudyScene: [100, 760, 'learning'],
    WorldStudyScene: [100, 860, 'learning'],
    Study_1: [290, 610, 'learning'],
    StageResultScene: [470, 610, 'learning'],
    LearningResultScene: [300, 780, 'learning'],
    VideoCenterScene: [470, 800, 'learning'],

    InAppPurchaseScene: [730, 105, 'avatar'],
    DiaRankingScene: [850, 105, 'avatar'],
    AvatarContestScene: [970, 105, 'avatar'],
    IdolAvatarScene: [1090, 105, 'avatar'],
    FantasyAvatar_Lobby: [1220, 105, 'avatar'],
    FantasyAvatar_Play: [1350, 105, 'avatar'],

    MathRun_Lobby: [940, 320, 'game'],
    MathRun_Ingame: [1090, 290, 'game'],
    MathRun_Tutorial: [1090, 375, 'game'],
    RunGame_TitleScene: [1240, 320, 'game'],
    Rungame_practice_1: [1360, 320, 'game'],
    MathGalaxyLobby: [940, 470, 'game'],
    MathGalaxyInGame: [1090, 470, 'game'],
    MathLympics: [1240, 470, 'game'],
    MakeTenScene: [1360, 470, 'game'],
    MathBattleLobby: [940, 610, 'game'],
    MathBattleInGame: [1090, 610, 'game'],
    Speed_TitleScene: [1240, 610, 'game'],
    Speed_PlayScene: [1360, 610, 'game'],
    Card_SelectMode: [940, 750, 'game'],
    Card_SelectStage: [1090, 750, 'game'],
    Card_Play: [1240, 750, 'game'],
    Card_SelectRankingMode: [1090, 850, 'game'],
    Card_RankingPlay: [1240, 850, 'game'],
};

const amState = {
    scene: null,      // 선택한 씬
    api: null,        // 선택한 엔드포인트 key
    vb: { x: 0, y: 0, w: AM_W, h: AM_H },
    drag: null,
    moved: false,
};

// ---------------------------------------------------------------- 뼈대
function _amEnsureSkeleton() {
    const host = document.getElementById('ac-map-view');
    if (host.dataset.built) return;
    host.dataset.built = '1';
    host.innerHTML = '<div id="am-flat"></div><div id="am-holo" class="hidden"></div>';
    const root = document.getElementById('am-flat');
    root.innerHTML = `
        <div class="am-layout">
            <div class="bg-white rounded-xl border border-gray-100 shadow-sm am-stage">
                <div class="am-toolbar">
                    <div class="am-legend">
                        <span><i class="am-lg-pin"></i>핀 크기 = 부르는 API 수</span>
                        <span><i class="am-lg-line"></i>씬 이동</span>
                        <span><i class="am-lg-line am-lg-dash"></i>팝업을 거쳐 이동(추정)</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <button class="am-tool am-tool-wide" onclick="setApiMapMode('holo')" title="3D 홀로그램 지도로 보기"><i class="fas fa-cube mr-1"></i>홀로그램</button>
                        <button class="am-tool" onclick="zoomApiMap(1.25)" title="확대"><i class="fas fa-plus"></i></button>
                        <button class="am-tool" onclick="zoomApiMap(0.8)" title="축소"><i class="fas fa-minus"></i></button>
                        <button class="am-tool" onclick="resetApiMap()" title="전체 보기"><i class="fas fa-expand"></i></button>
                    </div>
                </div>
                <svg id="am-svg" class="am-svg" viewBox="0 0 ${AM_W} ${AM_H}" role="img" aria-label="씬과 API 호출 지도">
                    <defs>
                        <marker id="am-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                            <path d="M0,0 L10,5 L0,10 z" class="am-arrow-head"/>
                        </marker>
                        <marker id="am-arrow-hl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                            <path d="M0,0 L10,5 L0,10 z" class="am-arrow-head-hl"/>
                        </marker>
                    </defs>
                    <g id="am-world"></g>
                </svg>
                <div id="am-tip" class="am-tip hidden"></div>
            </div>
            <aside id="am-panel" class="bg-white rounded-xl border border-gray-100 shadow-sm am-panel"></aside>
        </div>`;
    const svg = document.getElementById('am-svg');
    svg.addEventListener('wheel', _amOnWheel, { passive: false });
    svg.addEventListener('pointerdown', _amOnDown);
    window.addEventListener('pointermove', _amOnMove);
    window.addEventListener('pointerup', _amOnUp);
}

// ---------------------------------------------------------------- 데이터
function _amCompute() {
    const all = acState.data.endpoints.filter(e => !e.unused);
    const filtered = _acFiltered(false);
    const filterOn = filtered.length !== all.length || filtered.some(x => x.calls.length !== x.ep.calls.length);

    const scenes = {};   // scene -> { eps:Set, hit:Set }
    const touch = s => (scenes[s] = scenes[s] || { eps: new Set(), hit: new Set() });
    all.forEach(ep => ep.calls.forEach(c => (c.scenes || []).forEach(s => touch(s).eps.add(ep.key))));
    filtered.forEach(({ ep, calls }) => calls.forEach(c => (c.scenes || []).forEach(s => touch(s).hit.add(ep.key))));
    (acState.data.flows || []).forEach(f => { touch(f.from); touch(f.to); });

    // 선택한 API 를 부르는 씬
    let apiScenes = null;
    if (amState.api) {
        const ep = acState.data.endpoints.find(e => e.key === amState.api);
        apiScenes = new Set((ep ? ep.calls : []).flatMap(c => c.scenes || []));
    }

    // 좌표 (미배치 씬은 아래 '기타' 줄)
    const pos = {};
    let extra = 0;
    Object.keys(scenes).forEach(s => {
        if (AM_POS[s]) pos[s] = AM_POS[s];
        else pos[s] = [720, 680 + 70 * extra++, 'etc'];  // 로비 구역 아래 빈 칸
    });
    return { scenes, filterOn, apiScenes, pos };
}

function _amRadius(n) {
    return n ? 9 + 3.2 * Math.sqrt(n) : 7;
}

// ---------------------------------------------------------------- 보기 전환 (홀로그램 / 평면)
// 홀로그램은 api-holo.js(ES 모듈, Three.js)를 처음 쓸 때 불러온다. WebGL·모듈 로드가 안 되면 평면으로 남는다.
const AM_MODE_KEY = 'oneproqa-apimap-mode';
let _amHoloModule = null;

function _amMode() {
    try { return localStorage.getItem(AM_MODE_KEY) || 'holo'; } catch (e) { return 'holo'; }
}

function setApiMapMode(mode) {
    try { localStorage.setItem(AM_MODE_KEY, mode); } catch (e) { /* 저장 불가 환경 무시 */ }
    renderApiMap();
}

function renderApiMap() {
    if (!acState.data) return;
    _amEnsureSkeleton();
    const holo = _amMode() === 'holo';
    document.getElementById('am-flat').classList.toggle('hidden', holo);
    document.getElementById('am-holo').classList.toggle('hidden', !holo);
    if (!holo) {
        if (_amHoloModule && _amHoloModule.pause) _amHoloModule.pause();
        _amRenderFlat();
        return;
    }
    if (!_amHoloModule) {
        _amHoloModule = import('./api-holo.js').then(m => m.createHolo(document.getElementById('am-holo')))
            .catch(e => {
                console.error('[API 홀로그램 지도] 시작 실패', e);
                showToast('3D 지도를 열 수 없어 평면 지도로 보여줍니다.', 'error');
                _amHoloModule = null;
                setApiMapMode('flat');
                return null;
            });
    }
    Promise.resolve(_amHoloModule).then(h => {
        if (!h) return;
        _amHoloModule = h;
        if (_amMode() === 'holo' && acState.view === 'map') h.render();
    });
}

// ---------------------------------------------------------------- 평면 지도 그리기
function _amRenderFlat() {
    const { scenes, filterOn, apiScenes, pos } = _amCompute();
    if (amState.scene && !scenes[amState.scene]) amState.scene = null;

    const sel = amState.scene;
    const lit = s => {
        if (apiScenes) return apiScenes.has(s);
        if (filterOn) return scenes[s].hit.size > 0;
        return true;
    };

    const parts = [];
    // 구역
    AM_DISTRICTS.forEach(d => {
        parts.push(`<g class="am-district">
            <rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="22" style="fill:${d.color};stroke:${d.color}"/>
            <text x="${d.x + 18}" y="${d.y + 28}" style="fill:${d.color}">${escapeHtml(d.label)}</text>
        </g>`);
    });

    // 이동 선 — 같은 두 씬 사이 왕복은 곡률을 반대로 줘서 겹치지 않게
    const flows = acState.data.flows || [];
    flows.forEach(f => {
        const a = pos[f.from], b = pos[f.to];
        if (!a || !b) return;
        const ra = _amRadius(scenes[f.from].eps.size) + 3, rb = _amRadius(scenes[f.to].eps.size) + 5;
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const x1 = a[0] + ux * ra, y1 = a[1] + uy * ra, x2 = b[0] - ux * rb, y2 = b[1] - uy * rb;
        const bend = Math.min(40, len * 0.12);
        const cx = (x1 + x2) / 2 - uy * bend, cy = (y1 + y2) / 2 + ux * bend;
        // API 를 고른 동안은 씬 이동선 강조를 끄고, 그 API 를 부르는 씬끼리의 선만 남긴다
        const hl = !apiScenes && sel && (f.from === sel || f.to === sel);
        let dim;
        if (apiScenes) dim = !(lit(f.from) && lit(f.to));
        else if (sel) dim = !hl;
        else dim = !lit(f.from) && !lit(f.to);
        const popup = f.kinds.length === 1 && f.kinds[0] === 'popup';
        parts.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}"
            class="am-edge ${hl ? 'hl' : ''} ${dim ? 'dim' : ''} ${popup ? 'popup' : ''}" marker-end="url(#${hl ? 'am-arrow-hl' : 'am-arrow'})"
            data-tip="${escapeHtml(`${_acSceneLabel(f.from)} → ${_acSceneLabel(f.to)}${popup ? ' (팝업 경유 추정)' : ''}`)}"/>`);
    });

    // 핀
    Object.keys(scenes).forEach(s => {
        const [x, y, dk] = pos[s];
        const d = AM_DISTRICTS.find(z => z.key === dk) || { color: '#94a3b8' };
        const n = scenes[s].eps.size, hit = scenes[s].hit.size;
        const r = _amRadius(n);
        const on = lit(s);
        const isSel = s === sel;
        const common = s === '공통';
        const badge = (filterOn && !apiScenes && hit && hit !== n) ? `<g class="am-badge"><circle cx="${x + r * 0.75}" cy="${y - r * 0.75}" r="10"/><text x="${x + r * 0.75}" y="${y - r * 0.75 + 4}">${hit}</text></g>` : '';
        parts.push(`<g class="am-node ${on ? '' : 'dim'} ${isSel ? 'sel' : ''} ${apiScenes && on ? 'pin' : ''} ${common ? 'common' : ''}"
                data-scene="${escapeHtml(s)}" data-tip="${escapeHtml(`${_acSceneLabel(s)} · API ${n}개`)}" tabindex="0" role="button" aria-label="${escapeHtml(_acSceneLabel(s))}">
            ${apiScenes && on ? `<circle class="am-pulse" cx="${x}" cy="${y}" r="${r + 6}" style="stroke:${d.color}"/>` : ''}
            <circle class="am-dot ${n ? '' : 'empty'}" cx="${x}" cy="${y}" r="${r}" style="${n ? `fill:${d.color}` : `stroke:${d.color}`}"/>
            ${n && r >= 13 ? `<text class="am-count" x="${x}" y="${y + 4}">${n}</text>` : ''}
            <text class="am-label" x="${x}" y="${y + r + 15}">${escapeHtml(_acSceneLabel(s).replace(/ \(.*\)$/, ''))}</text>
            ${badge}
        </g>`);
    });

    const world = document.getElementById('am-world');
    world.innerHTML = parts.join('');
    world.querySelectorAll('.am-node').forEach(g => {
        g.addEventListener('click', () => { if (!amState.moved) selectApiMapScene(g.dataset.scene); });
        g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectApiMapScene(g.dataset.scene); } });
    });
    world.querySelectorAll('[data-tip]').forEach(el => {
        el.addEventListener('pointerenter', ev => _amTip(el.dataset.tip, ev));
        el.addEventListener('pointermove', ev => _amTip(el.dataset.tip, ev));
        el.addEventListener('pointerleave', () => _amTip(null));
    });
    _amApplyViewBox();
    document.getElementById('am-panel').innerHTML = _amPanelHtml(scenes, apiScenes);
}

function _amTip(text, ev) {
    const tip = document.getElementById('am-tip');
    if (!text) { tip.classList.add('hidden'); return; }
    const box = tip.parentElement.getBoundingClientRect();
    tip.textContent = text;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(ev.clientX - box.left + 12, box.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${ev.clientY - box.top + 14}px`;
}

// ---------------------------------------------------------------- 패널 내용 (평면 오른쪽 칸 / 홀로그램 떠 있는 패널)
function _amPanelHtml(scenes, apiScenes) {
    const flows = acState.data.flows || [];

    if (amState.api) {
        const ep = acState.data.endpoints.find(e => e.key === amState.api);
        if (!ep) { amState.api = null; return _amPanelHtml(scenes, null); }
        const rows = ep.calls.map(c => `
            <li class="am-item">
                <div class="flex flex-wrap gap-1 mb-1">${(c.scenes || []).map(s => `<button class="ac-scene" onclick="selectApiMapScene('${escapeHtml(s)}', true)">${escapeHtml(_acSceneLabel(s))}</button>`).join('') || '<span class="text-xs text-gray-400">씬 미상</span>'}</div>
                <div class="text-xs font-bold text-slate-800">${escapeHtml(c.screen || '')}</div>
                <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(c.trigger || '')}</div>
            </li>`).join('');
        return `
            <button class="am-back" onclick="selectApiMapApi(null)"><i class="fas fa-arrow-left mr-1"></i>${amState.scene ? escapeHtml(_acSceneLabel(amState.scene)) : '지도'}로 돌아가기</button>
            <div class="flex flex-wrap items-center gap-1.5 mt-2">${_acHttpBadges(ep)}<span class="font-bold text-slate-800">${escapeHtml(ep.name || ep.key)}</span></div>
            ${(ep.paths || []).map(p => `<div class="font-mono ac-path mt-1">${escapeHtml(p)}</div>`).join('')}
            ${ep.desc ? `<div class="text-xs text-gray-500 mt-2">${escapeHtml(ep.desc)}</div>` : ''}
            <div class="am-sub">지도에 켜진 씬 ${apiScenes ? apiScenes.size : 0}곳에서 부릅니다 · 호출 지점 ${ep.calls.length}곳</div>
            <ul class="am-list">${rows}</ul>`;
    }

    if (!amState.scene) {
        const top = Object.entries(scenes).filter(([, v]) => v.eps.size).sort((a, b) => b[1].eps.size - a[1].eps.size).slice(0, 8);
        return `
            <div class="font-bold text-slate-800 mb-1">씬을 눌러 보세요</div>
            <div class="text-xs text-gray-500 leading-relaxed">핀을 누르면 그 씬에서 부르는 API 가 여기 나옵니다. API 를 누르면 그 API 를 부르는 씬이 지도에 켜집니다.
                위쪽 검색·HTTP·묶음 필터를 걸면 해당하는 씬만 밝게 남고, 핀 오른쪽 위 숫자는 걸린 API 수입니다.</div>
            <div class="am-sub">API 를 많이 부르는 씬</div>
            <ul class="am-list">${top.map(([s, v]) => `
                <li><button class="am-row" onclick="selectApiMapScene('${escapeHtml(s)}')"><span>${escapeHtml(_acSceneLabel(s))}</span><span class="ac-scene-n">${v.eps.size}</span></button></li>`).join('')}
            </ul>`;
    }

    const s = amState.scene;
    const inc = [...new Set(flows.filter(f => f.to === s).map(f => f.from))];
    const out = [...new Set(flows.filter(f => f.from === s).map(f => f.to))];
    const chips = list => list.length
        ? list.map(x => `<button class="ac-scene" onclick="selectApiMapScene('${escapeHtml(x)}', true)">${escapeHtml(_acSceneLabel(x))}</button>`).join('')
        : '<span class="text-xs text-gray-400">없음</span>';

    // 이 씬의 API (필터 반영) — 엔드포인트 하나에 대표 상황 하나
    const list = _acFiltered(false)
        .map(({ ep, calls }) => ({ ep, c: calls.find(c => (c.scenes || []).includes(s)) }))
        .filter(x => x.c);
    return `
        <div class="flex items-baseline gap-2 flex-wrap">
            <div class="text-lg font-bold text-slate-800">${escapeHtml(_acSceneLabel(s))}</div>
            <span class="font-mono text-xs text-gray-400">${escapeHtml(s)}</span>
        </div>
        <div class="am-sub">들어오는 곳</div><div class="flex flex-wrap">${chips(inc)}</div>
        <div class="am-sub">나가는 곳</div><div class="flex flex-wrap">${chips(out)}</div>
        <div class="am-sub">이 씬에서 부르는 API ${list.length}개 <button class="am-link" onclick="openApiCatalogScene('${escapeHtml(s)}')">씬별 표로 보기</button></div>
        <ul class="am-list">${list.map(({ ep, c }) => `
            <li><button class="am-api" onclick="selectApiMapApi('${escapeHtml(ep.key)}')">
                <div class="flex flex-wrap items-center gap-1.5">${_acHttpBadges(ep)}<span class="font-bold text-slate-800 text-sm">${escapeHtml(ep.name || ep.key)}</span></div>
                <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(c.trigger || '')}</div>
            </button></li>`).join('') || '<li class="text-xs text-gray-400">이 씬에서 부르는 API 가 없습니다.</li>'}
        </ul>`;
}

function selectApiMapScene(scene, focus) {
    amState.scene = amState.scene === scene && !focus ? null : scene;
    amState.api = null;
    renderApiMap();
}

function clearApiMapSelection() {
    amState.scene = null;
    amState.api = null;
    renderApiMap();
}

function selectApiMapApi(key) {
    amState.api = key;
    renderApiMap();
}

// ---------------------------------------------------------------- 확대·이동
function _amApplyViewBox() {
    const v = amState.vb;
    const svg = document.getElementById('am-svg');
    if (svg) svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

function _amZoomAt(f, px, py) {
    const v = amState.vb;
    const w = Math.min(AM_W * 1.5, Math.max(AM_W / 6, v.w / f));
    const k = w / v.w;
    v.x = px - (px - v.x) * k;
    v.y = py - (py - v.y) * k;
    v.w = w;
    v.h = v.h * k;
    _amApplyViewBox();
}

function zoomApiMap(f) {
    const v = amState.vb;
    _amZoomAt(f, v.x + v.w / 2, v.y + v.h / 2);
}

function resetApiMap() {
    amState.vb = { x: 0, y: 0, w: AM_W, h: AM_H };
    _amApplyViewBox();
}

function _amSvgPoint(ev) {
    const svg = document.getElementById('am-svg');
    const r = svg.getBoundingClientRect();
    const v = amState.vb;
    // viewBox 는 preserveAspectRatio=xMidYMid meet — 실제 그려지는 배율로 환산
    const s = Math.min(r.width / v.w, r.height / v.h);
    const ox = (r.width - v.w * s) / 2, oy = (r.height - v.h * s) / 2;
    return { x: v.x + (ev.clientX - r.left - ox) / s, y: v.y + (ev.clientY - r.top - oy) / s, s };
}

function _amOnWheel(ev) {
    ev.preventDefault();
    const p = _amSvgPoint(ev);
    _amZoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
}

function _amOnDown(ev) {
    if (ev.button !== 0) return;
    const p = _amSvgPoint(ev);
    amState.drag = { cx: ev.clientX, cy: ev.clientY, x: amState.vb.x, y: amState.vb.y, s: p.s };
    amState.moved = false;
}

function _amOnMove(ev) {
    const d = amState.drag;
    if (!d) return;
    const dx = ev.clientX - d.cx, dy = ev.clientY - d.cy;
    if (!amState.moved && Math.hypot(dx, dy) < 4) return;
    amState.moved = true;
    document.getElementById('am-svg')?.classList.add('dragging');
    amState.vb.x = d.x - dx / d.s;
    amState.vb.y = d.y - dy / d.s;
    _amApplyViewBox();
}

function _amOnUp() {
    if (!amState.drag) return;
    amState.drag = null;
    document.getElementById('am-svg')?.classList.remove('dragging');
    // click 이벤트가 moved 를 본 뒤에 풀어준다
    setTimeout(() => { amState.moved = false; }, 0);
}
