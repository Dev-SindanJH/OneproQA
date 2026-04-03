const SUPABASE_URL = 'https://lhahvxtirwofvptqdheq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4IUFaMgTOLEY4cC-oS3efQ_KVnvWldX'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 전역 변수
let globalLogs = []; 
let filteredLogs = []; 
let currentPage = 1;
const itemsPerPage = 10;

// Scene 이름 매핑 (영어 코드 → 한글)
const SCENE_NAME_MAP = {
    'TitleScene': '타이틀화면',
    'DailyStudyScene': '오늘의학습',
    'MainLobbyScene_v4': '메인 로비',
    'ChallengeScene': '일프로도전',
    'Study_1': '스테이지',
    'StageResultScene': '스테이지 결과 화면',
    'CreateProfileScene': '프로필 생성 화면',
    'MathGalaxyLobby': '매쓰갤럭시 로비',
    'MathGalaxyInGame': '매쓰갤럭시 인게임',
    'MathRun_Lobby': '매쓰랜드런 로비',
    'MathRun_Ingame': '매쓰랜드런 인게임',
    'MathLympics': '매쓰림픽',
    'DiaRankingScene': '다이아랭킹',
    'VideoCenterScene': '비디오센터',
    'LearningResultScene': '학습결과',
    'FreeStudyScene': '자유학습',
    'WorldStudyScene': '연산월드',
    'Speed_TitleScene': '냠냠냠 스피드연산 로비',
    'Speed_PlayScene': '냠냠냠 스피드연산 인게임',
    'Speed_RankingScene': '냠냠냠 스피드연산 랭킹',
    'AILevelTestScene_L1': 'AI 진단평가 L1',
    'AILevelTestScene_L2': 'AI 진단평가 L2',
    'AILevelTestScene_L3': 'AI 진단평가 L3',
    'AILevelTestScene_L3_2': 'AI 진단평가 L3-2',
    'FantasyAvatar_Lobby': '판타지 아바타 로비',
    'FantasyAvatar_Play': '판타지 아바타 꾸미기',
    'Card_SelectMode': '카드게임',
    'IdolAvatarScene': '아이돌 아바타',
    'RunGame_TitleScene': '깨비나라 연산런 로비',
    'Rungame_practice_1': '깨비나라 연산런 인게임',
    'InAppPurchaseScene': '인앱결제 상세페이지',
    'AvatarContestScene': '아바타 콘테스트',
    'VideoPlayScene': '비디오 실행'
};

// Popup 이름 매핑 (영어 코드 → 한글)
const POPUP_NAME_MAP = {
    'MyProfilePoP': '내 프로필 팝업',
    'LevelManager': '레벨 변경 팝업',
    'ReviewNoteManager': '오답 노트 팝업',
    'PasswordCheckPoP': '비밀번호 확인 팝업',
    'NoticePopup': '공지사항 팝업',
    'MissionManager': '미션 팝업',
    'SchoolLearningManager': '학교 학습',
    'VoucherPopManager': '이용권등록 팝업',
    'AttendanceCharacterEventPop': '7일 출석 캐릭터 이벤트 팝업',
    'NicknameChangePopup': '닉네임 변경 팝업',
    'LT_L4_HistoryManager': '레벨테스트 히스토리',
    'UpgradePop': '업그레이드 팝업',
    'ProfilePinPoPup': '프로필 비밀번호 팝업',
    'GameRankingManager': '게임 랭킹 팝업',
    'ChangePasswordPop': '비밀번호 변경 팝업',
    'MaintenancePopup': '점검 안내 팝업',
    'SettingManager': '설정 팝업',
    'DeleteAccountPop': '계정 탈퇴 팝업',
    'FriendsAvatarClosetManager': '프렌즈아바타 옷장',
    'LoginSignupUI': '로그인 회원가입 UI',
    'CommonBasePopup': '공통 기본 팝업',
    'PurchaseHistoryPopup': '구매 내역 팝업',
    'PersonalProfileManager': '개인 프로필 변경',
    'AllContentPoPManager': '전체 콘텐츠 팝업',
    'InquiryPop': '문의하기 팝업',
    'FriendsAvatarShopManager': '프렌즈 아바타 상점',
    'LiveContentDownloadUI': '라이브 콘텐츠 다운로드 UI',
    'CalendarManager': '출석 팝업',
    'VideoPlayerPopup': '비디오 팝업',
    'PhoneNumberChangePopup': '전화번호 변경 팝업',
    'ParentCheck_v3': '부모 인증 팝업',
    'DialogManager_v3': '다이아 내역 팝업',
    'LocalizationPopup': '로컬라이징 팝업',
    'StudyStartPoP': '학습 시작 팝업',
    'MessagePopup': '메시지 팝업',
    'PushAlarmTimePopup': '푸시 알림 시간 설정 팝업',
    'AppGuideManager_v3': '앱 가이드 팝업',
    'SelectCountryPop': '국가 선택 팝업',
    'ResourceManagerPop': '리소스 관리자 팝업',
    'SchoolProfileManager': '학교 프로필 변경 팝업'
};

// 코드를 한글 이름으로 변환하는 함수
function getDisplayName(code, isPopup = false) {
    if (!code) return '';
    const map = isPopup ? POPUP_NAME_MAP : SCENE_NAME_MAP;
    return map[code] || code; // 매핑이 없으면 원본 반환
}

/** UI 제어 관련 함수 **/
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('nav-' + sectionId).classList.add('active');
}

function openModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('hidden');

    if (id === 'writeModal') {
        const lastAuthor = localStorage.getItem('last_qa_author');
        if (lastAuthor) {
            document.getElementById('write-author').value = lastAuthor;
        }
    }
}

function closeModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add('hidden');

    if (id === 'writeModal') {
        document.getElementById('write-scene-input').value = '';
        document.getElementById('write-desc').value = '';
        document.getElementById('write-image').value = '';
        document.getElementById('similar-list').innerHTML = '<p class="text-xs text-slate-400 italic text-center py-10">내용을 입력하면 유사한 항목을 찾습니다.</p>';
    }

    if (id === 'editDevCommentModal') {
        document.getElementById('edit-dev-comment-text').value = '';
    }

    if (id === 'addEditImageModal') {
        const previewContainer = document.getElementById('aei-preview-container');
        const previewImg = document.getElementById('aei-preview-img');
        const fileInput = document.getElementById('aei-image-input');
        if (previewImg) previewImg.src = '';
        if (previewContainer) previewContainer.classList.add('hidden');
        if (fileInput) fileInput.value = '';
    }
}

function copyContentKey(key, type) {
    // 클립보드에 복사
    navigator.clipboard.writeText(key).then(() => {
        showToast(`${type} 키값이 복사되었습니다: ${key}`, 'success');
    }).catch(err => {
        console.error('복사 실패:', err);
        showToast('복사에 실패했습니다.', 'error');
    });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgClass = type === 'success' ? 'bg-slate-800/95' : 'bg-red-500/95';
    const icon = type === 'success' ? 'fa-check-circle text-green-400' : 'fa-exclamation-circle text-white';
    
    toast.className = `${bgClass} text-white px-8 py-4 rounded-2xl shadow-2xl backdrop-blur-md text-sm font-bold flex items-center gap-3 toast-animation-in w-max pointer-events-auto custom-toast-item`;
    toast.innerHTML = `<i class="fas ${icon} text-lg"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('toast-animation-in');
        toast.classList.add('toast-animation-out');
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
    }, 2500);
}

function formatKST(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(dateString) {
    if (!dateString) return '-';
    const now = new Date();
    const target = new Date(dateString);

    // 정확한 시간 차이 계산
    const diffMs = now - target;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    // 시간을 무시하고 날짜만 비교 (자정 기준)
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const diffDays = Math.round((nowDate - targetDate) / (1000 * 60 * 60 * 24));

    // 1분 미만
    if (diffMinutes < 1) return '방금 전';

    // 1시간 이내
    if (diffMinutes < 60) return `${diffMinutes}분 전`;

    // 오늘 (24시간 이내)
    if (diffDays === 0) return `${diffHours}시간 전`;

    // 어제
    if (diffDays === 1) return '어제';

    // N일 전
    return `${diffDays}일 전`;
}

// 툴팁 위치 동적 계산
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('mouseover', (e) => {
        const container = e.target.closest('.tooltip-container');
        if (!container) return;

        const tooltip = container.querySelector('.tooltip-text, .tooltip-text-left');
        if (!tooltip) return;

        const rect = container.getBoundingClientRect();
        const isLeftAligned = tooltip.classList.contains('tooltip-text-left');

        // position: fixed는 viewport 기준이므로 scroll offset 제외
        tooltip.style.top = `${rect.bottom}px`;

        if (isLeftAligned) {
            tooltip.style.left = 'auto';
            tooltip.style.right = `${window.innerWidth - rect.right}px`;
        } else {
            tooltip.style.left = `${rect.left}px`;
            tooltip.style.right = 'auto';
        }
    });
});

    // 상태 배지
    function getStateBadge(stateValue) {
        const s = (stateValue || '').trim();
        if(s === '수정 필요') return '<span class="whitespace-nowrap inline-block bg-orange-100 text-orange-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-orange-200">수정 필요</span>';
        if(s === '수정 완료') return '<span class="whitespace-nowrap inline-block bg-blue-100 text-blue-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-blue-200">수정 완료</span>';
        if(s === '수정 확인') return '<span class="whitespace-nowrap inline-block bg-green-100 text-green-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-green-200">수정 확인</span>';
        if(s === '보류') return '<span class="whitespace-nowrap inline-block bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md text-[11px] font-black border border-gray-300">보류</span>';
        if(s === '서버수정 요청중') return '<span class="whitespace-nowrap inline-block bg-purple-100 text-purple-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-purple-200">서버수정 요청중</span>';
        return `<span class="whitespace-nowrap inline-block bg-slate-50 text-slate-500 px-3 py-1.5 rounded-md text-[11px] font-bold border border-slate-200">${s || '신규 등록'}</span>`;
    }

/** 데이터 로드 및 처리 함수 **/
async function fetchQAInformation() {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabaseClient.from('qa_information').select('*').lte('start_at', today).gte('end_at', today).order('created_at', { ascending: false }).limit(1);

    const versionEl = document.getElementById('qaVersion');
    const roundEl = document.getElementById('qaRound');
    const periodEl = document.getElementById('qaPeriod');
    const serverEl = document.getElementById('qaServer');
    const appDownloadBtn = document.getElementById('appDownloadBtn');

    if (data && data.length > 0) {
        versionEl.innerText = `v${data[0].version}`; 
        roundEl.innerText = `${data[0].round}회차`;
        periodEl.innerText = `${formatKST(data[0].start_at)} ~ ${formatKST(data[0].end_at)}`;

        // 서버 정보 및 다운로드 링크 설정
        const serverInfo = data[0].serverInfo || 'dev';
        if (serverInfo === 'dev') {
            serverEl.innerText = '개발서버';
            serverEl.className = 'text-lg font-black text-orange-600';
            appDownloadBtn.href = 'https://play.google.com/apps/internaltest/4699691061985176904';
        } else if (serverInfo === 'prod') {
            serverEl.innerText = '운영서버';
            serverEl.className = 'text-lg font-black text-green-600';
            appDownloadBtn.href = 'https://play.google.com/store/apps/details?id=com.Mathmaster.OneProMath';
        } else {
            serverEl.innerText = serverInfo;
            serverEl.className = 'text-lg font-black text-slate-700';
            appDownloadBtn.href = '#';
        }
    } else {
        versionEl.innerText = "없음"; 
        roundEl.innerText = "-"; 
        periodEl.innerText = "-";
        serverEl.innerText = "-";
        serverEl.className = 'text-lg font-black text-slate-700';
        appDownloadBtn.href = '#';
    }
}

function updateDashboard(logs) {
    let counts = {'수정 필요':0, '수정 완료':0, '수정 확인':0, '보류':0, '서버수정 요청중':0};
    logs.forEach(log => { 
        const s = (log.state || log.status || '').trim(); 
        if(counts[s] !== undefined) counts[s]++; 
    });
    document.getElementById('cntRevision').innerText = counts['수정 필요']; 
    document.getElementById('cntFixed').innerText = counts['수정 완료'];
    document.getElementById('cntVerified').innerText = counts['수정 확인']; 
    document.getElementById('cntHold').innerText = counts['보류'];
    // 전역 변수에 카운트 저장
    window.statusCounts = counts;
}

function navigateToListWithFilter(state) {
    // 카운트 확인
    const count = window.statusCounts ? window.statusCounts[state] : 0;

    if (count === 0) {
        showToast('항목이 없습니다.', 'error');
        return;
    }

    // 검수 목록 페이지로 이동
    showSection('list');

    // 상태 필터 적용
    document.getElementById('stateFilter').value = state;
    const mobileStateFilter = document.getElementById('mobileStateFilter');
    if (mobileStateFilter) {
        mobileStateFilter.value = state;
    }

    // 필터 적용
    applyFilters();
}

async function fetchLogs() {
    const tbody = document.getElementById('logTableBody');
    const mobileContainer = document.getElementById('mobileCardContainer');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>데이터를 불러오는 중...</td></tr>';
    if (mobileContainer) mobileContainer.innerHTML = '<p class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>데이터를 불러오는 중...</p>';

    const { data, error } = await supabaseClient.from('qa_logs').select('*').order('created_at', { ascending: false }); 
    if (error) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-red-500">실패: ${error.message}</td></tr>`;
        if (mobileContainer) mobileContainer.innerHTML = `<p class="text-center py-8 text-red-500">실패: ${error.message}</p>`;
        return;
    }

    globalLogs = data.filter(log => log.is_delete !== true); 
    updateDashboard(globalLogs);
    updateAuthorDropdown(); 
    applyFilters();
    const checkAll = document.getElementById('checkAll');
    const mobileCheckAll = document.getElementById('mobileCheckAll');
    if (checkAll) checkAll.checked = false;
    if (mobileCheckAll) mobileCheckAll.checked = false;
}

