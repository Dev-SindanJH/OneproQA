// =====================================================================
// API 호출 지도 — 3D 홀로그램 보기 (ES 모듈, Three.js)
// - api-map.js 가 처음 지도 보기를 열 때 import 한다
// - 구역 = 빛나는 판, 씬 = 홀로그램 기둥(높이 = 부르는 API 수), 씬 이동 = 빛이 흐르는 아치
// - 기둥을 누르면 그 위에 패널이 떠오르고, 패널에서 API 를 누르면 그 API 를 부르는 기둥에 광선이 선다
// - 선택·필터 상태와 패널 내용은 api-map.js(amState, _amCompute, _amPanelHtml)와 같이 쓴다
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 지도 좌표(AM_W×AM_H 픽셀) → 월드 좌표. 10px = 1
const SCALE = 0.1;
const toWorld = (px, py) => [(px - AM_W / 2) * SCALE, (py - AM_H / 2) * SCALE];

// 홀로그램용 네온 색 (구역 키 → 색)
const NEON = {
    boot: '#8fb3ff', leveltest: '#22d3ee', learning: '#4ade80', lobby: '#60a5fa',
    avatar: '#f472b6', game: '#fb923c', etc: '#94a3b8',
};
const OVERVIEW = { pos: new THREE.Vector3(0, 104, 120), target: new THREE.Vector3(0, 0, 8) };

