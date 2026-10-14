// =====================================================================
// [QAI] 스테이지 검수 탭
// - 데이터: Supabase stage_audit_runs / stage_audit_rules / stage_audit_findings
// - 적재: tools/stage_audit/stage_audit.py --upload (페이지는 읽기 + QA 확인 칸 수정만 가능)
// - script.js 의 supabaseClient, escapeHtml, showToast, formatKST, openModal, closeModal 사용
// =====================================================================

const SA_PAGE_SIZE = 50;
const SA_CATEGORIES = [
    { key: 'all', label: '전체' },
    { key: 'timescale', label: '배속' },
    { key: 'qcount', label: '문제 수' },
    { key: 'asset', label: '리소스' },
    { key: 'locale', label: '현지화' },
];
const SA_CATEGORY_LABEL = { timescale: '배속', qcount: '문제 수', asset: '리소스', locale: '현지화' };
const SA_SEV_LABEL = { high: '높음', medium: '중간', low: '낮음' };
const SA_SEV_RANK = { high: 2, medium: 1, low: 0 };

const saState = {
    loaded: false,
    runs: [],
    runId: null,
    rules: {},
    findings: [],
    category: 'all',
    rule: null,
    view: 'stage',
    page: 1,
    rows: [],
    detailId: null,
};

// ---------------------------------------------------------------- 로드
async function loadStageAudit(force) {
    if (saState.loaded && !force) return;
    _saShow('loading');
    try {
        const [runsRes, rulesRes] = await Promise.all([
            supabaseClient.from('stage_audit_runs').select('*').order('id', { ascending: false }).limit(50),
            supabaseClient.from('stage_audit_rules').select('*').order('sort'),
        ]);
        if (runsRes.error) throw runsRes.error;
        if (rulesRes.error) throw rulesRes.error;
        saState.runs = runsRes.data || [];
        saState.rules = Object.fromEntries((rulesRes.data || []).map(r => [r.code, r]));
        if (!saState.runs.length) {
            _saShow('empty', '아직 업로드된 검수 결과가 없습니다.<br><span class="text-xs">OneproQA/tools/stage_audit 에서 <code>python -I stage_audit.py --upload</code> 를 실행해 주세요.</span>');
            return;
        }
        if (!saState.runId || !saState.runs.some(r => r.id === saState.runId)) {
            saState.runId = saState.runs[0].id;
        }
        _saRenderRunSelect();
        await _saLoadFindings();
        saState.loaded = true;
    } catch (e) {
        console.error('[QAI 스테이지 검수] 로드 실패', e);
        _saShow('empty', `검수 결과를 불러오지 못했습니다.<br><span class="text-xs">${escapeHtml(e.message || e)}</span>`);
    }
}

async function _saLoadFindings() {
    _saShow('loading');
    const all = [];
    const step = 1000;
    for (let from = 0; ; from += step) {
        const { data, error } = await supabaseClient
            .from('stage_audit_findings')
            .select('*')
            .eq('run_id', saState.runId)
            .order('id')
            .range(from, from + step - 1);
        if (error) throw error;
        all.push(...data);
        if (data.length < step) break;
    }
    saState.findings = all;
    _saFillLevelFilter();
    _saShow('content');
    renderStageAudit(true);
}

async function onStageAuditRunChange() {
    saState.runId = Number(document.getElementById('sa-run-select').value);
    try {
        await _saLoadFindings();
    } catch (e) {
        showToast('검수 결과를 불러오지 못했습니다.', 'error');
    }
}

function _saShow(which, emptyHtml) {
    document.getElementById('sa-loading').classList.toggle('hidden', which !== 'loading');
    document.getElementById('sa-content').classList.toggle('hidden', which !== 'content');
    const empty = document.getElementById('sa-empty');
    empty.classList.toggle('hidden', which !== 'empty');
    if (which === 'empty') empty.innerHTML = emptyHtml || '';
}