function updateAuthorDropdown() {
    const authorFilter = document.getElementById('authorFilter');
    const mobileAuthorFilter = document.getElementById('mobileAuthorFilter');
    const authors = new Set();
    globalLogs.forEach(log => authors.add(log.user_name || '알 수 없음'));

    const currentSelection = authorFilter.value;
    let filterHtml = '<option value="all">전체 보기</option>';
    let mobileFilterHtml = '<option value="all">작성자: 전체</option>';
    authors.forEach(author => {
        filterHtml += `<option value="${author}">${author}</option>`;
        mobileFilterHtml += `<option value="${author}">작성자: ${author}</option>`;
    });
    authorFilter.innerHTML = filterHtml;
    authorFilter.value = currentSelection || 'all';

    if (mobileAuthorFilter) {
        mobileAuthorFilter.innerHTML = mobileFilterHtml;
        mobileAuthorFilter.value = currentSelection || 'all';
    }
}

function syncFilters(type) {
    const authorFilter = document.getElementById('authorFilter');
    const mobileAuthorFilter = document.getElementById('mobileAuthorFilter');
    const stateFilter = document.getElementById('stateFilter');
    const mobileStateFilter = document.getElementById('mobileStateFilter');

    if (type === 'author' && mobileAuthorFilter) {
        authorFilter.value = mobileAuthorFilter.value;
    } else if (type === 'state' && mobileStateFilter) {
        stateFilter.value = mobileStateFilter.value;
    }
    applyFilters();
}

function applyFilters() {
    const a = document.getElementById('authorFilter').value;
    const s = document.getElementById('stateFilter').value;
    
    filteredLogs = globalLogs.filter(log => {
        const authorName = log.user_name || '알 수 없음';
        const currentState = (log.state || log.status || '').trim();
        const matchAuthor = (a === 'all' || authorName === a);
        const matchState = (s === 'all' || currentState === s);
        return matchAuthor && matchState;
    });

    currentPage = 1; 
    renderTable(); 
}