// ---------------------------------------------------------------- 셰이더
// 기둥: 아래는 옅고 위로 갈수록 진해지며, 가로 주사선이 위로 흐른다
const PILLAR_VS = `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PILLAR_FS = `
    uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uBoost;
    varying vec2 vUv;
    void main() {
        float grad = mix(0.08, 0.7, vUv.y);
        float scan = 0.72 + 0.28 * sin(vUv.y * 46.0 - uTime * 3.2);
        float rim = smoothstep(0.92, 1.0, vUv.y) * 0.6;
        float a = (grad * scan + rim) * uOpacity;
        gl_FragColor = vec4(uColor * (0.55 + 0.5 * vUv.y) * uBoost, a * 0.8);
    }`;
// 광선: 아래가 진하고 위로 사라진다
const BEAM_FS = `
    uniform vec3 uColor; uniform float uTime; uniform float uOpacity;
    varying vec2 vUv;
    void main() {
        float fade = pow(1.0 - vUv.y, 1.6);
        float flick = 0.85 + 0.15 * sin(uTime * 9.0 + vUv.y * 20.0);
        gl_FragColor = vec4(uColor * 1.4, fade * flick * uOpacity);
    }`;
// 바닥 격자: 중심에서 멀어질수록 사라지고, 링 모양 파동이 퍼진다
const GRID_FS = `
    uniform float uTime; varying vec2 vUv;
    void main() {
        vec2 p = (vUv - 0.5) * vec2(180.0, 128.0);
        vec2 g = abs(fract(p / 4.0 - 0.5) - 0.5) / fwidth(p / 4.0);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float d = length(p / vec2(90.0, 64.0));
        float fade = smoothstep(1.0, 0.35, d);
        float wave = smoothstep(0.06, 0.0, abs(fract(d * 1.6 - uTime * 0.18) - 0.5) - 0.44) * 0.5;
        gl_FragColor = vec4(vec3(0.13, 0.75, 0.95), (line * 0.16 + wave * 0.06) * fade);
    }`;

export function createHolo(root) {
    // WebGL 확인 — 안 되면 throw 해서 api-map.js 가 평면으로 돌린다
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL 을 쓸 수 없습니다');

    root.innerHTML = `
        <div class="holo-stage" tabindex="-1">
            <div class="holo-canvas"></div>
            <svg class="holo-link" aria-hidden="true"><polyline points=""/><circle r="4"/></svg>
            <div class="holo-hud holo-hud-tl">
                <div class="holo-title"><i class="fas fa-satellite-dish"></i> SCENE · API HOLOMAP</div>
                <div class="holo-stats"></div>
            </div>
            <div class="holo-hud holo-hud-tr">
                <button class="holo-btn" data-act="rotate" title="자동 회전"><i class="fas fa-rotate"></i></button>
                <button class="holo-btn" data-act="reset" title="처음 시점"><i class="fas fa-expand"></i></button>
                <button class="holo-btn holo-btn-wide" data-act="flat" title="평면 지도로 보기"><i class="fas fa-map mr-1"></i>평면</button>
            </div>
            <div class="holo-hud holo-hud-bl">
                <span><i class="holo-lg-pillar"></i>기둥 높이 = 부르는 API 수</span>
                <span><i class="holo-lg-arc"></i>씬 이동 (빛이 가는 방향)</span>
                <span><i class="holo-lg-arc dash"></i>팝업 경유(추정)</span>
                <span class="holo-hint">드래그 회전 · 우클릭 드래그 이동 · 휠 확대 · Esc 선택 해제</span>
            </div>
            <div class="holo-hud holo-hud-br holo-top"></div>
            <div class="holo-panel hidden" role="dialog" aria-label="선택한 씬·API"></div>
            <div class="holo-scan" aria-hidden="true"></div>
        </div>`;
    const stage = root.querySelector('.holo-stage');
    const canvasHost = root.querySelector('.holo-canvas');
    const panel = root.querySelector('.holo-panel');
    const link = root.querySelector('.holo-link');
    const topCard = root.querySelector('.holo-top');

    // ------------------------------------------------------------ 렌더러
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    canvasHost.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'holo-labels';
    canvasHost.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#040912');
    scene.fog = new THREE.FogExp2('#040912', 0.0042);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 900);
    camera.position.copy(OVERVIEW.pos);

    const controls = new OrbitControls(camera, labels.domElement);
    controls.target.copy(OVERVIEW.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 25;
    controls.maxDistance = 240;
    controls.maxPolarAngle = 1.32;
    controls.autoRotateSpeed = 0.35;
    controls.autoRotate = true;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.22);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const time = { value: 0 };
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

    // ------------------------------------------------------------ 바닥판
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(180, 128),
        new THREE.ShaderMaterial({ uniforms: { uTime: time }, vertexShader: PILLAR_VS, fragmentShader: GRID_FS, ...additive, extensions: { derivatives: true } }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    // 판 테두리 이중선
    [[150, 98, 0.55], [154, 102, 0.18]].forEach(([w, h, o]) => {
        const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 2]].map(([x, z]) => new THREE.Vector3(x, 0.05, z));
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#22d3ee', opacity: o, ...additive })));
    });

    // 떠다니는 먼지
    const DUST = 420;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
        dustPos[i * 3] = (Math.random() - 0.5) * 160;
        dustPos[i * 3 + 1] = Math.random() * 40;
        dustPos[i * 3 + 2] = (Math.random() - 0.5) * 110;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#67e8f9', size: 0.28, opacity: 0.55, ...additive })));

    // ------------------------------------------------------------ 구역
    AM_DISTRICTS.forEach(d => {
        const [x0, z0] = toWorld(d.x, d.y);
        const w = d.w * SCALE, h = d.h * SCALE, r = 2.2;
        const shape = new THREE.Shape();
        shape.moveTo(x0 + r, z0);
        shape.lineTo(x0 + w - r, z0); shape.quadraticCurveTo(x0 + w, z0, x0 + w, z0 + r);
        shape.lineTo(x0 + w, z0 + h - r); shape.quadraticCurveTo(x0 + w, z0 + h, x0 + w - r, z0 + h);
        shape.lineTo(x0 + r, z0 + h); shape.quadraticCurveTo(x0, z0 + h, x0, z0 + h - r);
        shape.lineTo(x0, z0 + r); shape.quadraticCurveTo(x0, z0, x0 + r, z0);
        const color = NEON[d.key] || NEON.etc;
        const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }),
            new THREE.MeshBasicMaterial({ color, opacity: 0.028, ...additive }));
        slab.rotation.x = Math.PI / 2;   // shape 의 y 를 월드 z 로 눕힌다
        slab.position.y = 0.55;
        scene.add(slab);
        const outline = shape.getPoints(10).map(p => new THREE.Vector3(p.x, 0.6, p.y));
        outline.push(outline[0].clone());
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outline), new THREE.LineBasicMaterial({ color, opacity: 0.75, ...additive })));
        const tag = document.createElement('div');
        tag.className = 'holo-district';
        tag.style.setProperty('--c', color);
        tag.textContent = d.label;
        const obj = new CSS2DObject(tag);
        obj.position.set(x0 + 1.5, 0.8, z0 + 1.6);
        obj.center.set(0, 0);
        scene.add(obj);
    });

    // ------------------------------------------------------------ 씬 기둥
    const { scenes: sceneInfo, pos } = _amCompute();
    const nodes = {};          // scene -> node
    const hitMeshes = [];
    const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const capGeo = new THREE.CircleGeometry(1, 6);
    const ringGeo = new THREE.RingGeometry(1, 1.18, 48);
    const hitGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

    Object.keys(sceneInfo).forEach(s => {
        const [px, py, dk] = pos[s];
        const [x, z] = toWorld(px, py);
        const n = sceneInfo[s].eps.size;
        const color = new THREE.Color(NEON[dk] || NEON.etc);
        const r = 1.25 + 0.17 * Math.sqrt(n);
        const h = n ? 1.6 + 2.3 * Math.sqrt(n) : 0.7;
        const g = new THREE.Group();
        g.position.set(x, 0.6, z);

        const uni = { uColor: { value: color }, uTime: time, uOpacity: { value: 1 }, uBoost: { value: 1 } };
        const body = new THREE.Mesh(pillarGeo, new THREE.ShaderMaterial({ uniforms: uni, vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS, ...additive, side: THREE.DoubleSide }));
        body.scale.set(r, h, r);
        body.position.y = h / 2;
        g.add(body);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(r, r, h, 6)),
            new THREE.LineBasicMaterial({ color, opacity: 0.9, ...additive }));
        edges.position.y = h / 2;
        g.add(edges);
        const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color, opacity: 0.6, ...additive, side: THREE.DoubleSide }));
        cap.rotation.x = -Math.PI / 2;
        cap.scale.setScalar(r);
        cap.position.y = h + 0.02;
        g.add(cap);
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, opacity: 0.8, ...additive, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(r + 0.7);
        ring.position.y = 0.04;
        g.add(ring);
        // 선택한 API 를 부를 때 서는 광선과 퍼지는 고리
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.9, 46, 12, 1, true),
            new THREE.ShaderMaterial({ uniforms: { uColor: { value: color }, uTime: time, uOpacity: { value: 0.85 } }, vertexShader: PILLAR_VS, fragmentShader: BEAM_FS, ...additive, side: THREE.DoubleSide }));
        beam.position.y = h + 23;
        beam.visible = false;
        g.add(beam);
        const pulse = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, opacity: 0, ...additive, side: THREE.DoubleSide }));
        pulse.rotation.x = -Math.PI / 2;
        pulse.position.y = 0.08;
        pulse.visible = false;
        g.add(pulse);
        // 누르기 쉬운 투명 판정 기둥
        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.scale.set(r + 1, Math.max(h, 3) + 2, r + 1);
        hit.position.y = Math.max(h, 3) / 2;
        hit.userData.scene = s;
        g.add(hit);
        hitMeshes.push(hit);

        const lab = document.createElement('div');
        lab.className = 'holo-label';
        lab.style.setProperty('--c', NEON[dk] || NEON.etc);
        lab.innerHTML = `<span class="holo-label-name">${escapeHtml(_acSceneLabel(s).replace(/ \(.*\)$/, ''))}</span><span class="holo-label-n">${n}</span>`;
        lab.addEventListener('pointerdown', ev => ev.stopPropagation());
        lab.addEventListener('click', () => select(s));
        const labObj = new CSS2DObject(lab);
        labObj.position.set(0, h + 1.6, 0);
        labObj.center.set(0.5, 1);
        g.add(labObj);

        scene.add(g);
        nodes[s] = { s, g, body, uni, edges, cap, ring, beam, pulse, lab, h, r, color, n, top: new THREE.Vector3(x, 0.6 + h, z), base: new THREE.Vector3(x, 0.6, z) };
    });

    // ------------------------------------------------------------ 씬 이동 아치
    const arcs = [];
    const dotGeo = new THREE.SphereGeometry(0.32, 10, 8);
    (acState.data.flows || []).forEach(f => {
        const a = nodes[f.from], b = nodes[f.to];
        if (!a || !b) return;
        const start = a.base.clone().setY(0.9), end = b.base.clone().setY(0.9);
        const dist = start.distanceTo(end);
        // 왕복이 겹치지 않게 진행 방향 오른쪽으로 살짝 비튼다
        const dir = end.clone().sub(start).normalize();
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.min(4, dist * 0.08));
        const mid = start.clone().add(end).multiplyScalar(0.5).add(side).setY(3 + dist * 0.22);
        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const popup = f.kinds.length === 1 && f.kinds[0] === 'popup';
        const mat = new THREE.MeshBasicMaterial({ color: '#7dd3fc', opacity: 0.22, ...additive });
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, popup ? 0.05 : 0.08, 5, false), mat);
        scene.add(tube);
        const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#e0f2fe', opacity: 0.9, ...additive }));
        scene.add(dot);
        arcs.push({ f, curve, tube, mat, dot, popup, t: Math.random(), speed: 0.12 * (40 / Math.max(dist, 12)) });
    });

    // ------------------------------------------------------------ 상호작용
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered = null;
    let downAt = null;
    let paused = false;
    let autoRotate = true;
    let tween = null;           // { pos, target }
    let lastFocus = undefined;  // 카메라를 마지막으로 맞춘 씬

    function pick(ev) {
        const rect = labels.domElement.getBoundingClientRect();
        ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(hitMeshes, false)[0];
        return hit ? hit.object.userData.scene : null;
    }
    labels.domElement.addEventListener('pointerdown', ev => { downAt = [ev.clientX, ev.clientY]; });
    labels.domElement.addEventListener('pointermove', ev => {
        const s = pick(ev);
        if (s === hovered) return;
        if (hovered && nodes[hovered]) nodes[hovered].lab.classList.remove('hover');
        hovered = s;
        if (s) nodes[s].lab.classList.add('hover');
        labels.domElement.style.cursor = s ? 'pointer' : '';
    });
    labels.domElement.addEventListener('pointerup', ev => {
        if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 5 || ev.button !== 0) { downAt = null; return; }
        downAt = null;
        const s = pick(ev);
        if (s) select(s);
        else if (amState.scene || amState.api) clearApiMapSelection();
    });
    controls.addEventListener('start', () => { tween = null; setAutoRotate(false); });
    stage.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && (amState.scene || amState.api)) clearApiMapSelection();
    });
    root.querySelector('.holo-hud-tr').addEventListener('click', ev => {
        const act = ev.target.closest('[data-act]')?.dataset.act;
        if (act === 'flat') setApiMapMode('flat');
        if (act === 'rotate') setAutoRotate(!autoRotate);
        if (act === 'reset') { lastFocus = undefined; clearApiMapSelection(); flyTo(null); }
    });
    panel.addEventListener('pointerdown', ev => ev.stopPropagation());
    panel.addEventListener('wheel', ev => ev.stopPropagation(), { passive: true });

    function select(s) {
        selectApiMapScene(s, amState.scene !== s);
        stage.focus({ preventScroll: true });
    }

    function setAutoRotate(on) {
        autoRotate = on;
        controls.autoRotate = on;
        root.querySelector('[data-act="rotate"]').classList.toggle('on', on);
    }
    setAutoRotate(true);

    // 고른 씬 쪽으로 카메라를 옮긴다 — 지금 보는 방향은 유지
    function flyTo(s) {
        if (!s) { tween = { pos: OVERVIEW.pos.clone(), target: OVERVIEW.target.clone() }; return; }
        const nd = nodes[s];
        const target = nd.base.clone().setY(0.6 + nd.h * 0.45);
        const dir = camera.position.clone().sub(controls.target).normalize();
        dir.y = Math.max(dir.y, 0.55);
        dir.normalize();
        tween = { pos: target.clone().add(dir.multiplyScalar(48 + nd.h * 1.2)), target };
    }

    // ------------------------------------------------------------ 상태 반영 (api-map.js 가 호출)
    let panelKey = '';
    function render() {
        paused = false;
        stage.classList.remove('paused');
        const { scenes, filterOn, apiScenes } = _amCompute();
        const sel = amState.scene;
        const lit = s => (apiScenes ? apiScenes.has(s) : filterOn ? (scenes[s]?.hit.size || 0) > 0 : true);

        Object.values(nodes).forEach(nd => {
            const on = lit(nd.s);
            const isSel = nd.s === sel;
            const pinned = !!apiScenes && on;
            const faded = !on || (sel && !isSel && !apiScenes && !isNeighbor(nd.s, sel));
            nd.uni.uOpacity.value = faded ? 0.12 : 1;
            nd.uni.uBoost.value = isSel || pinned ? 1.5 : 1;
            nd.edges.material.opacity = faded ? 0.12 : isSel ? 1 : 0.85;
            nd.cap.material.opacity = faded ? 0.08 : 0.6;
            nd.ring.material.opacity = faded ? 0.15 : isSel ? 1 : 0.7;
            nd.beam.visible = pinned;
            nd.pulse.visible = pinned || isSel;
            const hit = scenes[nd.s]?.hit.size || 0;
            nd.lab.classList.toggle('dim', faded);
            nd.lab.classList.toggle('sel', isSel);
            nd.lab.classList.toggle('pin', pinned);
            nd.lab.querySelector('.holo-label-n').textContent = filterOn && !apiScenes && hit !== nd.n ? `${hit}/${nd.n}` : nd.n;
        });
        arcs.forEach(a => {
            const hl = !apiScenes && sel && (a.f.from === sel || a.f.to === sel);
            let dim;
            if (apiScenes) dim = !(lit(a.f.from) && lit(a.f.to));
            else if (sel) dim = !hl;
            else dim = !lit(a.f.from) && !lit(a.f.to);
            a.mat.opacity = hl ? 0.95 : dim ? 0.03 : a.popup ? 0.14 : 0.22;
            a.mat.color.set(hl ? '#f0f9ff' : '#7dd3fc');
            a.dot.visible = !dim;
            a.dot.scale.setScalar(hl ? 1.5 : 1);
            a.hl = hl;
        });

        // 통계 HUD
        const flows = acState.data.flows || [];
        const used = acState.data.endpoints.filter(e => !e.unused).length;
        root.querySelector('.holo-stats').innerHTML =
            `<span>씬 <b>${Object.keys(nodes).length}</b></span><span>API <b>${used}</b></span><span>이동선 <b>${flows.length}</b></span>` +
            (filterOn ? `<span class="holo-filter">필터 적용 중 · 걸린 씬 <b>${Object.keys(scenes).filter(s => scenes[s].hit.size).length}</b></span>` : '');

        // 아무것도 안 골랐을 때만 오른쪽 아래 'API 많이 부르는 씬'
        const showTop = !sel && !amState.api;
        topCard.classList.toggle('hidden', !showTop);
        if (showTop) {
            const top = Object.entries(scenes).filter(([, v]) => v.eps.size).sort((a, b) => b[1].eps.size - a[1].eps.size).slice(0, 5);
            topCard.innerHTML = `<div class="holo-top-title">API 를 많이 부르는 씬</div>` + top.map(([s, v]) =>
                `<button onclick="selectApiMapScene('${escapeHtml(s)}', true)"><span>${escapeHtml(_acSceneLabel(s))}</span><b>${v.eps.size}</b></button>`).join('') +
                `<div class="holo-top-hint">기둥을 누르면 그 위에 API 목록이 뜹니다</div>`;
        }

        // 떠 있는 패널
        const open = !!(sel || amState.api);
        const key = `${sel}|${amState.api}|${document.getElementById('ac-search').value}|${[...acState.http]}|${acState.group}`;
        if (open) {
            panel.innerHTML = `<button class="holo-close" title="닫기 (Esc)" onclick="clearApiMapSelection()"><i class="fas fa-xmark"></i></button>
                <div class="holo-panel-body">${_amPanelHtml(scenes, apiScenes)}</div>`;
            if (key !== panelKey || panel.classList.contains('hidden')) {
                panel.classList.remove('hidden', 'open');
                void panel.offsetWidth;   // 등장 애니메이션 다시 재생
                panel.classList.add('open');
            }
        } else {
            panel.classList.add('hidden');
        }
        panelKey = key;

        // 카메라: 초점이 바뀌었을 때만 이동. API 를 고르면 켜진 기둥이 다 보이게 전체 시점으로 뺀다
        const focus = amState.api ? '@api' : (sel || null);
        if (focus !== lastFocus) {
            lastFocus = focus;
            if (focus && focus !== '@api') { setAutoRotate(false); flyTo(sel); }
            else flyTo(null);
        }
    }

    function isNeighbor(s, sel) {
        return (acState.data.flows || []).some(f => (f.from === sel && f.to === s) || (f.to === sel && f.from === s));
    }

    // ------------------------------------------------------------ 패널을 기둥 위에 붙이기
    const tmp = new THREE.Vector3();
    function placePanel(W, H) {
        const poly = link.querySelector('polyline');
        const dot = link.querySelector('circle');
        if (panel.classList.contains('hidden')) { link.classList.add('hidden'); return; }
        const pw = panel.offsetWidth, ph = panel.offsetHeight;
        const nd = amState.scene && nodes[amState.scene];
        if (!nd) {
            // API 만 고른 경우: 오른쪽 위에 붙인다
            panel.style.transform = `translate(${W - pw - 16}px, 64px)`;
            link.classList.add('hidden');
            return;
        }
        tmp.copy(nd.top).project(camera);
        const sx = (tmp.x + 1) / 2 * W, sy = (1 - tmp.y) / 2 * H;
        const right = sx < W * 0.56;
        let px = right ? sx + 70 : sx - 70 - pw;
        let py = sy - ph * 0.35 - 40;
        px = Math.max(12, Math.min(W - pw - 12, px));
        py = Math.max(56, Math.min(H - ph - 12, py));
        panel.style.transform = `translate(${px}px, ${py}px)`;
        const ex = right ? px : px + pw, ey = Math.min(Math.max(sy - 30, py + 22), py + ph - 22);
        const kx = right ? ex - 26 : ex + 26;
        poly.setAttribute('points', `${sx},${sy} ${kx},${ey} ${ex},${ey}`);
        dot.setAttribute('cx', sx);
        dot.setAttribute('cy', sy);
        link.classList.remove('hidden');
    }

    // ------------------------------------------------------------ 루프
    let W = 0, H = 0;
    function resize() {
        const w = canvasHost.clientWidth, h = canvasHost.clientHeight;
        if (!w || !h || (w === W && h === H)) return;
        W = w; H = h;
        renderer.setSize(w, h);
        labels.setSize(w, h);
        composer.setSize(w, h);
        bloom.resolution.set(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        link.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    new ResizeObserver(resize).observe(canvasHost);

    const clock = new THREE.Clock();
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) setAutoRotate(false);

    function frame() {
        requestAnimationFrame(frame);
        if (paused || !stage.offsetParent) return;   // 다른 보기·탭이면 그리지 않는다
        resize();
        const dt = Math.min(clock.getDelta(), 0.05);
        time.value += reduceMotion ? 0 : dt;

        if (tween) {
            camera.position.lerp(tween.pos, 0.075);
            controls.target.lerp(tween.target, 0.075);
            if (camera.position.distanceTo(tween.pos) < 0.2) tween = null;
        }
        controls.update();

        if (!reduceMotion) {
            arcs.forEach(a => {
                if (!a.dot.visible) return;
                a.t = (a.t + dt * a.speed * (a.hl ? 1.8 : 1)) % 1;
                a.dot.position.copy(a.curve.getPoint(a.t));
            });
            const pa = dustGeo.attributes.position.array;
            for (let i = 1; i < pa.length; i += 3) { pa[i] += dt * 0.6; if (pa[i] > 40) pa[i] = 0; }
            dustGeo.attributes.position.needsUpdate = true;
        }
        const k = (time.value * 0.7) % 1;
        Object.values(nodes).forEach(nd => {
            if (!nd.pulse.visible) return;
            nd.pulse.scale.setScalar(nd.r + 0.8 + k * 5);
            nd.pulse.material.opacity = (1 - k) * 0.8;
        });

        composer.render();
        labels.render(scene, camera);
        placePanel(W, H);
    }
    resize();
    requestAnimationFrame(frame);

    return {
        render,
        pause() { paused = true; stage.classList.add('paused'); },
    };
}
