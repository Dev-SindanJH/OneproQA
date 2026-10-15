// =====================================================================
// 검수 목록 줄다리기 — 토끼(왼쪽) vs 거북이(오른쪽)
// - 토끼(재검수 쪽): '수정 필요' + '수정 완료' / 거북이(업데이트 배포 쪽): '수정 확인'
// - 버전 필터와 무관하게 현재 검수 버전의 작성 기간에 들어오는 항목만 센다
// - 위치 p = (거북이 - 토끼) / (거북이 + 토끼), -1(재검수 골인) ~ 1(배포 골인)
// - script.js 의 updateStateChipCounts() / updateQAInformationUI() 가 window.updateTugOfWar() 를 호출
// - script.js 의 globalLogs, qaVersionRanges, currentAppVersion 사용
// =====================================================================

(function () {
    const HIDE_KEY = 'oneproqa-tug-hidden';

    // 눌렀을 때 하는 말
    const RABBIT_LINES = ['깡총! 🥕', '나 잡아봐라~', '당근 하나만… 🥕', '힘들 땐 쉬어가요', '깡총깡총!', '귀 쫑긋 👂'];
    const TURTLE_LINES = ['천천히, 꾸준히 🐢', '배포까지 영차!', '느려도 간다~', '등껍질 단단 💪', '오늘도 수고했어요', '거의 다 왔어요!'];
    const ROPE_LINES = ['영차! 영차!', '으랏차차!', '줄 꽉 잡아!'];
    const SPARKLES = ['💕', '✨', '⭐', '🌸', '💚'];

    const RABBIT_SVG = `
<svg class="tug-char tug-rabbit" viewBox="0 0 80 100" aria-hidden="true">
  <g stroke="#94a3b8" stroke-width="1.6">
    <ellipse cx="42" cy="13" rx="5.5" ry="15" fill="#fff" transform="rotate(-14 42 13)"/>
    <ellipse cx="54" cy="12" rx="5.5" ry="15" fill="#fff" transform="rotate(12 54 12)"/>
  </g>
  <ellipse cx="42" cy="14" rx="2.4" ry="10" fill="#fda4af" transform="rotate(-14 42 14)"/>
  <ellipse cx="54" cy="13" rx="2.4" ry="10" fill="#fda4af" transform="rotate(12 54 13)"/>
  <circle cx="17" cy="72" r="7" fill="#fff" stroke="#94a3b8" stroke-width="1.6"/>
  <ellipse cx="36" cy="68" rx="20" ry="23" fill="#fff" stroke="#94a3b8" stroke-width="1.6"/>
  <ellipse cx="38" cy="72" rx="11" ry="14" fill="#f1f5f9"/>
  <ellipse cx="28" cy="93" rx="10" ry="5" fill="#fff" stroke="#94a3b8" stroke-width="1.6"/>
  <ellipse cx="48" cy="94" rx="10" ry="5" fill="#fff" stroke="#94a3b8" stroke-width="1.6"/>
  <circle cx="50" cy="38" r="16" fill="#fff" stroke="#94a3b8" stroke-width="1.6"/>
  <circle cx="56" cy="35" r="2.6" fill="#1e293b"/>
  <circle cx="57" cy="34" r=".9" fill="#fff"/>
  <circle cx="58" cy="44" r="3.6" fill="#fda4af" opacity=".6"/>
  <ellipse cx="65" cy="40" rx="2.2" ry="1.7" fill="#fb7185"/>
  <path d="M60 46 q3 2.5 6 0" fill="none" stroke="#64748b" stroke-width="1.3" stroke-linecap="round"/>
  <path d="M47 58 L78 56" stroke="#94a3b8" stroke-width="8.6" stroke-linecap="round"/>
  <path d="M47 58 L78 56" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
</svg>`;

    const TURTLE_SVG = `
<svg class="tug-char tug-turtle" viewBox="0 0 100 100" aria-hidden="true">
  <path d="M86 78 l12 4 l-12 4 z" fill="#86efac" stroke="#16a34a" stroke-width="1.6" stroke-linejoin="round"/>
  <ellipse cx="44" cy="91" rx="9" ry="6" fill="#86efac" stroke="#16a34a" stroke-width="1.6"/>
  <ellipse cx="76" cy="91" rx="9" ry="6" fill="#86efac" stroke="#16a34a" stroke-width="1.6"/>
  <path d="M30 84 Q30 46 60 44 Q90 46 90 84 Z" fill="#22c55e" stroke="#15803d" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M45 82 L49 64 L60 57 L71 64 L75 82 M49 64 L38 66 M71 64 L82 66 M60 57 L60 46" fill="none" stroke="#15803d" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="27" y="80" width="66" height="7" rx="3.5" fill="#fde68a" stroke="#ca8a04" stroke-width="1.4"/>
  <path d="M34 66 Q28 56 24 54" stroke="#16a34a" stroke-width="12" stroke-linecap="round" fill="none"/>
  <path d="M34 66 Q28 56 24 54" stroke="#86efac" stroke-width="9" stroke-linecap="round" fill="none"/>
  <circle cx="20" cy="46" r="13" fill="#86efac" stroke="#16a34a" stroke-width="1.6"/>
  <circle cx="15" cy="43" r="2.6" fill="#1e293b"/>
  <circle cx="14" cy="42" r=".9" fill="#fff"/>
  <circle cx="13" cy="51" r="3" fill="#fda4af" opacity=".55"/>
  <path d="M10 50 q3 2.5 6 .5" fill="none" stroke="#166534" stroke-width="1.3" stroke-linecap="round"/>
  <path d="M38 64 L4 56" stroke="#16a34a" stroke-width="8.6" stroke-linecap="round"/>
  <path d="M38 64 L4 56" stroke="#86efac" stroke-width="6" stroke-linecap="round"/>
</svg>`;

    const flagSvg = (color) => `
<svg viewBox="0 0 40 72" aria-hidden="true">
  <rect x="18.5" y="4" width="3" height="66" rx="1.5" fill="#94a3b8"/>
  <path d="M21.5 6 L42 14 L21.5 23 Z" fill="${color}"/>
  <circle cx="20" cy="4" r="3.5" fill="#facc15"/>
</svg>`;

    // 상황별 한 줄 응원
    function messageFor(p, rabbit, turtle) {
        if (rabbit === 0 && turtle === 0) return '조용한 대치 중… 차 한 잔 하세요 🍵';
        if (p >= 1) return '🎉 업데이트 배포 골인! 오늘도 고생 많았어요';
        if (p <= -1) return '🐰 재검수 골인… 괜찮아요, 거북이는 원래 늦게 와요 ☕';
        if (p > 0.6) return '거북이가 배포 쪽으로 쭉쭉! 거의 다 왔어요 🐢💨';
        if (p > 0.2) return '거북이가 한 발씩 끌고 가는 중 🐢';
        if (p >= -0.2) return '팽팽한 접전! 둘 다 힘내는 중 💪';
        if (p >= -0.6) return '토끼가 힘을 내고 있어요… 수정 확인으로 거북이를 도와주세요';
        return '앗, 재검수 쪽으로 끌려가는 중! 😵 한 건씩 천천히 가요';
    }

    function isHidden() {
        try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { return false; }
    }
    function setHidden(v) {
        try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch (e) { /* 저장 불가 환경 무시 */ }
    }

    function render() {
        const card = document.getElementById('tugOfWar');
        if (!card) return null;
        card.innerHTML = `
            <div class="tug-head">
                <span class="tug-title">🐰 vs 🐢 줄다리기</span>
                <span class="tug-msg" id="tugMsg"></span>
                <button type="button" class="tug-hide" id="tugHideBtn"></button>
            </div>
            <div class="tug-field" id="tugField">
                <div class="tug-ground"></div>
                <div class="tug-centerline"></div>
                <div class="tug-goal tug-goal-left" id="tugGoalLeft"><span class="tug-goal-label">재검수</span>${flagSvg('#f43f5e')}</div>
                <div class="tug-goal tug-goal-right" id="tugGoalRight"><span class="tug-goal-label">업데이트 배포</span>${flagSvg('#10b981')}</div>
                <div class="tug-team" id="tugTeam">
                    <div class="tug-rope" data-tug="rope"><div class="tug-ribbon"></div></div>
                    <div class="tug-actor" data-tug="rabbit">${RABBIT_SVG}</div>
                    <div class="tug-actor" data-tug="turtle">${TURTLE_SVG}</div>
                </div>
            </div>
            <div class="tug-score">
                <span class="tug-score-left">수정 필요·완료 <b id="tugRabbit">0</b></span>
                <span class="tug-score-mid" id="tugScope"></span>
                <span class="tug-score-right"><b id="tugTurtle">0</b> 수정 확인</span>
            </div>`;

        const applyHidden = (hidden) => {
            card.classList.toggle('collapsed', hidden);
            document.getElementById('tugHideBtn').textContent = hidden ? '보기' : '숨기기';
        };
        document.getElementById('tugHideBtn').addEventListener('click', () => {
            const next = !card.classList.contains('collapsed');
            setHidden(next);
            applyHidden(next);
        });
        applyHidden(isHidden());

        document.getElementById('tugField').addEventListener('click', onFieldTap);
        return card;
    }

    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // 애니메이션 클래스를 다시 걸어 연속 터치에도 매번 재생
    function replay(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
    }

    // 캐릭터 머리 위 말풍선
    function say(actor, text) {
        actor.querySelector('.tug-bubble')?.remove();
        const bubble = document.createElement('span');
        bubble.className = 'tug-bubble';
        bubble.textContent = text;
        actor.appendChild(bubble);
        bubble.addEventListener('animationend', () => bubble.remove());
    }

    // 누른 자리에서 하트·반짝이가 퐁퐁
    function sparkle(field, x, y) {
        for (let i = 0; i < 3; i++) {
            const s = document.createElement('span');
            s.className = 'tug-sparkle';
            s.textContent = pick(SPARKLES);
            s.style.left = `${x}px`;
            s.style.top = `${y}px`;
            s.style.setProperty('--dx', `${(i - 1) * 18 + (Math.random() * 10 - 5)}px`);
            s.style.animationDelay = `${i * 60}ms`;
            field.appendChild(s);
            s.addEventListener('animationend', () => s.remove());
        }
    }

    function onFieldTap(e) {
        const target = e.target.closest('[data-tug]');
        if (!target) return;
        const field = e.currentTarget;
        const rect = field.getBoundingClientRect();
        sparkle(field, e.clientX - rect.left, e.clientY - rect.top);

        const kind = target.dataset.tug;
        if (kind === 'rabbit') {
            replay(target, 'hop');
            say(target, pick(RABBIT_LINES));
        } else if (kind === 'turtle') {
            replay(target, 'wiggle');
            say(target, pick(TURTLE_LINES));
        } else {
            // 줄을 누르면 둘 다 힘껏 당김
            const team = document.getElementById('tugTeam');
            replay(team, 'heave');
            team.querySelectorAll('.tug-actor').forEach(a => replay(a, 'hop'));
            say(team.querySelector('[data-tug="turtle"]'), pick(ROPE_LINES));
        }
    }

    // 현재 검수 버전의 작성 기간(script.js 의 qaVersionRanges)에 들어오는 요약 데이터
    function logsInCurrentVersion() {
        const version = typeof currentAppVersion !== 'undefined' ? currentAppVersion : '';
        const ranges = typeof qaVersionRanges !== 'undefined' ? qaVersionRanges : [];
        const range = ranges.find(r => r.version === version);
        if (!range || typeof globalLogs === 'undefined') return null;

        const from = range.from ? Date.parse(range.from) : -Infinity;
        const to = range.to ? Date.parse(range.to) : Infinity;
        return {
            version,
            logs: globalLogs.filter(log => {
                const t = Date.parse(log.created_at);
                return t >= from && t < to;
            })
        };
    }

    let lastP = null;

    window.updateTugOfWar = function () {
        const card = document.getElementById('tugOfWar');
        if (!card) return;
        if (!card.firstElementChild) render();

        // 검수 버전·기간을 아직 모르면 이전 상태 유지
        const current = logsInCurrentVersion();
        if (!current) return;

        let rabbit = 0, turtle = 0;
        current.logs.forEach(log => {
            const s = (log.state || log.status || '').trim();
            if (s === '수정 필요' || s === '수정 완료') rabbit++;
            else if (s === '수정 확인') turtle++;
        });

        const total = rabbit + turtle;
        const p = total ? (turtle - rabbit) / total : 0;

        card.style.setProperty('--p', p.toFixed(3));
        // 이기는 쪽은 더 여유롭게, 지는 쪽은 더 뒤로 젖히며 버틴다
        card.style.setProperty('--rabbit-lean', `${(8 + Math.max(0, -p) * 10).toFixed(1)}deg`);
        card.style.setProperty('--turtle-lean', `${(8 + Math.max(0, p) * 10).toFixed(1)}deg`);
        card.style.setProperty('--rabbit-speed', `${(1 - Math.max(0, -p) * 0.5).toFixed(2)}s`);
        card.style.setProperty('--turtle-speed', `${(1 - Math.max(0, p) * 0.5).toFixed(2)}s`);

        document.getElementById('tugRabbit').textContent = rabbit;
        document.getElementById('tugTurtle').textContent = turtle;
        document.getElementById('tugMsg').textContent = messageFor(p, rabbit, turtle);
        document.getElementById('tugScope').textContent = `v${current.version} 기준`;

        document.getElementById('tugGoalLeft').classList.toggle('reached', total > 0 && p <= -1);
        document.getElementById('tugGoalRight').classList.toggle('reached', total > 0 && p >= 1);

        // 위치가 바뀌면 살짝 들썩
        if (lastP !== null && Math.abs(lastP - p) > 0.001) replay(document.getElementById('tugTeam'), 'jolt');
        lastP = p;
    };

    document.addEventListener('DOMContentLoaded', () => {
        if (render()) window.updateTugOfWar();
    });
})();