function renderTable() {
    const tbody = document.getElementById('logTableBody');
    const mobileContainer = document.getElementById('mobileCardContainer');
    tbody.innerHTML = ''; 
    if (mobileContainer) mobileContainer.innerHTML = '';

    if (filteredLogs.length === 0) {
        renderPagination(0);
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400">내역이 없습니다.</td></tr>';
        if (mobileContainer) mobileContainer.innerHTML = '<p class="text-center py-8 text-gray-400">내역이 없습니다.</p>';
        return;
    }

    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedLogs = filteredLogs.slice(startIndex, startIndex + itemsPerPage);

    paginatedLogs.forEach(log => {
        const authorName = log.user_name || '알 수 없음';
        const currentState = (log.state || log.status || '').trim();
        const devComment = log.developer_comment || '<span class="text-gray-300 italic">코멘트 없음</span>';

        let imageActionHtml = log.image_url 
            ? `<button onclick="openImageViewerModal('${log.id}')" class="text-blue-700 hover:text-blue-900 text-[10px] font-black border border-blue-200 px-2.5 py-1 rounded-md bg-blue-50/50 shadow-sm transition"><i class="fas fa-image mr-1"></i>이미지 보기</button>`
            : `<button onclick="openAddEditImageModal('${log.id}', null)" class="text-slate-500 hover:text-slate-700 text-[10px] font-bold border border-dashed border-slate-300 px-2 py-1 rounded-md transition shadow-inner">+추가</button>`;

        let actionButtons = '';
        if (currentState === '수정 필요' || currentState === '서버수정 요청중') {
            actionButtons += `<button onclick="openDevProcessModal('${log.id}')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full mb-1">상태 변경</button>`;
        } else if (currentState === '수정 완료') {
            actionButtons += `<button onclick="directUpdateState('${log.id}', '수정 확인')" class="bg-green-100 text-green-700 hover:bg-green-200 border border-green-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full mb-1">수정 확인</button>`;
            actionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full">재수정요청</button>`;
        } else if (currentState === '보류' || currentState === '수정 확인') {
            actionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full">재수정요청</button>`;
        }

        // 콘텐츠 정보 생성 (current_scene, current_popup)
        let contentInfo = [];
        let contentTooltip = [];
        if (log.current_scene) {
            const koreanName = getDisplayName(log.current_scene, false);
            contentInfo.push(`<span class="content-badge scene-badge" onclick="copyContentKey('${log.current_scene}', 'Scene')">${koreanName}</span>`);
            contentTooltip.push(`Scene: ${log.current_scene}`);
        }
        if (log.current_popup) {
            const koreanName = getDisplayName(log.current_popup, true);
            contentInfo.push(`<span class="content-badge popup-badge" onclick="copyContentKey('${log.current_popup}', 'Popup')">[팝업] ${koreanName}</span>`);
            contentTooltip.push(`Popup: ${log.current_popup}`);
        }
        const contentText = contentInfo.length > 0 
            ? `<div class="tooltip-container">
                <div>${contentInfo.join('<br>')}</div>
                <span class="tooltip-text">${contentTooltip.join('<br>')}</span>
               </div>` 
            : '-';

        // 데스크탑 테이블 행
        const tr = document.createElement('tr');
        tr.className = 'log-row hover:bg-blue-50/20 transition';
        tr.innerHTML = `
            <td class="px-4 py-4 text-center border-b border-gray-100 row-check-cell">
                <input type="checkbox" class="row-check custom-checkbox" value="${log.id}">
            </td>
            <td class="px-4 py-4 text-center border-b border-gray-100">
                <div class="tooltip-container">
                    <div class="text-xs font-bold text-gray-700">${formatRelativeTime(log.created_at)}</div>
                    ${log.updated_at ? `<div class="text-[10px] text-blue-500 font-medium mt-0.5">${formatRelativeTime(log.updated_at)}</div>` : ''}
                    <span class="tooltip-text">
                        작성: ${formatKST(log.created_at)}<br>
                        ${log.updated_at ? `업데이트: ${formatKST(log.updated_at)}` : '업데이트 없음'}
                    </span>
                </div>
            </td>
            <td class="px-4 py-4 font-semibold text-gray-700 text-center border-b border-gray-100">${authorName}</td>
            <td class="px-4 py-4 text-center border-b border-gray-100">${getStateBadge(currentState)}</td>
            <td class="px-4 py-4 text-xs text-gray-600 text-center border-b border-gray-100">${contentText}</td>
            <td class="px-4 py-4 text-gray-600 border-b border-gray-100">
                <div class="flex items-start justify-between gap-2 max-w-[100%]">
                    <div class="tooltip-container flex-1 min-w-0">
                        <div class="line-clamp-3 w-full text-[13px] leading-relaxed">${log.user_description || '-'}</div>
                        <span class="tooltip-text">${log.user_description || '-'}</span>
                    </div>
                    <button onclick="openEditDescModal('${log.id}')" class="text-slate-400 hover:text-blue-500 transition shrink-0 p-1 mt-0.5" title="내용 수정"><i class="fas fa-pencil-alt text-xs"></i></button>
                </div>
            </td>
            <td class="px-4 py-4 text-center border-b border-gray-100">${imageActionHtml}</td>
            <td class="px-4 py-4 text-gray-600 border-b border-gray-100 ${currentState === '수정 완료' ? 'cursor-pointer hover:bg-blue-50/30' : ''}" ${currentState === '수정 완료' ? `onclick="openDevCommentEditModal('${log.id}')" title="클릭하여 코멘트 수정"` : ''}>
                <div class="tooltip-container">
                    <div class="line-clamp-3 w-full text-xs leading-relaxed">${log.developer_comment || '<span class="text-gray-300 italic">코멘트 없음</span>'}</div>
                    <span class="tooltip-text-left">${log.developer_comment || '코멘트 없음'}</span>
                </div>
            </td>
            <td class="px-4 py-4 border-b border-gray-100 relative">
                <div class="flex flex-col items-center gap-1 z-10">
                    ${actionButtons}
                    <button onclick="openDetailModal('${log.id}')" class="text-slate-500 hover:text-blue-600 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded w-full text-[10px] font-bold transition shadow-sm mt-1">
                        <i class="fas fa-search-plus mr-1"></i>상세
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);

        // 모바일 카드
        if (mobileContainer) {
            const card = document.createElement('div');
            card.className = 'mobile-card';

            let mobileActionButtons = '';
            if (currentState === '수정 필요' || currentState === '서버수정 요청중') {
                mobileActionButtons += `<button onclick="openDevProcessModal('${log.id}')" class="bg-indigo-100 text-indigo-700 border border-indigo-200">상태 변경</button>`;
            } else if (currentState === '수정 완료') {
                mobileActionButtons += `<button onclick="directUpdateState('${log.id}', '수정 확인')" class="bg-green-100 text-green-700 border border-green-200">수정 확인</button>`;
                mobileActionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 border border-orange-200">재수정요청</button>`;
            } else if (currentState === '보류' || currentState === '수정 확인') {
                mobileActionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 border border-orange-200">재수정요청</button>`;
            }

            let mobileImageBtn = log.image_url 
                ? `<button onclick="openImageViewerModal('${log.id}')" class="bg-blue-50 text-blue-700 border border-blue-200"><i class="fas fa-image mr-1"></i>이미지</button>`
                : `<button onclick="openAddEditImageModal('${log.id}', null)" class="bg-slate-50 text-slate-600 border border-slate-200">+이미지</button>`;

            card.innerHTML = `
                <div class="mobile-card-header">
                    <div class="mobile-card-header-left">
                        <input type="checkbox" class="row-check mobile-card-checkbox" value="${log.id}">
                        <span class="mobile-card-author">${authorName}</span>
                    </div>
                    ${getStateBadge(currentState)}
                </div>
                <div class="mobile-card-body">
                    ${contentInfo.length > 0 ? `<div class="text-xs text-indigo-600 font-bold mb-2"><i class="fas fa-map-marker-alt mr-1"></i>${contentInfo.join(' / ')}</div>` : ''}
                    <div class="mobile-card-desc">${log.user_description || '-'}</div>
                    <div class="mobile-card-meta">
                        <span class="mobile-card-meta-item" title="작성: ${formatKST(log.created_at)}"><i class="fas fa-calendar-alt"></i> ${formatRelativeTime(log.created_at)}</span>
                        ${log.updated_at ? `<span class="mobile-card-meta-item text-blue-500" title="업데이트: ${formatKST(log.updated_at)}"><i class="fas fa-sync-alt"></i> ${formatRelativeTime(log.updated_at)}</span>` : ''}
                    </div>
                    ${log.developer_comment ? `<div class="mobile-card-comment ${currentState === '수정 완료' ? 'cursor-pointer hover:bg-blue-50/30 active:bg-blue-100/30 transition' : ''}" ${currentState === '수정 완료' ? `onclick="openDevCommentEditModal('${log.id}')"` : ''}><div class="mobile-card-comment-label">${currentState === '수정 완료' ? '<i class="fas fa-edit mr-1 text-blue-500"></i>' : ''}개발자 코멘트</div>${log.developer_comment}</div>` : ''}
                    <div class="mobile-card-actions">
                        ${mobileActionButtons}
                        ${mobileImageBtn}
                        <button onclick="openDetailModal('${log.id}')" class="bg-slate-100 text-slate-600 border border-slate-200"><i class="fas fa-search-plus mr-1"></i>상세</button>
                        <button onclick="openEditDescModal('${log.id}')" class="bg-slate-100 text-slate-600 border border-slate-200"><i class="fas fa-pencil-alt mr-1"></i>수정</button>
                    </div>
                </div>
            `;
            mobileContainer.appendChild(card);
        }
    });
    renderPagination(filteredLogs.length);
}