function _saRenderRunSelect() {
    const sel = document.getElementById('sa-run-select');
    sel.innerHTML = saState.runs.map(r => {
        const label = `#${r.id} · ${formatKST(r.created_at)} · ${r.unity_branch || '-'}@${r.unity_commit || '-'}`;
        return `<option value="${r.id}" ${r.id === saState.runId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

function _saFillLevelFilter() {
    const sel = document.getElementById('sa-f-level');
    const prev = sel.value || 'all';
    const levels = [...new Set(saState.findings.map(f => f.level).filter(l => l != null))].sort((a, b) => a - b);
    sel.innerHTML = `<option value="all">전체</option>` + levels.map(l => `<option value="${l}">Level ${l}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'all';
}

// ---------------------------------------------------------------- 필터
function _saStageLabel(f) {
    if (f.stage_id != null) return `#${f.stage_id}`;
    const [kind, name] = f.stage_key.split('/');
    if (kind === 'common') return `공통 코드 · ${name}`;
    if (kind === 'prefab') return `미사용 프리팹 · ${name}`;
    return `미사용 · ${name}`;
}

function _saBaseFiltered() {
    const level = document.getElementById('sa-f-level').value;
    const sev = document.getElementById('sa-f-sev').value;
    const ai = document.getElementById('sa-f-ai').value;
    const qa = document.getElementById('sa-f-qa').value;
    const includeUnused = document.getElementById('sa-f-unused').checked;
    const q = document.getElementById('sa-search').value.trim().toLowerCase();
    return saState.findings.filter(f => {
        if (!includeUnused && f.in_use !== true) return false;
        if (level !== 'all' && String(f.level) !== level) return false;
        if (sev !== 'all' && f.severity !== sev) return false;
        if (ai !== 'all' && f.ai_verdict !== ai) return false;
        if (qa !== 'all' && f.qa_status !== qa) return false;
        if (q) {
            const hay = [f.stage_key, f.stage_id, f.prefab, f.stage_code, f.rule_code,
                         ...(f.locations || []).map(l => l.file)].join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}

function setStageAuditCategory(cat) {
    saState.category = cat;
    saState.rule = null;
    renderStageAudit(true);
}

function setStageAuditRule(code) {
    saState.rule = saState.rule === code ? null : code;
    renderStageAudit(true);
}

function setStageAuditView(view) {
    saState.view = view;
    document.getElementById('sa-view-stage').classList.toggle('active', view === 'stage');
    document.getElementById('sa-view-finding').classList.toggle('active', view === 'finding');
    renderStageAudit(true);
}

// ---------------------------------------------------------------- 렌더
function renderStageAudit(resetPage) {
    if (resetPage) saState.page = 1;
    const base = _saBaseFiltered();
    _saRenderRunBar();
    _saRenderSummary(base);
    _saRenderCategoryTabs(base);

    const inCat = base.filter(f => saState.category === 'all' || f.category === saState.category);
    _saRenderRuleChips(inCat);
    const filtered = inCat.filter(f => !saState.rule || f.rule_code === saState.rule);

    if (saState.view === 'stage') _saRenderStageTable(filtered);
    else _saRenderFindingTable(filtered);
}

function _saRenderRunBar() {
    const run = saState.runs.find(r => r.id === saState.runId);
    if (!run) return;
    const s = run.stats || {};
    const item = (icon, text) => `<span><i class="fas ${icon} mr-1"></i>${text}</span>`;
    document.getElementById('sa-run-bar').innerHTML = [
        item('fa-clock', escapeHtml(formatKST(run.created_at))),
        item('fa-code-branch', `${escapeHtml(run.unity_branch || '-')} @ <span class="font-mono">${escapeHtml(run.unity_commit || '-')}</span>`),
        item('fa-database', `마스터데이터: ${escapeHtml(run.master_data_source || '-')}`),
        item('fa-file-code', `스크립트 ${s.cs_files ?? '-'} · 프리팹 ${s.prefab_files ?? '-'}`),
        item('fa-microscope', `스캐너 v${escapeHtml(run.scanner_version || '-')}`),
        run.note ? item('fa-note-sticky', escapeHtml(run.note)) : '',
    ].join('');
}

function _saRenderSummary(base) {
    const run = saState.runs.find(r => r.id === saState.runId) || {};
    const s = run.stats || {};
    const stages = new Set(base.filter(f => f.stage_id != null).map(f => f.stage_id));
    const sev = { high: 0, medium: 0, low: 0 };
    base.forEach(f => sev[f.severity]++);
    const checked = base.filter(f => f.qa_status !== '미확인').length;
    const card = (label, value, sub, cls = '') => `
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 ${cls}">
            <div class="text-xs text-gray-500 mb-1">${label}</div>
            <div class="text-2xl font-black text-slate-800">${value}</div>
            ${sub ? `<div class="text-xs text-gray-500 mt-1">${sub}</div>` : ''}
        </div>`;
    document.getElementById('sa-summary').innerHTML = [
        card('검사한 스테이지', s.master_stages ?? '-', '운영 마스터데이터 기준'),
        card('의심 지점이 있는 스테이지', stages.size, `걸린 곳 없음 ${s.stages_clean ?? '-'}개`),
        card('검수 항목', base.length,
             `<span class="sa-sev sa-sev-high">높음 ${sev.high}</span> <span class="sa-sev sa-sev-medium">중간 ${sev.medium}</span> <span class="sa-sev sa-sev-low">낮음 ${sev.low}</span>`),
        card('QAI 판정 완료', base.filter(f => f.ai_verdict !== '미판정').length, `문제 있음 ${base.filter(f => f.ai_verdict === '문제 있음').length}`),
        card('QA 확인 진행', `${checked}<span class="text-sm text-gray-500 font-bold"> / ${base.length}</span>`,
             `재현됨 ${base.filter(f => f.qa_status === '재현됨').length} · 수정 완료 ${base.filter(f => f.qa_status === '수정 완료').length}`),
    ].join('');
}

function _saRenderCategoryTabs(base) {
    document.getElementById('sa-cat-tabs').innerHTML = SA_CATEGORIES.map(c => {
        const n = c.key === 'all' ? base.length : base.filter(f => f.category === c.key).length;
        return `<button onclick="setStageAuditCategory('${c.key}')" class="md-tab-btn ${saState.category === c.key ? 'active' : ''}">${c.label} <span class="md-tab-count">${n}</span></button>`;
    }).join('');
}

function _saRenderRuleChips(inCat) {
    const counts = {};
    inCat.forEach(f => { counts[f.rule_code] = (counts[f.rule_code] || 0) + 1; });
    const rules = Object.values(saState.rules)
        .filter(r => saState.category === 'all' || r.category === saState.category)
        .filter(r => counts[r.code]);
    document.getElementById('sa-rule-chips').innerHTML = rules.map(r => `
        <button onclick="setStageAuditRule('${r.code}')" class="sa-rule-chip ${saState.rule === r.code ? 'active' : ''}" title="${escapeHtml(r.description || '')}">
            <span class="sa-dot sa-dot-${r.default_severity}"></span>${escapeHtml(r.title)} <span class="sa-rule-count">${counts[r.code]}</span>
        </button>`).join('');
}

function _saBadge(sev) {
    return `<span class="sa-sev sa-sev-${sev}">${SA_SEV_LABEL[sev] || sev}</span>`;
}

function _saStatusBadge(kind, value) {
    return `<span class="sa-status" data-kind="${kind}" data-v="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function _saStageCell(f) {
    const label = escapeHtml(_saStageLabel(f));
    const prefab = f.prefab ? `<div class="text-xs text-gray-500 font-mono">${escapeHtml(f.prefab)}</div>` : '';
    return `<div class="font-bold text-slate-800">${label}</div>${prefab}`;
}

function _saRenderStageTable(filtered) {
    const groups = new Map();
    filtered.forEach(f => {
        if (!groups.has(f.stage_key)) groups.set(f.stage_key, []);
        groups.get(f.stage_key).push(f);
    });
    const rows = [...groups.values()].map(list => {
        list.sort((a, b) => SA_SEV_RANK[b.severity] - SA_SEV_RANK[a.severity] || a.rule_code.localeCompare(b.rule_code));
        return { first: list[0], list, top: SA_SEV_RANK[list[0].severity] };
    });
    rows.sort((a, b) => b.top - a.top || b.list.length - a.list.length ||
                        (a.first.level ?? 99) - (b.first.level ?? 99) || (a.first.stage_id ?? 1e9) - (b.first.stage_id ?? 1e9));

    document.getElementById('sa-thead').innerHTML = `<tr>
        <th class="p-3 w-20">심각도</th><th class="p-3">스테이지</th><th class="p-3 w-24">코드</th>
        <th class="p-3 w-16 text-center">레벨</th><th class="p-3 w-16 text-center">문제 수</th>
        <th class="p-3">걸린 항목</th><th class="p-3 w-28 text-center">QA 확인</th></tr>`;

    _saPaginate(rows, r => {
        const f = r.first;
        const chips = r.list.map(x => `
            <button onclick="openStageAuditDetail(${x.id})" class="sa-hit-chip sa-hit-${x.severity}" title="${escapeHtml(saState.rules[x.rule_code]?.description || '')}">
                ${escapeHtml(saState.rules[x.rule_code]?.title || x.rule_code)}<span class="sa-hit-n">${x.hit_count}</span>
                ${x.ai_verdict !== '미판정' ? `<span class="sa-hit-ai" data-v="${escapeHtml(x.ai_verdict)}">${escapeHtml(x.ai_verdict)}</span>` : ''}
            </button>`).join('');
        const done = r.list.filter(x => x.qa_status !== '미확인').length;
        return `<tr class="hover:bg-gray-50">
            <td class="p-3">${_saBadge(f.severity)}</td>
            <td class="p-3">${_saStageCell(f)}</td>
            <td class="p-3 font-mono text-xs text-gray-500">${escapeHtml(f.stage_code || '-')}</td>
            <td class="p-3 text-center">${f.level ?? '-'}</td>
            <td class="p-3 text-center">${f.problem_count ?? '-'}</td>
            <td class="p-3"><div class="flex flex-wrap gap-1">${chips}</div></td>
            <td class="p-3 text-center text-xs ${done === r.list.length ? 'text-emerald-600 font-bold' : 'text-gray-500'}">${done} / ${r.list.length}</td>
        </tr>`;
    }, 7);
}

function _saRenderFindingTable(filtered) {
    const rows = [...filtered].sort((a, b) => SA_SEV_RANK[b.severity] - SA_SEV_RANK[a.severity] ||
        (a.level ?? 99) - (b.level ?? 99) || (a.stage_id ?? 1e9) - (b.stage_id ?? 1e9));
    document.getElementById('sa-thead').innerHTML = `<tr>
        <th class="p-3 w-20">심각도</th><th class="p-3">스테이지</th><th class="p-3 w-16 text-center">레벨</th>
        <th class="p-3">항목</th><th class="p-3 w-16 text-center">지점</th>
        <th class="p-3 w-24 text-center">QAI 판정</th><th class="p-3 w-24 text-center">QA 확인</th></tr>`;
    _saPaginate(rows, f => `
        <tr class="hover:bg-gray-50 cursor-pointer" onclick="openStageAuditDetail(${f.id})">
            <td class="p-3">${_saBadge(f.severity)}</td>
            <td class="p-3">${_saStageCell(f)}</td>
            <td class="p-3 text-center">${f.level ?? '-'}</td>
            <td class="p-3"><div class="font-bold text-slate-800">${escapeHtml(saState.rules[f.rule_code]?.title || f.rule_code)}</div>
                <div class="text-xs text-gray-500">${SA_CATEGORY_LABEL[f.category] || f.category}</div></td>
            <td class="p-3 text-center">${f.hit_count}</td>
            <td class="p-3 text-center">${_saStatusBadge('ai', f.ai_verdict)}</td>
            <td class="p-3 text-center">${_saStatusBadge('qa', f.qa_status)}</td>
        </tr>`, 7);
}

function _saPaginate(rows, renderRow, colSpan) {
    const tbody = document.getElementById('sa-tbody');
    const pages = Math.max(1, Math.ceil(rows.length / SA_PAGE_SIZE));
    saState.page = Math.min(saState.page, pages);
    const slice = rows.slice((saState.page - 1) * SA_PAGE_SIZE, saState.page * SA_PAGE_SIZE);
    tbody.innerHTML = slice.length
        ? slice.map(renderRow).join('')
        : `<tr><td colspan="${colSpan}" class="p-12 text-center text-gray-400">조건에 맞는 항목이 없습니다.</td></tr>`;

    const pag = document.getElementById('sa-pagination');
    if (pages <= 1) { pag.innerHTML = `<span class="text-xs text-gray-500">${rows.length}건</span>`; return; }
    const btn = (p, label, disabled, active) =>
        `<button ${disabled ? 'disabled' : ''} onclick="goStageAuditPage(${p})" class="px-3 py-1.5 rounded-lg text-sm font-bold transition ${active ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'} ${disabled ? 'opacity-40 cursor-default' : ''}">${label}</button>`;
    const nums = [];
    const start = Math.max(1, saState.page - 3), end = Math.min(pages, start + 6);
    for (let p = start; p <= end; p++) nums.push(btn(p, p, false, p === saState.page));
    pag.innerHTML = btn(saState.page - 1, '<i class="fas fa-chevron-left"></i>', saState.page === 1, false) +
        nums.join('') + btn(saState.page + 1, '<i class="fas fa-chevron-right"></i>', saState.page === pages, false) +
        `<span class="text-xs text-gray-500 ml-3">${rows.length}건</span>`;
}

function goStageAuditPage(p) {
    saState.page = p;
    renderStageAudit(false);
    document.getElementById('stageaudit').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- 상세 모달
function openStageAuditDetail(id) {
    const f = saState.findings.find(x => x.id === id);
    if (!f) return;
    saState.detailId = id;
    const rule = saState.rules[f.rule_code] || {};

    document.getElementById('sa-d-badges').innerHTML =
        _saBadge(f.severity) +
        `<span class="sa-cat">${SA_CATEGORY_LABEL[f.category] || f.category}</span>` +
        `<span class="sa-cat font-mono">${escapeHtml(f.rule_code)}</span>` +
        (f.in_use === false ? `<span class="sa-cat">미사용</span>` : '');
    document.getElementById('sa-d-title').textContent = rule.title || f.rule_code;
    const stageBits = [
        _saStageLabel(f),
        f.prefab && `프리팹 ${f.prefab}`,
        f.stage_code && `코드 ${f.stage_code}`,
        f.level != null && `Level ${f.level}`,
        f.problem_count != null && `문제 수 ${f.problem_count}`,
    ].filter(Boolean);
    document.getElementById('sa-d-stage').textContent = stageBits.join(' · ');
    document.getElementById('sa-d-desc').textContent = rule.description || '-';
    document.getElementById('sa-d-guide').textContent = rule.check_guide || '-';

    // 같은 스테이지의 다른 항목
    const siblings = saState.findings.filter(x => x.stage_key === f.stage_key)
        .sort((a, b) => SA_SEV_RANK[b.severity] - SA_SEV_RANK[a.severity]);
    document.getElementById('sa-d-siblings').innerHTML = siblings.length > 1
        ? siblings.map(x => `<button onclick="openStageAuditDetail(${x.id})" class="sa-hit-chip sa-hit-${x.severity} ${x.id === id ? 'current' : ''}">${escapeHtml(saState.rules[x.rule_code]?.title || x.rule_code)}<span class="sa-hit-n">${x.hit_count}</span></button>`).join('')
        : '';

    document.getElementById('sa-d-ai').innerHTML = `${_saStatusBadge('ai', f.ai_verdict)}` +
        (f.ai_note ? `<p class="mt-2 leading-relaxed whitespace-pre-wrap">${escapeHtml(f.ai_note)}</p>`
                   : `<span class="text-xs text-gray-500 ml-2">${f.ai_verdict === '미판정' ? '아직 QAI가 코드를 읽고 판정하지 않았습니다.' : ''}</span>`);

    const locs = f.locations || [];
    document.getElementById('sa-d-loc-count').textContent = f.hit_count > locs.length ? `(${f.hit_count}곳 중 ${locs.length}곳 표시)` : `(${f.hit_count}곳)`;
    document.getElementById('sa-d-locations').innerHTML = locs.map(l => `
        <div class="sa-loc">
            <div class="sa-loc-head">
                <span class="font-mono">${escapeHtml(l.file.replace('Assets/Main/', ''))}:${l.line}</span>
                <button onclick="copyStageAuditPath(this)" data-path="${escapeHtml(l.file)}:${l.line}" class="sa-copy" title="경로 복사"><i class="far fa-copy"></i></button>
            </div>
            <pre class="sa-loc-code">${escapeHtml(l.code || '')}</pre>
        </div>`).join('');

    // QA 기록
    const by = document.getElementById('sa-d-qa-by');
    if (!by.options.length) {
        const authors = [...document.querySelectorAll('#write-author option')].filter(o => o.value);
        by.innerHTML = `<option value="">선택</option>` + authors.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</option>`).join('');
    }
    document.getElementById('sa-d-qa-status').value = f.qa_status;
    by.value = f.qa_by || localStorage.getItem('last_qa_author') || '';
    document.getElementById('sa-d-qa-note').value = f.qa_note || '';
    document.getElementById('sa-d-qa-meta').textContent = f.qa_updated_at ? `마지막 기록 ${formatKST(f.qa_updated_at)}${f.qa_by ? ' · ' + f.qa_by : ''}` : '';

    openModal('saDetailModal');
}

async function saveStageAuditQa() {
    const f = saState.findings.find(x => x.id === saState.detailId);
    if (!f) return;
    const payload = {
        qa_status: document.getElementById('sa-d-qa-status').value,
        qa_by: document.getElementById('sa-d-qa-by').value || null,
        qa_note: document.getElementById('sa-d-qa-note').value.trim() || null,
        qa_updated_at: new Date().toISOString(),
    };
    const btn = document.getElementById('sa-d-save');
    btn.disabled = true;
    const { error } = await supabaseClient.from('stage_audit_findings').update(payload).eq('id', f.id);
    btn.disabled = false;
    if (error) {
        console.error('[QAI 스테이지 검수] 저장 실패', error);
        showToast('저장하지 못했습니다.', 'error');
        return;
    }
    Object.assign(f, payload);
    if (payload.qa_by) localStorage.setItem('last_qa_author', payload.qa_by);
    showToast('QA 확인 기록을 저장했습니다.');
    closeModal('saDetailModal');
    renderStageAudit(false);
}

function copyStageAuditPath(btn) {
    const text = btn.dataset.path;
    navigator.clipboard.writeText(text).then(() => showToast('경로를 복사했습니다.'),
                                             () => showToast('복사하지 못했습니다.', 'error'));
}