function renderPagination(totalItems) {
    const paginationDiv = document.getElementById('pagination');
    paginationDiv.innerHTML = '';
    if (totalItems <= itemsPerPage) return; 

    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const prevDisabled = currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100';
    paginationDiv.innerHTML += `<button onclick="changePage(${currentPage - 1})" class="px-3 py-1 rounded border border-gray-200 text-slate-600 text-xs font-bold ${prevDisabled}" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;

    for (let i = 1; i <= totalPages; i++) {
        const activeClass = i === currentPage ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-gray-200 hover:bg-slate-50';
        paginationDiv.innerHTML += `<button onclick="changePage(${i})" class="px-3 py-1 rounded border text-xs font-bold transition ${activeClass}">${i}</button>`;
    }

    const nextDisabled = currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100';
    paginationDiv.innerHTML += `<button onclick="changePage(${currentPage + 1})" class="px-3 py-1 rounded border border-gray-200 text-slate-600 text-xs font-bold ${nextDisabled}" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
}

function changePage(p) {
    const total = Math.ceil(filteredLogs.length / itemsPerPage);
    if (p < 1 || p > total) return;
    currentPage = p; renderTable();
}

/** 모달 비즈니스 로직 **/
function openDetailModal(logId) {
    const log = globalLogs.find(l => l.id === logId); 
    if (!log) return;

    document.getElementById('modal-id').innerText = log.id; 
    document.getElementById('modal-author').innerText = log.user_name || '알 수 없음';
    document.getElementById('modal-date').innerText = formatKST(log.created_at); 
    document.getElementById('modal-status').innerHTML = getStateBadge(log.state || log.status);
    document.getElementById('modal-description').innerText = log.user_description || '내용 없음';

    // 캡처 이미지 표시
    const imageSection = document.getElementById('modal-image-section');
    const modalImage = document.getElementById('modal-image');
    if (log.image_url) {
        modalImage.src = log.image_url;
        modalImage.dataset.logId = log.id;
        imageSection.classList.remove('hidden');
    } else {
        imageSection.classList.add('hidden');
    }

    // 개발자 코멘트 표시
    const devCommentSection = document.getElementById('modal-dev-comment-section');
    const modalDevComment = document.getElementById('modal-dev-comment');
    if (log.developer_comment) {
        modalDevComment.innerText = log.developer_comment;
        devCommentSection.classList.remove('hidden');
    } else {
        devCommentSection.classList.add('hidden');
    }

    // 상태별 액션 버튼 생성
    const actionButtonsContainer = document.getElementById('modal-action-buttons');
    const currentState = (log.state || log.status || '').trim();
    let actionButtonsHtml = '';

    if (currentState === '수정 필요' || currentState === '서버수정 요청중') {
        actionButtonsHtml = `<button onclick="openDevProcessModal('${log.id}')" class="bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-indigo-700 transition text-sm shadow-md"><i class="fas fa-check-circle mr-1"></i>상태 변경</button>`;
    } else if (currentState === '수정 완료') {
        actionButtonsHtml = `
            <button onclick="directUpdateStateFromModal('${log.id}', '수정 확인')" class="bg-green-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-green-700 transition text-sm shadow-md"><i class="fas fa-check-double mr-1"></i>수정 확인</button>
            <button onclick="openReRequestModal('${log.id}')" class="bg-orange-500 text-white px-5 py-2 rounded-xl font-bold hover:bg-orange-600 transition text-sm shadow-md"><i class="fas fa-exclamation-triangle mr-1"></i>재수정요청</button>
        `;
    } else if (currentState === '보류' || currentState === '수정 확인') {
        actionButtonsHtml = `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-500 text-white px-5 py-2 rounded-xl font-bold hover:bg-orange-600 transition text-sm shadow-md"><i class="fas fa-exclamation-triangle mr-1"></i>재수정요청</button>`;
    }
    actionButtonsContainer.innerHTML = actionButtonsHtml;

    const timelineEl = document.getElementById('modal-timeline');
    timelineEl.innerHTML = '';

    let logs = [];
    try { logs = typeof log.inAppLogs === 'string' ? JSON.parse(log.inAppLogs) : (log.inAppLogs || []); } catch (e) { console.error(e); }

    if (logs.length === 0) {
        timelineEl.innerHTML = '<p class="text-gray-400 italic text-sm pl-8 py-4">기록된 인앱 로그가 없습니다.</p>';
    } else {
        logs.sort((a, b) => new Date(b.logTime) - new Date(a.logTime));
        logs.forEach((item, index) => {
            const timeStr = item.logTime ? new Date(item.logTime).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--';
            let config = { icon: 'fa-info-circle', color: 'text-slate-400', bgColor: 'bg-slate-400', label: 'INFO' };
            let headerContent = '';
            let detailContent = '';

            if (item.logType === 'API' || item.logType === 2) {
                config = { icon: 'fa-network-wired', color: 'text-emerald-500', bgColor: 'bg-emerald-500', label: 'API' };
                const raw = item.logContent;
                const methodMatch = raw.match(/^\[(GET|POST|PUT|DELETE|PATCH)\]/);
                const method = methodMatch ? methodMatch[1] : 'API';
                let url = raw.replace(`[${method}]`, '').trim().split('Request:')[0].split('Response')[0].trim();

                headerContent = `<div class="flex items-start"><span class="method-badge bg-emerald-100 text-emerald-700 mt-0.5">${method}</span><span class="text-[11px] font-bold text-slate-700 break-all leading-relaxed flex-1">${url}</span></div>`;

                const formatJson = (s) => { try { return JSON.stringify(JSON.parse(s.trim()), null, 2); } catch(e) { return s; } };
                let reqPart = raw.includes('Request:') ? `<div class="json-label"><i class="fas fa-arrow-right"></i> REQUEST</div><pre class="json-block">${formatJson(raw.split('Request:')[1].split('Response')[0])}</pre>` : '';
                let resMatch = raw.match(/Response\[(\d+)\]:\s*([\s\S]*)$/);
                let resPart = resMatch ? `<div class="json-label mt-2"><span><i class="fas fa-arrow-left"></i> RESPONSE</span><span class="${resMatch[1].startsWith('2')?'text-emerald-500':'text-red-500'} font-black">HTTP ${resMatch[1]}</span></div><pre class="json-block">${formatJson(resMatch[2])}</pre>` : '';
                detailContent = `<div class="mt-3 border-t border-slate-100 pt-3">${reqPart}${resPart}</div>`;
            } else {
                if (item.logType === 'Scene' || item.logType === 0) config = { icon: 'fa-film', color: 'text-blue-500', bgColor: 'bg-blue-500', label: 'SCENE' };
                else if (item.logType === 'Popup' || item.logType === 1) config = { icon: 'fa-clone', color: 'text-purple-500', bgColor: 'bg-purple-500', label: 'POPUP' };
                else if (item.logType === 'Exception' || item.logType === 3) config = { icon: 'fa-exclamation-triangle', color: 'text-red-500', bgColor: 'bg-red-500', label: 'ERROR' };
                headerContent = `<span class="text-[12px] text-slate-700 font-medium truncate flex-1">${item.logContent}</span>`;
                detailContent = `<div class="mt-2 text-[12px] text-slate-600 bg-slate-50 p-3 rounded border border-dashed whitespace-pre-wrap">${item.logContent}</div>`;
            }

            const logRow = document.createElement('div');
            logRow.className = 'relative pl-8 pb-4 group';
            logRow.innerHTML = `
                <div class="absolute left-0 top-1 w-6 h-6 rounded-full ${config.bgColor} flex items-center justify-center z-10 border-2 border-white"><i class="fas ${config.icon} text-[10px] text-white"></i></div>
                <div class="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden transition-all">
                    <div class="p-3 flex justify-between items-center cursor-pointer hover:bg-slate-50" onclick="toggleLogDetail('${index}')">
                        <div class="flex flex-col flex-1 min-w-0"><span class="text-[9px] font-black ${config.color} uppercase mb-0.5">${config.label}</span><div class="flex items-center">${headerContent}</div></div>
                        <div class="flex items-center gap-3 ml-2"><span class="text-[10px] font-mono text-slate-400">${timeStr}</span><i class="fas fa-chevron-down text-[10px] text-slate-300 transition-transform duration-300" id="icon-${index}"></i></div>
                    </div>
                    <div id="extra-${index}" class="hidden px-3 pb-3 bg-white">${detailContent}</div>
                </div>`;
            timelineEl.appendChild(logRow);
        });
    }
    openModal('detailModal');
}

function openImageViewerFromModal() {
    const modalImage = document.getElementById('modal-image');
    const logId = modalImage.dataset.logId;
    if (logId) {
        closeModal('detailModal');
        openImageViewerModal(logId);
    }
}

async function directUpdateStateFromModal(id, s) {
    const { error } = await supabaseClient.from('qa_logs').update({ state: s }).eq('id', id);
    if (error) {
        alert('실패: ' + error.message);
    } else {
        showToast(`[${s}] 상태로 변경되었습니다.`);
        closeModal('detailModal');
        fetchLogs();
    }
}

function toggleLogDetail(index) {
    const extra = document.getElementById(`extra-${index}`);
    const icon = document.getElementById(`icon-${index}`);
    const isHidden = extra.classList.contains('hidden');
    extra.classList.toggle('hidden');
    icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

function openEditDescModal(logId) {
    const log = globalLogs.find(l => l.id === logId); if (!log) return;
    document.getElementById('edit-desc-log-id').value = logId;
    document.getElementById('edit-desc-text').value = log.user_description || '';
    openModal('editDescModal');
}

async function submitEditDesc() {
    const id = document.getElementById('edit-desc-log-id').value; const desc = document.getElementById('edit-desc-text').value.trim();
    if (!desc) return alert('내용을 입력해주세요.');
    const btn = document.getElementById('edit-desc-submit-btn'); btn.innerText = '저장중...'; btn.disabled = true;
    const { error } = await supabaseClient.from('qa_logs').update({ user_description: desc }).eq('id', id);
    btn.innerText = '수정 완료'; btn.disabled = false;
    if (error) alert('실패: ' + error.message); else { showToast('수정되었습니다.'); closeModal('editDescModal'); fetchLogs(); }
}

async function directUpdateState(id, s) {
    const { error } = await supabaseClient.from('qa_logs').update({ state: s }).eq('id', id);
    if (error) alert('실패: ' + error.message); else { showToast(`[${s}] 상태로 변경되었습니다.`); fetchLogs(); }
}

function openReRequestModal(logId) {
    const log = globalLogs.find(l => l.id === logId);
    document.getElementById('request-log-id').value = logId; document.getElementById('request-text').value = ''; 
    document.getElementById('request-existing-desc').innerText = log.user_description || '-'; document.getElementById('request-existing-comment').innerText = log.developer_comment || '-';
    openModal('requestModal');
}

async function submitReRequest() {
    const id = document.getElementById('request-log-id').value; const t = document.getElementById('request-text').value.trim();
    if (!t) return alert('내용을 입력해주세요.');
    const log = globalLogs.find(l => l.id === id);
    const { error } = await supabaseClient.from('qa_logs').update({ state: '수정 필요', user_description: `${log.user_description || ''}\n\n[재수정 요청] ${t}` }).eq('id', id);
    if (error) alert('실패: ' + error.message); else { showToast('재수정 요청이 완료되었습니다.'); closeModal('requestModal'); fetchLogs(); }
}

function toggleAllChecks(source) { document.querySelectorAll('.row-check').forEach(cb => cb.checked = source.checked); }

function confirmDeleteSelected() {
    const checked = document.querySelectorAll('.row-check:checked');
    if (checked.length === 0) return alert('선택해주세요.');
    document.getElementById('delete-count').innerText = checked.length; openModal('deleteModal');
}

async function executeDelete() {
    const checked = document.querySelectorAll('.row-check:checked');
    const ids = Array.from(checked).map(cb => cb.value);
    const { error } = await supabaseClient.from('qa_logs').update({ is_delete: true }).in('id', ids);
    if (error) alert('실패: ' + error.message); else { showToast('삭제되었습니다.'); closeModal('deleteModal'); fetchLogs(); }
}

/** 이미지 처리 관련 함수 **/
function resizeImage(file, maxSize) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxSize || h > maxSize) {
                    if (w > h) { h = Math.round((h * maxSize) / w); w = maxSize; } 
                    else { w = Math.round((w * maxSize) / h); h = maxSize; }
                }
                const cvs = document.createElement('canvas'); 
                cvs.width = w; cvs.height = h;
                cvs.getContext('2d').drawImage(img, 0, 0, w, h);
                cvs.toBlob((blob) => resolve(blob), 'image/webp', 0.8);
            };
            img.onerror = reject; img.src = e.target.result;
        };
        r.onerror = reject; r.readAsDataURL(file);
    });
}

function previewSelectedImage(input) {
    const container = document.getElementById('aei-preview-container');
    const previewImg = document.getElementById('aei-preview-img');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => { previewImg.src = e.target.result; container.classList.remove('hidden'); }
        reader.readAsDataURL(input.files[0]);
    } else { container.classList.add('hidden'); }
}

async function uploadImageProcess(file) {
    const resizedBlob = await resizeImage(file, 1000);
    const fileName = `qa_${Date.now()}_${Math.random().toString(36).substring(7)}.webp`;
    const { error: ulError } = await supabaseClient.storage.from('capture').upload(fileName, resizedBlob, { contentType: 'image/webp' });
    if (ulError) throw ulError;
    const { data } = supabaseClient.storage.from('capture').getPublicUrl(fileName);
    return data.publicUrl;
}

async function submitNewLog() {
    const author = document.getElementById('write-author').value;
    const contentInput = document.getElementById('write-scene-input').value;
    const desc = document.getElementById('write-desc').value.trim();
    const imgInput = document.getElementById('write-image'); 

    // 괄호 안의 코드명 추출
    const codeMatch = contentInput.match(/\(([^)]+)\)/);
    const codeName = codeMatch ? codeMatch[1] : null;

    // [Popup] 표시가 있는지 확인
    const isPopup = contentInput.includes('[Popup]');

    if (!author || !codeName || !desc) { 
        showToast('작성자, 올바른 위치 선택, 내용을 확인해주세요.', 'error'); 
        return; 
    }
    localStorage.setItem('last_qa_author', author);

    const btn = document.getElementById('write-submit-btn'); 
    btn.innerText = '업로드중...'; btn.disabled = true;

    try {
        let imageUrl = null;
        if (imgInput && imgInput.files && imgInput.files[0]) imageUrl = await uploadImageProcess(imgInput.files[0]);

        // Scene과 Popup 구분하여 저장
        const logData = { 
            user_name: author, 
            user_description: desc, 
            state: '수정 필요', 
            is_delete: false,
            image_url: imageUrl
        };

        if (isPopup) {
            logData.current_popup = codeName;
        } else {
            logData.current_scene = codeName;
        }

        const { error } = await supabaseClient.from('qa_logs').insert([logData]);

        if (error) throw error;
        showToast('검수 내용이 등록되었습니다.');
        closeModal('writeModal'); fetchLogs();
    } catch (e) { showToast('실패: ' + e.message, 'error'); } finally { btn.innerText = '등록하기'; btn.disabled = false; }
}

function checkSimilarIssues(text) {
    const listContainer = document.getElementById('similar-list');
    if (!text || text.trim().length < 5) {
        listContainer.innerHTML = '<p class="text-xs text-slate-400 italic text-center py-10">내용을 좀 더 입력해 주세요.</p>';
        return;
    }
    const keywords = text.split(/\s+/).filter(word => word.length >= 2);
    const matches = globalLogs.filter(log => keywords.some(key => (log.user_description || '').includes(key))).slice(0, 5);

    if (matches.length === 0) {
        listContainer.innerHTML = '<p class="text-xs text-green-500 font-bold text-center py-10"><i class="fas fa-check-circle mr-1"></i> 유사한 검수가 없습니다.</p>';
        return;
    }
    listContainer.innerHTML = matches.map(log => `
        <div class="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:border-indigo-300 transition cursor-help" onclick="openDetailModal('${log.id}')">
            <div class="flex justify-between items-start mb-1"><span class="text-[10px] font-bold text-slate-400">ID: ${log.id.substring(0,8)}</span>${getStateBadge(log.state)}</div>
            <p class="text-xs text-slate-700 line-clamp-2 leading-relaxed font-medium">${log.user_description}</p>
            <div class="mt-2 text-[10px] text-slate-400 flex justify-between"><span>작성자: ${log.user_name}</span><span>${new Date(log.created_at).toLocaleDateString()}</span></div>
        </div>`).join('');
}

function openImageViewerModal(logId) {
    const log = globalLogs.find(l => l.id === logId); if (!log || !log.image_url) return;
    document.getElementById('viewer-img').src = log.image_url;
    document.getElementById('viewer-edit-btn').onclick = () => { closeModal('imageViewerModal'); openAddEditImageModal(logId, log.image_url); };
    openModal('imageViewerModal');
}

function openAddEditImageModal(logId, oldImageUrl) {
    document.getElementById('aei-log-id').value = logId;
    document.getElementById('aei-old-url').value = oldImageUrl || ''; 
    document.getElementById('aei-image-input').value = ''; 
    const container = document.getElementById('aei-preview-container');
    const previewImg = document.getElementById('aei-preview-img');
    if (oldImageUrl) { previewImg.src = oldImageUrl; container.classList.remove('hidden'); } else { container.classList.add('hidden'); }
    document.getElementById('aei-title').innerText = oldImageUrl ? '이미지 교체' : '이미지 추가';
    document.getElementById('aei-save-btn').innerText = oldImageUrl ? '이미지 교체' : '이미지 저장';
    openModal('addEditImageModal');
}

async function submitUpdateImage() {
    const logId = document.getElementById('aei-log-id').value;
    const oldUrl = document.getElementById('aei-old-url').value;
    const imgInput = document.getElementById('aei-image-input');
    if (!imgInput.files || !imgInput.files[0]) return alert('이미지 파일을 선택해주세요.');
    const btn = document.getElementById('aei-save-btn'); btn.innerText = '저장 중...'; btn.disabled = true;

    try {
        const newImageUrl = await uploadImageProcess(imgInput.files[0]);
        const { error: dbError } = await supabaseClient.from('qa_logs').update({ image_url: newImageUrl, updated_at: new Date().toISOString() }).eq('id', logId);
        if (dbError) throw dbError;
        if (oldUrl) {
            const oldPath = oldUrl.split('/').pop();
            if (oldPath) await supabaseClient.storage.from('capture').remove([oldPath]);
        }
        showToast('이미지가 처리되었습니다.'); closeModal('addEditImageModal'); fetchLogs();
    } catch (e) { alert('작업 실패: ' + e.message); } finally { btn.innerText = '이미지 저장'; btn.disabled = false; }
}

function openDevProcessModal(logId) {
    const log = globalLogs.find(l => l.id === logId); if (!log) return;
    document.getElementById('dev-process-log-id').value = logId;
    document.getElementById('dev-comment-text').value = log.developer_comment || '';
    openModal('devProcessModal');
}

async function submitDevProcess(targetState) {
    const id = document.getElementById('dev-process-log-id').value;
    const comment = document.getElementById('dev-comment-text').value.trim();

    // 코멘트가 비어있으면 상태값을 기본 코멘트로 사용
    const finalComment = comment || targetState;

    const { error } = await supabaseClient.from('qa_logs').update({ state: targetState, developer_comment: finalComment, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) alert('실패: ' + error.message); else { showToast(`[${targetState}] 처리가 완료되었습니다.`); closeModal('devProcessModal'); fetchLogs(); }
}

function openDevCommentEditModal(logId) {
    const log = globalLogs.find(l => l.id === logId); 
    if (!log) return;
    document.getElementById('edit-dev-comment-log-id').value = logId;
    document.getElementById('edit-dev-comment-text').value = log.developer_comment || '';
    openModal('editDevCommentModal');
}

async function submitDevCommentEdit() {
    const id = document.getElementById('edit-dev-comment-log-id').value;
    const comment = document.getElementById('edit-dev-comment-text').value.trim();
    if (!comment) return alert('코멘트를 입력해주세요.');

    const btn = document.getElementById('edit-dev-comment-submit-btn');
    btn.innerText = '저장중...';
    btn.disabled = true;

    const { error } = await supabaseClient.from('qa_logs').update({ 
        developer_comment: comment,
        updated_at: new Date().toISOString()
    }).eq('id', id);

    btn.innerText = '수정 완료';
    btn.disabled = false;

    if (error) {
        alert('실패: ' + error.message);
    } else {
        showToast('개발자 코멘트가 수정되었습니다.');
        closeModal('editDevCommentModal');
        fetchLogs();
    }
}

// 초기 실행
window.onload = () => { showSection('home'); fetchQAInformation(); fetchLogs(); };