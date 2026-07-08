const SUPABASE_URL = 'https://lhahvxtirwofvptqdheq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4IUFaMgTOLEY4cC-oS3efQ_KVnvWldX'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 캐시 매니저 참조 (cache-manager.js에서 window.cacheManager로 노출됨)
const cacheManager = window.cacheManager;
const cacheManagerReady = window.cacheManagerReady;

// 전역 변수
let globalLogs = []; // 대시보드/드롭다운용 요약 데이터만 저장
let currentPageLogs = []; // 현재 페이지의 데이터
let totalLogsCount = 0; // 전체(필터링된) 로그 개수
let currentPage = 1;
const itemsPerPage = 10;
let currentBundleCode = ''; // 현재 검수 번들 코드
let currentAppVersion = ''; // 현재 앱 버전
let currentServerInfo = 'dev'; // 현재 서버 환경: 'dev' | 'prod'
let dateSortOrder = 'desc'; // 날짜 정렬 순서: 'asc' (오름차순), 'desc' (내림차순), 'none' (정렬 없음)

// 현재 필터 상태 저장
let currentFilters = {
    author: 'all',
    content: 'all',
    state: 'all',
    search: ''
};

// Choices.js 인스턴스 저장
let contentFilterChoices = null;
let mobileContentFilterChoices = null;

// 캐시 관련 헬퍼 함수
async function invalidateLogsCache() {
    console.log('🗑️ QA Logs 캐시 무효화');
    // 페이지별 캐시 삭제를 위해 패턴 매칭 필요 (간단히 전체 삭제)
    await cacheManager.delete('qa_logs', 'default');
    // 페이지별 캐시도 삭제 (실제로는 모든 페이지 키를 삭제해야 하지만, 간단히 처리)
    for (let i = 1; i <= 100; i++) {
        await cacheManager.delete('qa_logs_page', i.toString());
    }
    await cacheManager.delete('qa_logs_count', 'default');
}

async function invalidateQAInfoCache() {
    console.log('🗑️ QA Information 캐시 무효화');
    const today = new Date().toISOString().split('T')[0];
    await cacheManager.delete('qa_information', today);
}

async function refreshAllData() {
    console.log('🔄 모든 데이터 강제 갱신');
    showToast('데이터를 새로고침하는 중...', 'success');
    await invalidateLogsCache();
    await invalidateQAInfoCache();
    await fetchQAInformation(true);
    await fetchLogsCount(true); // 카운트 갱신
    await fetchLogs(true); // 현재 페이지 갱신
    showToast('데이터가 새로고침되었습니다!', 'success');
}

/**
 * 필터 조건을 Supabase 쿼리에 적용하는 헬퍼 함수
 * @param {Object} query - Supabase 쿼리 빌더
 * @param {Object} filters - 필터 조건 { author, content, state, search }
 * @returns {Object} 필터가 적용된 쿼리
 */
function applyFiltersToQuery(query, filters) {
    // 삭제되지 않은 항목만
    query = query.not('is_delete', 'eq', true);

    // 상태 필터
    if (filters.state && filters.state !== 'all') {
        query = query.eq('state', filters.state);
    }

    // 작성자 필터
    if (filters.author && filters.author !== 'all') {
        query = query.eq('user_name', filters.author);
    }

    // 콘텐츠 필터 (Scene 또는 Popup)
    if (filters.content && filters.content !== 'all') {
        const isPopup = filters.content.startsWith('[팝업]');
        const contentName = isPopup ? filters.content.replace('[팝업] ', '') : filters.content;

        // 한글 이름을 영어 코드로 역변환
        let codeValue = null;
        if (isPopup) {
            // Popup 매핑에서 찾기
            for (const [code, name] of Object.entries(POPUP_NAME_MAP)) {
                if (name === contentName) {
                    codeValue = code;
                    break;
                }
            }
            if (codeValue) {
                query = query.eq('current_popup', codeValue);
            }
        } else {
            // Scene 매핑에서 찾기
            for (const [code, name] of Object.entries(SCENE_NAME_MAP)) {
                if (name === contentName) {
                    codeValue = code;
                    break;
                }
            }
            if (codeValue) {
                query = query.eq('current_scene', codeValue);
            }
        }
    }

    // 검색어 필터
    if (filters.search && filters.search.trim()) {
        const searchTerm = filters.search.trim();
        const likeTerm = `%${searchTerm}%`;
        // 16진수 + 대시로만 이루어진 경우 → UUID 부분 일치 검색 (직접 filter로 cast)
        // 그 외 → 검수 내용 + 개발자 코멘트 텍스트 검색
        const isUuidLike = /^[0-9a-f-]+$/i.test(searchTerm);
        if (isUuidLike) {
            query = query.filter('id::text', 'ilike', likeTerm);
        } else {
            query = query.or(`user_description.ilike.${likeTerm},developer_comment.ilike.${likeTerm}`);
        }
    }

    return query;
}

/**
 * 총 로그 개수를 조회하는 함수 (필터 적용)
 * @param {boolean} forceRefresh - 강제 새로고침 여부
 * @returns {Promise<number>} 총 개수
 */
async function fetchLogsCount(forceRefresh = false) {
    // 캐시 키 생성 (필터 조건 포함)
    const cacheKey = JSON.stringify(currentFilters);

    // 캐시에서 먼저 시도
    if (!forceRefresh) {
        const cachedCount = await cacheManager.get('qa_logs_count', cacheKey);
        if (cachedCount !== null && cachedCount !== undefined) {
            console.log('✓ Logs Count 캐시에서 로드:', cachedCount);
            totalLogsCount = cachedCount;
            return cachedCount;
        }
    }

    // Supabase에서 개수 조회
    console.log('↓ Logs Count Supabase에서 조회');
    let query = supabaseClient
        .from('qa_logs')
        .select('*', { count: 'exact', head: true });

    // 필터 적용
    query = applyFiltersToQuery(query, currentFilters);

    const { count, error } = await query;

    if (error) {
        console.error('카운트 조회 실패:', error);
        totalLogsCount = 0;
        return 0;
    }

    totalLogsCount = count || 0;

    // 캐시에 저장 (5분 TTL)
    await cacheManager.set('qa_logs_count', cacheKey, totalLogsCount, 5 * 60 * 1000);

    console.log('✓ 총 로그 개수:', totalLogsCount);
    return totalLogsCount;
}

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
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('sidebar-toggle');

    const isOpen = sidebar.classList.contains('sidebar-open');

    if (isOpen) {
        // 닫기
        sidebar.classList.remove('sidebar-open');
        sidebar.classList.add('sidebar-closed');
        overlay.classList.add('hidden');

        // 햄버거 아이콘 변경
        toggleBtn.innerHTML = '<i class="fas fa-bars text-xl"></i>';
    } else {
        // 열기
        sidebar.classList.remove('sidebar-closed');
        sidebar.classList.add('sidebar-open');

        // 모바일에서는 오버레이 표시
        if (window.innerWidth < 768) {
            overlay.classList.remove('hidden');
        }

        // 햄버거 아이콘 변경
        toggleBtn.innerHTML = '<i class="fas fa-times text-xl"></i>';
    }
}

// 툴팁을 마우스 왼쪽에 표시
function positionTooltipLeft(event) {
    const tooltip = event.currentTarget.querySelector('.tooltip-text-left');
    if (!tooltip) return;

    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // 툴팁의 너비를 고려하여 왼쪽에 배치
    const tooltipWidth = tooltip.offsetWidth || 400; // 기본값 400px

    tooltip.style.left = `${mouseX - tooltipWidth - 10}px`;
    tooltip.style.top = `${mouseY + 10}px`;
}

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('nav-' + sectionId).classList.add('active');

    // 마스터 데이터 탭 첫 진입 시 자동 로드
    if (sectionId === 'masterdata' && !masterDataCache[currentMasterLang]) {
        loadMasterData(currentMasterLang);
    }

    // 검수 계정 관리 탭 진입 시 자동 로드
    if (sectionId === 'accounts') {
        fetchAccounts();
    }

    // 홈 탭 진입 시 QA 인원 현황 로드
    if (sectionId === 'home') {
        fetchQaMembers();
    }

    // 모바일에서 섹션 전환 시 사이드바 자동 닫기
    if (window.innerWidth < 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('sidebar-open')) {
            toggleSidebar();
        }
    }
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

    if (id === 'detailModal') {
        const loginPanel = document.getElementById('modal-login-info-section');
        if (loginPanel) loginPanel.classList.add('hidden');
    }

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
    // Choices.js 초기화 (콘텐츠 필터 검색 가능하게)
    const contentFilterElement = document.getElementById('contentFilter');
    const mobileContentFilterElement = document.getElementById('mobileContentFilter');

    if (contentFilterElement) {
        contentFilterChoices = new Choices(contentFilterElement, {
            searchEnabled: true,
            searchPlaceholderValue: '검색...',
            noResultsText: '결과 없음',
            itemSelectText: '',
            shouldSort: false,
            position: 'auto'
        });
    }

    if (mobileContentFilterElement) {
        mobileContentFilterChoices = new Choices(mobileContentFilterElement, {
            searchEnabled: true,
            searchPlaceholderValue: '검색...',
            noResultsText: '결과 없음',
            itemSelectText: '',
            shouldSort: false,
            position: 'auto'
        });
    }

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

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const detailModal = document.getElementById('detailModal');
            if (detailModal && !detailModal.classList.contains('hidden')) {
                closeModal('detailModal');
            }
        }
    });
});

    // 상태 배지
    function getStateBadge(stateValue) {
        const s = (stateValue || '').trim();
        if(s === '수정 필요') return '<span class="whitespace-nowrap inline-block bg-orange-100 text-orange-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-orange-200">수정 필요</span>';
        if(s === '수정 완료') return '<span class="whitespace-nowrap inline-block bg-blue-100 text-blue-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-blue-200">수정 완료</span>';
        if(s === '수정 확인') return '<span class="whitespace-nowrap inline-block bg-green-100 text-green-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-green-200">수정 확인</span>';
        if(s === '보류/패스') return '<span class="whitespace-nowrap inline-block bg-gray-100 text-gray-600 px-3 py-1.5 rounded-md text-[11px] font-black border border-gray-300">보류/패스</span>';
        if(s === '서버 수정 요청') return '<span class="whitespace-nowrap inline-block bg-purple-100 text-purple-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-purple-200">서버 수정 요청</span>';
        if(s === '서버 수정 완료') return '<span class="whitespace-nowrap inline-block bg-teal-100 text-teal-700 px-3 py-1.5 rounded-md text-[11px] font-black border border-teal-200">서버 수정 완료</span>';
        return `<span class="whitespace-nowrap inline-block bg-slate-50 text-slate-500 px-3 py-1.5 rounded-md text-[11px] font-bold border border-slate-200">${s || '신규 등록'}</span>`;
    }

    // 수정 완료 시점의 번들코드(코멘트 끝의 "(숫자)")를 현재 검수 번들코드와 비교
    // 배지 대상이면 { fixedBundle, verifiable, displayComment(번들코드 제거된 코멘트) } 반환
    function getFixBundleInfo(log) {
        const state = (log.state || log.status || '').trim();
        if (state !== '수정 완료') return null;

        const comment = log.developer_comment || '';
        const match = comment.match(/\((\d+)\)\s*$/);
        if (!match) return null;

        const fixedBundle = parseInt(match[1], 10);
        const nowBundle = parseInt(currentBundleCode, 10);
        if (isNaN(fixedBundle) || isNaN(nowBundle)) return null;

        return {
            fixedBundle,
            verifiable: nowBundle > fixedBundle,
            displayComment: comment.replace(/\s*\(\d+\)\s*$/, '')
        };
    }

    // 현재 검수 버전에서 수정 사항을 확인할 수 있는지 여부를 배지로 반환 (앞에 수정 시점 번들코드 표시)
    function getFixVerifyBadge(log) {
        const info = getFixBundleInfo(log);
        if (!info) return '';

        if (info.verifiable) {
            return `<div class="mt-1.5"><span class="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap"><i class="fas fa-check-circle"></i>(${info.fixedBundle}) 현재 버전에서 확인 가능</span></div>`;
        }
        return `<div class="mt-1.5"><span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-black whitespace-nowrap"><i class="fas fa-hourglass-half"></i>(${info.fixedBundle}) 현재 버전에서 확인 불가</span></div>`;
    }

    // 표시용 개발자 코멘트: 배지가 표시되는 경우 끝의 (번들코드)를 제거
    function getDisplayDevComment(log) {
        const info = getFixBundleInfo(log);
        return info ? info.displayComment : (log.developer_comment || '');
    }

/** 데이터 로드 및 처리 함수 **/
async function fetchQAInformation(forceRefresh = false) {
    const now = new Date().toISOString(); // 시간까지 포함된 전체 타임스탬프
    const today = now.split('T')[0]; // 캐시 키용 날짜

    // 캐시에서 먼저 시도
    if (!forceRefresh) {
        const cachedData = await cacheManager.get('qa_information', today);
        if (cachedData) {
            console.log('✓ QA Information 캐시에서 로드');
            updateQAInformationUI(cachedData);
            return;
        }
    }

    // 캐시 미스 또는 강제 갱신 - Supabase에서 가져오기
    console.log('↓ QA Information Supabase에서 로드 (최적화: 필요 컬럼만)');
    const { data } = await supabaseClient
        .from('qa_information')
        .select('id,version,round,start_at,end_at,bundleCode,serverInfo,created_at')
        .lte('start_at', now)
        .gte('end_at', now)
        .order('created_at', { ascending: false })
        .limit(1);

    // 데이터가 있으면 캐시에 저장 (30분 TTL로 연장)
    if (data && data.length > 0) {
        await cacheManager.set('qa_information', today, data[0], 30 * 60 * 1000);
        updateQAInformationUI(data[0]);
    } else {
        updateQAInformationUI(null);
    }
}

function updateQAInformationUI(qaInfo) {
    const versionEl = document.getElementById('qaVersion');
    const roundEl = document.getElementById('qaRound');
    const periodEl = document.getElementById('qaPeriod');
    const serverEl = document.getElementById('qaServer');
    const appDownloadBtn = document.getElementById('appDownloadBtn');

    if (qaInfo) {
        // bundleCode 저장
        currentBundleCode = qaInfo.bundleCode || '';
        // 앱 버전 저장
        currentAppVersion = qaInfo.version || '3.0.0';

        // 버전 표시 (bundleCode 포함)
        if (currentBundleCode) {
            versionEl.innerText = `v${qaInfo.version} (${currentBundleCode})`;
        } else {
            versionEl.innerText = `v${qaInfo.version}`;
        }

        roundEl.innerText = `${qaInfo.round}회차`;
        periodEl.innerText = `${formatKST(qaInfo.start_at)} ~ ${formatKST(qaInfo.end_at)}`;

        // 서버 정보 및 다운로드 링크 설정
        const serverInfo = qaInfo.serverInfo || 'dev';
        currentServerInfo = serverInfo;
        if (serverInfo === 'dev') {
            serverEl.innerText = '개발서버';
            serverEl.className = 'text-lg font-black text-orange-600';
            //appDownloadBtn.href = 'https://play.google.com/apps/internaltest/4699691061985176904';
            appDownloadBtn.href = 'https://play.google.com/apps/internaltest/4698733065951662135';
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
        currentBundleCode = '';
        currentAppVersion = '3.0.0'; // 기본값
        currentServerInfo = 'dev';
        versionEl.innerText = "없음"; 
        roundEl.innerText = "-"; 
        periodEl.innerText = "-";
        serverEl.innerText = "-";
        serverEl.className = 'text-lg font-black text-slate-700';
        appDownloadBtn.href = '#';
    }
}

function updateDashboard(logs) {
    let counts = {'수정 필요':0, '수정 완료':0, '수정 확인':0, '보류/패스':0, '서버 수정 요청':0, '서버 수정 완료':0};
    logs.forEach(log => { 
        const s = (log.state || log.status || '').trim(); 
        if(counts[s] !== undefined) counts[s]++; 
    });
    document.getElementById('cntRevision').innerText = counts['수정 필요']; 
    document.getElementById('cntFixed').innerText = counts['수정 완료'];
    document.getElementById('cntVerified').innerText = counts['수정 확인']; 
    document.getElementById('cntHold').innerText = counts['보류/패스'];
    document.getElementById('cntServerRequest').innerText = counts['서버 수정 요청'];
    document.getElementById('cntServerDone').innerText = counts['서버 수정 완료'];
    //const cntServerDone = document.getElementById('cntServerDone');
    //if (cntServerDone) cntServerDone.innerText = counts['서버 수정 완료'];
    // 전역 변수에 카운트 저장
    window.statusCounts = counts;

    // 상태 필터 토글 버튼 카운트 업데이트
    const scntAll = document.getElementById('scnt-all');
    const scntRevision = document.getElementById('scnt-revision');
    const scntFixed = document.getElementById('scnt-fixed');
    const scntVerified = document.getElementById('scnt-verified');
    const scntHold = document.getElementById('scnt-hold');
    const scntServer = document.getElementById('scnt-server');
    const scntServerDone = document.getElementById('scnt-server-done');
    if (scntAll) scntAll.textContent = logs.length;
    if (scntRevision) scntRevision.textContent = counts['수정 필요'];
    if (scntFixed) scntFixed.textContent = counts['수정 완료'];
    if (scntVerified) scntVerified.textContent = counts['수정 확인'];
    if (scntHold) scntHold.textContent = counts['보류/패스'];
    if (scntServer) scntServer.textContent = counts['서버 수정 요청'];
    if (scntServerDone) scntServerDone.textContent = counts['서버 수정 완료'];
}

function setStateFilter(value) {
    // hidden select 업데이트
    const stateFilter = document.getElementById('stateFilter');
    if (stateFilter) stateFilter.value = value;

    // 모바일 select 동기화
    const mobileStateFilter = document.getElementById('mobileStateFilter');
    if (mobileStateFilter) mobileStateFilter.value = value;

    // 토글 버튼 active 상태 업데이트
    document.querySelectorAll('.state-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.state === value);
    });

    // 콘텐츠 필터를 전체로 초기화 후 현재 상태에 맞게 옵션 갱신
    const contentFilter = document.getElementById('contentFilter');
    if (contentFilter) contentFilter.value = 'all';
    updateContentDropdown();

    applyFilters();
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

    // 상태 필터 적용 (토글 버튼 + hidden select 동기화)
    setStateFilter(state);
}

/**
 * 현재 페이지의 로그 데이터를 조회하는 함수 (서버 사이드 페이징)
 * @param {boolean} forceRefresh - 강제 새로고침 여부
 */
async function fetchLogs(forceRefresh = false) {
    const tbody = document.getElementById('logTableBody');
    const mobileContainer = document.getElementById('mobileCardContainer');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>데이터를 불러오는 중...</td></tr>';
    if (mobileContainer) mobileContainer.innerHTML = '<p class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>데이터를 불러오는 중...</p>';

    // 캐시 키 생성 (페이지 + 필터 + 정렬 조건 포함)
    const cacheKey = JSON.stringify({
        page: currentPage,
        filters: currentFilters,
        sort: dateSortOrder
    });

    // 캐시에서 먼저 시도
    if (!forceRefresh) {
        const cachedData = await cacheManager.get('qa_logs_page', cacheKey);
        if (cachedData) {
            console.log(`✓ 페이지 ${currentPage} 캐시에서 로드 (${cachedData.length}건)`);
            currentPageLogs = cachedData;
            renderTable();
            const checkAll = document.getElementById('checkAll');
            const mobileCheckAll = document.getElementById('mobileCheckAll');
            if (checkAll) checkAll.checked = false;
            if (mobileCheckAll) mobileCheckAll.checked = false;
            return;
        }
    }

    // Supabase에서 페이지별 데이터 조회
    console.log(`↓ 페이지 ${currentPage} Supabase에서 로드`);

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage - 1;

    let query = supabaseClient
        .from('qa_logs')
        .select('id,user_name,state,current_scene,current_popup,user_description,developer_comment,created_at,updated_at,image_url,is_delete,inAppLogs,login_info');

    // 필터 적용
    query = applyFiltersToQuery(query, currentFilters);

    // 정렬 적용
    if (dateSortOrder !== 'none') {
        query = query.order('created_at', { ascending: dateSortOrder === 'asc' });
    }

    // 페이징 적용
    query = query.range(startIndex, endIndex);

    const { data, error } = await query;

    if (error) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-red-500">실패: ${error.message}</td></tr>`;
        if (mobileContainer) mobileContainer.innerHTML = `<p class="text-center py-8 text-red-500">실패: ${error.message}</p>`;
        return;
    }

    // 데이터를 캐시에 저장 (10분 TTL)
    if (data) {
        currentPageLogs = data;
        await cacheManager.set('qa_logs_page', cacheKey, data, 10 * 60 * 1000);
    } else {
        currentPageLogs = [];
    }

    renderTable();
    const checkAll = document.getElementById('checkAll');
    const mobileCheckAll = document.getElementById('mobileCheckAll');
    if (checkAll) checkAll.checked = false;
    if (mobileCheckAll) mobileCheckAll.checked = false;
}

/**
 * 대시보드 및 드롭다운용 요약 데이터를 조회하는 함수
 * (상태별 카운트, 작성자 목록, 콘텐츠 목록 등)
 */
async function fetchSummaryData(forceRefresh = false) {
    // 캐시에서 먼저 시도
    if (!forceRefresh) {
        const cachedSummary = await cacheManager.get('qa_logs_summary', 'default');
        if (cachedSummary) {
            console.log('✓ Summary 데이터 캐시에서 로드:', cachedSummary.length, '건');
            globalLogs = cachedSummary;
            updateDashboard(globalLogs);
            updateAuthorDropdown();
            return;
        }
    }

    // Supabase에서 요약 데이터 조회 (전체 데이터, 단 필요한 컬럼만)
    // 1000개 제한을 우회하기 위해 페이징으로 모든 데이터 가져오기
    console.log('↓ Summary 데이터 Supabase에서 로드 시작...');

    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const startIndex = page * pageSize;
        const endIndex = startIndex + pageSize - 1;

        console.log(`  📄 페이지 ${page + 1} 요청: range(${startIndex}, ${endIndex})`);

        const { data, error } = await supabaseClient
            .from('qa_logs')
            .select('id,user_name,state,current_scene,current_popup,created_at')
            .not('is_delete', 'eq', true)
            .order('created_at', { ascending: false })
            .range(startIndex, endIndex);

        if (error) {
            console.error('❌ Summary 조회 실패:', error);
            break;
        }

        if (data && data.length > 0) {
            allData = allData.concat(data);
            console.log(`  ✓ 페이지 ${page + 1}: ${data.length}건 로드 (누적: ${allData.length}건)`);

            // 다음 페이지가 있는지 확인
            if (data.length < pageSize) {
                console.log(`  ⏹ 마지막 페이지 도달 (${data.length} < ${pageSize})`);
                hasMore = false;
            } else {
                console.log(`  ➡ 다음 페이지 계속...`);
                page++;
            }
        } else {
            console.log(`  ⏹ 데이터 없음 - 종료`);
            hasMore = false;
        }
    }

    globalLogs = allData;
    console.log(`✅ 총 ${globalLogs.length}건의 Summary 데이터 로드 완료`);

    // 캐시에 저장 (30분 TTL)
    await cacheManager.set('qa_logs_summary', 'default', globalLogs, 30 * 60 * 1000);

    updateDashboard(globalLogs);
    updateAuthorDropdown();
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

    // 콘텐츠 필터 드롭다운 업데이트
    updateContentDropdown();
}

function updateContentDropdown() {
    const contentFilter = document.getElementById('contentFilter');
    const mobileContentFilter = document.getElementById('mobileContentFilter');
    const contents = new Set();

    // 현재 상태 필터에 해당하는 항목만 콘텐츠 목록에 포함
    const currentState = document.getElementById('stateFilter')?.value || 'all';
    const logsForContent = currentState === 'all'
        ? globalLogs
        : globalLogs.filter(log => (log.state || log.status || '').trim() === currentState);

    logsForContent.forEach(log => {
        if (log.current_scene) {
            const koreanName = getDisplayName(log.current_scene, false);
            contents.add(koreanName);
        }
        if (log.current_popup) {
            const koreanName = getDisplayName(log.current_popup, true);
            contents.add(`[팝업] ${koreanName}`);
        }
    });

    const currentSelection = contentFilter ? contentFilter.value : 'all';
    const sortedContents = Array.from(contents).sort();

    // 현재 선택이 새 목록에 없으면 'all'로 초기화
    const validSelection = currentSelection === 'all' || sortedContents.includes(currentSelection);
    const finalSelection = validSelection ? currentSelection : 'all';
    if (!validSelection && contentFilter) contentFilter.value = 'all';

    // Choices.js가 초기화되어 있으면 clearStore하고 다시 설정
    if (contentFilterChoices) {
        contentFilterChoices.clearStore();
        contentFilterChoices.setChoices([
            { value: 'all', label: '전체 보기', selected: finalSelection === 'all' },
            ...sortedContents.map(content => ({
                value: content,
                label: content,
                selected: content === finalSelection
            }))
        ], 'value', 'label', true);
    } else if (contentFilter) {
        // Choices.js가 없으면 기본 select 업데이트
        let filterHtml = '<option value="all">전체 보기</option>';
        sortedContents.forEach(content => {
            filterHtml += `<option value="${content}">${content}</option>`;
        });
        contentFilter.innerHTML = filterHtml;
        contentFilter.value = finalSelection;
    }

    // 모바일 콘텐츠 필터 업데이트
    if (mobileContentFilterChoices) {
        mobileContentFilterChoices.clearStore();
        mobileContentFilterChoices.setChoices([
            { value: 'all', label: '콘텐츠: 전체', selected: finalSelection === 'all' },
            ...sortedContents.map(content => ({
                value: content,
                label: `콘텐츠: ${content}`,
                selected: content === finalSelection
            }))
        ], 'value', 'label', true);
    } else if (mobileContentFilter) {
        // Choices.js가 없으면 기본 select 업데이트
        let mobileFilterHtml = '<option value="all">콘텐츠: 전체</option>';
        sortedContents.forEach(content => {
            mobileFilterHtml += `<option value="${content}">콘텐츠: ${content}</option>`;
        });
        mobileContentFilter.innerHTML = mobileFilterHtml;
        mobileContentFilter.value = finalSelection;
    }
}

function syncFilters(type) {
    const authorFilter = document.getElementById('authorFilter');
    const mobileAuthorFilter = document.getElementById('mobileAuthorFilter');
    const contentFilter = document.getElementById('contentFilter');
    const mobileContentFilter = document.getElementById('mobileContentFilter');
    const stateFilter = document.getElementById('stateFilter');
    const mobileStateFilter = document.getElementById('mobileStateFilter');

    if (type === 'author' && mobileAuthorFilter) {
        authorFilter.value = mobileAuthorFilter.value;
    } else if (type === 'content' && mobileContentFilter) {
        contentFilter.value = mobileContentFilter.value;
    } else if (type === 'state' && mobileStateFilter) {
        // 모바일 상태 필터 변경 시 토글 버튼과 동기화
        setStateFilter(mobileStateFilter.value);
        return;
    }
    applyFilters();
}

async function applyFilters() {
    // 현재 필터 상태 업데이트
    currentFilters.author = document.getElementById('authorFilter').value;
    currentFilters.content = document.getElementById('contentFilter').value;
    currentFilters.state = document.getElementById('stateFilter').value;

    const searchInput = document.getElementById('searchInput');
    currentFilters.search = searchInput ? searchInput.value.trim() : '';

    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
        if (currentFilters.search) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }

    // 페이지를 1로 리셋
    currentPage = 1;

    // 총 개수 다시 조회
    await fetchLogsCount(true);

    // 현재 페이지 데이터 조회
    await fetchLogs(true);

    // 페이지네이션 렌더링
    renderPagination();
}

function onSearchInput() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
        if (searchInput && searchInput.value.trim()) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
}

function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
        searchInput.value = '';
    }
    if (clearBtn) {
        clearBtn.classList.add('hidden');
    }

    applyFilters();
}

async function toggleDateSort() {
    // 정렬 순서 토글: desc -> asc -> none -> desc
    if (dateSortOrder === 'desc') {
        dateSortOrder = 'asc';
    } else if (dateSortOrder === 'asc') {
        dateSortOrder = 'none';
    } else {
        dateSortOrder = 'desc';
    }

    // 아이콘 업데이트
    const sortIcon = document.getElementById('sortIcon');
    if (sortIcon) {
        if (dateSortOrder === 'desc') {
            sortIcon.className = 'fas fa-sort-down text-blue-600 text-xs';
        } else if (dateSortOrder === 'asc') {
            sortIcon.className = 'fas fa-sort-up text-blue-600 text-xs';
        } else {
            sortIcon.className = 'fas fa-sort text-gray-400 text-xs';
        }
    }

    // 정렬 적용 - 서버에서 다시 가져오기
    currentPage = 1;
    await fetchLogs(true);
    renderPagination();
}

// applySortAndRender 함수는 더 이상 필요 없음 (서버에서 정렬)
// 삭제하거나 주석 처리

function renderTable() {
    const tbody = document.getElementById('logTableBody');
    const mobileContainer = document.getElementById('mobileCardContainer');
    tbody.innerHTML = ''; 
    if (mobileContainer) mobileContainer.innerHTML = '';

    if (currentPageLogs.length === 0) {
        renderPagination();
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-400">내역이 없습니다.</td></tr>';
        if (mobileContainer) mobileContainer.innerHTML = '<p class="text-center py-8 text-gray-400">내역이 없습니다.</p>';
        return;
    }

    currentPageLogs.forEach(log => {
        const authorName = log.user_name || '알 수 없음';
        const currentState = (log.state || log.status || '').trim();
        const devComment = log.developer_comment || '<span class="text-gray-300 italic">코멘트 없음</span>';

        let imageActionHtml = log.image_url 
            ? `<button onclick="openImageViewerModal('${log.id}')" class="text-blue-700 hover:text-blue-900 text-[10px] font-black border border-blue-200 px-2.5 py-1 rounded-md bg-blue-50/50 shadow-sm transition"><i class="fas fa-image mr-1"></i>이미지 보기</button>`
            : `<button onclick="openAddEditImageModal('${log.id}', null)" class="text-slate-500 hover:text-slate-700 text-[10px] font-bold border border-dashed border-slate-300 px-2 py-1 rounded-md transition shadow-inner">+추가</button>`;

        let actionButtons = '';
        if (currentState === '수정 필요') {
            actionButtons += `<button onclick="openDevProcessModal('${log.id}', '수정 필요')" class="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full mb-1">상태 변경</button>`;
        } else if (currentState === '서버 수정 요청') {
            actionButtons += `<button onclick="openDevProcessModal('${log.id}', '서버 수정 요청')" class="bg-teal-100 text-teal-700 hover:bg-teal-200 border border-teal-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full mb-1">서버 수정 완료</button>`;
        } else if (currentState === '수정 완료') {
            actionButtons += `<button onclick="directUpdateState('${log.id}', '수정 확인')" class="bg-green-100 text-green-700 hover:bg-green-200 border border-green-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full mb-1">수정 확인</button>`;
            actionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full">재수정요청</button>`;
        } else if (currentState === '보류/패스' || currentState === '수정 확인') {
            actionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 hover:bg-orange-200 border border-orange-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full">재수정요청</button>`;
        } else if (currentState === '서버 수정 완료') {
            actionButtons += `<button onclick="directUpdateState('${log.id}', '수정 완료')" class="bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full mb-1">수정 완료</button>`;
            actionButtons += `<button onclick="directUpdateState('${log.id}', '서버 수정 요청')" class="bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-200 px-2 py-1.5 rounded shadow-sm text-[10px] font-black transition w-full">서버 수정 요청</button>`;
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

        // 스테이지 ID 감지
        const descStageId = extractStageId(log.user_description);
        const stageBadgeHtml = descStageId
            ? `<button onclick="openStageInfoModal(${descStageId})" class="mt-2 inline-flex items-center gap-1.5 bg-blue-50 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-full text-[10px] font-bold hover:bg-blue-100 hover:border-blue-300 transition">
                <i class="fas fa-layer-group text-[9px]"></i>stageId: ${descStageId}
               </button>`
            : '';

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
            <td class="px-4 py-4 font-semibold text-gray-700 text-center border-b border-gray-100">
                <div>${authorName}</div>
                ${log.login_info ? `<button onclick="openLoginInfoPanel('${log.id}')" class="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full hover:bg-blue-100 transition whitespace-nowrap"><i class="fas fa-user-circle"></i>로그인정보</button>` : ''}
            </td>
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
                ${stageBadgeHtml}
            </td>
            <td class="px-4 py-4 text-center border-b border-gray-100">${imageActionHtml}</td>
            <td class="px-4 py-4 text-gray-600 border-b border-gray-100 ${currentState === '수정 완료' ? 'cursor-pointer hover:bg-blue-50/30' : ''}" ${currentState === '수정 완료' ? `onclick="openDevCommentEditModal('${log.id}')" title="클릭하여 코멘트 수정"` : ''}>
                <div class="tooltip-container">
                    <div class="line-clamp-3 w-full text-xs leading-relaxed">${getDisplayDevComment(log) || '<span class="text-gray-300 italic">코멘트 없음</span>'}</div>
                    <span class="tooltip-text-left">${getDisplayDevComment(log) || '코멘트 없음'}</span>
                </div>
                ${getFixVerifyBadge(log)}
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
            if (currentState === '수정 필요') {
                mobileActionButtons += `<button onclick="openDevProcessModal('${log.id}', '수정 필요')" class="bg-indigo-100 text-indigo-700 border border-indigo-200">상태 변경</button>`;
            } else if (currentState === '서버 수정 요청') {
                mobileActionButtons += `<button onclick="openDevProcessModal('${log.id}', '서버 수정 요청')" class="bg-teal-100 text-teal-700 border border-teal-200">서버 수정 완료</button>`;
            } else if (currentState === '수정 완료') {
                mobileActionButtons += `<button onclick="directUpdateState('${log.id}', '수정 확인')" class="bg-green-100 text-green-700 border border-green-200">수정 확인</button>`;
                mobileActionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 border border-orange-200">재수정요청</button>`;
            } else if (currentState === '보류/패스' || currentState === '수정 확인') {
                mobileActionButtons += `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-100 text-orange-700 border border-orange-200">재수정요청</button>`;
            } else if (currentState === '서버 수정 완료') {
                mobileActionButtons += `<button onclick="directUpdateState('${log.id}', '수정 완료')" class="bg-blue-100 text-blue-700 border border-blue-200">수정 완료</button>`;
                mobileActionButtons += `<button onclick="directUpdateState('${log.id}', '서버 수정 요청')" class="bg-purple-100 text-purple-700 border border-purple-200">서버 수정 요청</button>`;
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
                    ${descStageId ? `<button onclick="openStageInfoModal(${descStageId})" class="mt-2 inline-flex items-center gap-1.5 bg-blue-50 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-full text-[10px] font-bold hover:bg-blue-100 transition"><i class="fas fa-layer-group text-[9px]"></i>stageId: ${descStageId}</button>` : ''}
                    <div class="mobile-card-meta">
                        <span class="mobile-card-meta-item" title="작성: ${formatKST(log.created_at)}"><i class="fas fa-calendar-alt"></i> ${formatRelativeTime(log.created_at)}</span>
                        ${log.updated_at ? `<span class="mobile-card-meta-item text-blue-500" title="업데이트: ${formatKST(log.updated_at)}"><i class="fas fa-sync-alt"></i> ${formatRelativeTime(log.updated_at)}</span>` : ''}
                    </div>
                    ${log.developer_comment ? `<div class="mobile-card-comment ${currentState === '수정 완료' ? 'cursor-pointer hover:bg-blue-50/30 active:bg-blue-100/30 transition' : ''}" ${currentState === '수정 완료' ? `onclick="openDevCommentEditModal('${log.id}')"` : ''}><div class="mobile-card-comment-label">${currentState === '수정 완료' ? '<i class="fas fa-edit mr-1 text-blue-500"></i>' : ''}개발자 코멘트</div>${getDisplayDevComment(log)}${getFixVerifyBadge(log)}</div>` : ''}
                    <div class="mobile-card-actions">
                        ${mobileActionButtons}
                        ${mobileImageBtn}
                        <button onclick="openDetailModal('${log.id}')" class="bg-slate-100 text-slate-600 border border-slate-200"><i class="fas fa-search-plus mr-1"></i>상세</button>
                        <button onclick="openEditDescModal('${log.id}')" class="bg-slate-100 text-slate-600 border border-slate-200"><i class="fas fa-pencil-alt mr-1"></i>수정</button>
                        ${log.login_info ? `<button onclick="openLoginInfoPanel('${log.id}')" class="bg-blue-50 text-blue-700 border border-blue-200"><i class="fas fa-user-circle mr-1"></i>로그인정보</button>` : ''}
                    </div>
                </div>
            `;
            mobileContainer.appendChild(card);
        }
    });
    renderPagination();
}

function renderPagination() {
    const paginationDiv = document.getElementById('pagination');
    paginationDiv.innerHTML = '';

    const totalItems = totalLogsCount;
    if (totalItems <= itemsPerPage) return;

    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const maxVisiblePages = 10; // 한 번에 보여줄 최대 페이지 수

    // 현재 페이지 그룹 계산 (1-10, 11-20, 21-30...)
    const currentGroup = Math.ceil(currentPage / maxVisiblePages);
    const startPage = (currentGroup - 1) * maxVisiblePages + 1;
    const endPage = Math.min(startPage + maxVisiblePages - 1, totalPages);

    // 이전 버튼
    const prevDisabled = currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100';
    paginationDiv.innerHTML += `<button onclick="changePage(${currentPage - 1})" class="px-3 py-1 rounded border border-gray-200 text-slate-600 text-xs font-bold ${prevDisabled}" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;

    // 첫 페이지로 가기 (현재 그룹이 1보다 크면 표시)
    if (startPage > 1) {
        paginationDiv.innerHTML += `<button onclick="changePage(1)" class="px-3 py-1 rounded border bg-white text-slate-600 border-gray-200 hover:bg-slate-50 text-xs font-bold transition">1</button>`;
        if (startPage > 2) {
            paginationDiv.innerHTML += `<span class="px-2 py-1 text-slate-400">...</span>`;
        }
    }

    // 현재 그룹의 페이지 버튼들
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === currentPage ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-gray-200 hover:bg-slate-50';
        paginationDiv.innerHTML += `<button onclick="changePage(${i})" class="px-3 py-1 rounded border text-xs font-bold transition ${activeClass}">${i}</button>`;
    }

    // 마지막 페이지로 가기 (현재 그룹이 마지막이 아니면 표시)
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationDiv.innerHTML += `<span class="px-2 py-1 text-slate-400">...</span>`;
        }
        paginationDiv.innerHTML += `<button onclick="changePage(${totalPages})" class="px-3 py-1 rounded border bg-white text-slate-600 border-gray-200 hover:bg-slate-50 text-xs font-bold transition">${totalPages}</button>`;
    }

    // 다음 버튼
    const nextDisabled = currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100';
    paginationDiv.innerHTML += `<button onclick="changePage(${currentPage + 1})" class="px-3 py-1 rounded border border-gray-200 text-slate-600 text-xs font-bold ${nextDisabled}" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
}

async function changePage(p) {
    const total = Math.ceil(totalLogsCount / itemsPerPage);
    if (p < 1 || p > total) return;

    currentPage = p;

    // 서버에서 해당 페이지 데이터 가져오기
    await fetchLogs();
}

/**
 * ID로 로그를 조회하는 헬퍼 함수 (현재 페이지 또는 서버에서)
 * @param {string} logId - 로그 ID
 * @returns {Promise<Object|null>} 로그 객체 또는 null
 */
async function findLogById(logId) {
    // 현재 페이지에서 먼저 찾기
    let log = currentPageLogs.find(l => l.id === logId);
    if (log) return log;

    // Summary 데이터에서 찾기
    log = globalLogs.find(l => l.id === logId);
    if (log) {
        // Summary 데이터에는 상세 정보가 없을 수 있으므로 서버에서 전체 데이터 조회
        const { data, error } = await supabaseClient
            .from('qa_logs')
            .select('*')
            .eq('id', logId)
            .single();

        if (!error && data) return data;
    }

    // 서버에서 조회
    const { data, error } = await supabaseClient
        .from('qa_logs')
        .select('*')
        .eq('id', logId)
        .single();

    return error ? null : data;
}

function toggleLoginSection(id) {
    const section = document.getElementById(`section-${id}`);
    const chevron = document.getElementById(`chevron-${id}`);
    if (!section) return;
    const isHidden = section.classList.toggle('hidden');
    if (chevron) chevron.style.transform = isHidden ? '' : 'rotate(180deg)';
}

function _renderProfileCard(idx) {
    const cards = window._liProfileCards;
    if (!cards || cards.length === 0) return;
    idx = Math.max(0, Math.min(idx, cards.length - 1));
    window._liProfileIdx = idx;
    const slot = document.getElementById('li-profile-slot');
    if (slot) slot.innerHTML = cards[idx];
    const counter = document.getElementById('li-profile-counter');
    if (counter) counter.textContent = `${idx + 1} / ${cards.length}`;
    const prevBtn = document.getElementById('li-profile-prev');
    const nextBtn = document.getElementById('li-profile-next');
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx === cards.length - 1;
}

function navigateProfile(delta) {
    _renderProfileCard((window._liProfileIdx ?? 0) + delta);
}

/**
 * 로그인 정보 패널에 데이터를 채우는 함수
 * @param {Object|string|null} loginInfoData - login_info 원시 데이터
 */
function populateLoginInfoPanel(loginInfoData) {
    const loginInfoSection = document.getElementById('modal-login-info-section');
    const loginInfoBody = document.getElementById('modal-login-info-body');

    let info = loginInfoData;
    if (typeof info === 'string') {
        try { info = JSON.parse(info); } catch(e) { info = null; }
    }

    if (!info || typeof info !== 'object') {
        loginInfoSection.classList.add('hidden');
        return;
    }

    const acc = info.account || null;
    const license = info.license || null;
    const profiles = Array.isArray(info.profiles) ? info.profiles : [];
    const mainProfileId = info.mainProfileId ?? null;
    const school = info.school || null;
    const classInfo = info.classInfo || null;

    const NULL_TEXT = '<span class="text-slate-300 italic">null</span>';
    const fv = v => (v === null || v === undefined) ? NULL_TEXT : `<span class="font-mono text-slate-700 break-all">${v}</span>`;
    const row = (label, val) => `
        <div class="flex flex-col gap-0.5">
            <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${label}</span>
            <span class="text-[11px]">${fv(val)}</span>
        </div>`;

    const LICENSE_TYPE_MAP = {
        '-1': 'Unknown', '0': 'None',
        '1': '일반 결제', '11': '최고관리자 지급', '12': '서포터즈', '13': '이벤트 지급',
        '21': 'SKT 제휴', '31': '공동구매(유저)', '32': '공동구매(관리자)', '33': '이벤트 공동구매',
        '41': '쿠폰 이용권', '42': '전화번호 등록', '43': '7일 무료체험',
        '51': '회원가입 프로모션', '100': '학계/학교 라이선스'
    };
    const GAME_CENTER_LOCK_MAP = { '0': '잠금 해제', '1': '잠금', '2': '오늘학습 후 오픈' };
    const LOCK_MAP = { '0': '잠금 해제', '1': '잠금' };

    // 계정 섹션
    const accSection = acc ? `
        <div class="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5">
            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">AccountID</span>
                <span class="text-[11px] flex items-center gap-1.5">
                    ${fv(acc.accountId)}
                    ${acc.isGuestAccount === true ? '<span class="text-[8px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-black border border-orange-200">게스트계정</span>' : ''}
                </span>
            </div>
            ${row('이름', acc.name)}
            ${row('아이디(이메일)', acc.id)}
            ${row('비밀번호', acc.password)}
            ${row('전화번호', acc.phoneNumber)}
            ${row('가용 프로필 수', acc.availableProfileCount)}
            ${row('대표 프로필ID', mainProfileId)}
        </div>` : `<div class="text-[10px] text-slate-300 italic">account: null</div>`;

    // 라이선스 섹션
    let licenseSection = '';
    if (license) {
        const typeKey = String(license.type ?? '');
        const typeName = LICENSE_TYPE_MAP[typeKey] ?? `타입 ${typeKey}`;
        const remSec = license.remainingSeconds ?? null;
        let remText = null;
        if (remSec !== null) {
            const d = Math.floor(remSec / 86400);
            const h = Math.floor((remSec % 86400) / 3600);
            const m = Math.floor((remSec % 3600) / 60);
            remText = `${d}일 ${h}시간 ${m}분 (${remSec.toLocaleString()}초)`;
        }
        licenseSection = `
        <div class="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5">
            ${row('타입', license.type !== undefined && license.type !== null ? `${license.type} (${typeName})` : null)}
            ${row('남은 시간', remText)}
        </div>`;
    } else {
        licenseSection = `<div class="text-[10px] text-slate-300 italic">license: null</div>`;
    }

    // 학교 / 반 섹션
    const schoolSection = `
        <div class="bg-white border border-slate-200 rounded-lg p-3 space-y-1.5">
            ${school ? `
                ${row('학교ID', school.schoolId)}
                ${row('학교명', school.name)}` : `<div class="text-[10px] text-slate-300 italic">school: null</div>`}
            ${classInfo ? `
                <div class="border-t border-slate-100 pt-1.5 mt-1.5"></div>
                ${row('반ID', classInfo.classId)}
                ${row('반명', classInfo.name)}
                ${row('학년', classInfo.grade)}` : `<div class="text-[10px] text-slate-300 italic">classInfo: null</div>`}
        </div>`;

    // 프로필 섹션
    const profileCardArr = profiles.map(p => {
        const isMain = p.profileId === mainProfileId;
        const gcLock = GAME_CENTER_LOCK_MAP[String(p.gameCenterLock ?? '')] ?? String(p.gameCenterLock ?? null);
        const dailyLock = LOCK_MAP[String(p.dailyStageCountLock ?? p.dailyStageCountLock === 0 ? p.dailyStageCountLock : '')] ?? null;
        const rnLock = LOCK_MAP[String(p.reviewNoteAccuracyLock ?? '')] ?? null;
        const pushDaysText = Array.isArray(p.pushDays) && p.pushDays.length > 0 ? p.pushDays.join(', ') : (p.pushDays === null ? null : '[]');
        return `<div class="bg-white border ${isMain ? 'border-blue-300 ring-1 ring-blue-200' : 'border-slate-200'} rounded-lg p-2.5 space-y-1">
            <div class="flex items-center justify-between mb-1">
                <span class="text-[11px] font-black text-slate-700">${p.name ?? '<span class="text-slate-300">null</span>'}</span>
                ${isMain ? '<span class="text-[8px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-black">대표</span>' : ''}
            </div>
            ${row('profileId', p.profileId)}
            ${row('코드', p.code)}
            ${row('전화번호', p.phoneNumber)}
            ${row('이메일', p.email)}
            ${row('비밀번호', p.password)}
            ${row('학습리포트', p.isLearningReportEnabled === true ? '활성' : p.isLearningReportEnabled === false ? '비활성' : null)}
            ${row('레벨 범위', p.minLevel !== undefined ? `${p.minLevel} ~ ${p.maxLevel}` : null)}
            ${row('국가 챕터ID', p.nationalChapterId)}
            ${row('ShowingLevel', p.ShowingLevel ?? p.level)}
            ${row('ChapterNumber', p.ChapterNumber ?? p.chapterNumber)}
            ${row('일학습 현황', p.dailyStageCurrentCount !== undefined ? `${p.dailyStageCurrentCount} / ${p.dailyStageTargetCount} (최대 ${p.MaxDailyStudyTargetCount ?? 20})` : null)}
            ${row('일학습 잠금', dailyLock ?? (p.dailyStageCountLock !== undefined ? String(p.dailyStageCountLock) : null))}
            ${row('코인', p.coin !== undefined ? p.coin.toLocaleString() : null)}
            ${row('대표 아바타ID', p.mainFriendsAvatarCharacterId)}
            ${row('게임센터 잠금', gcLock)}
            ${row('오답노트 정확도', p.reviewNoteAccuracy !== undefined ? `${p.reviewNoteAccuracy}%` : null)}
            ${row('오답노트 잠금', rnLock ?? (p.reviewNoteAccuracyLock !== undefined ? String(p.reviewNoteAccuracyLock) : null))}
            ${row('타이틀ID', p.titleId)}
            ${row('국가코드', p.countryCode)}
            ${row('푸시 알림', p.isPushEnabled === true ? '활성' : p.isPushEnabled === false ? '비활성' : null)}
            ${row('푸시 요일', pushDaysText)}
            ${row('푸시 시간', p.pushTime)}
            ${(() => {
                const chars = Array.isArray(p.friendsAvatarCharacters) ? p.friendsAvatarCharacters : [];
                if (chars.length === 0) return '';
                const avatarItemTypeMap = {};
                const avatarItemType1Map = {};
                const avatarItemFileNameMap = {};
                const langOrder = ['ko', 'en', 'ja'];
                for (const lang of langOrder) {
                    const cached = masterDataCache[lang];
                    if (cached) {
                        const items = cached.masterData?.friendsAvatarMasterData?.friendsAvatarItems ?? [];
                        items.forEach(item => {
                            avatarItemTypeMap[item.friendsAvatarItemId] = item.itemInfoType2;
                            avatarItemType1Map[item.friendsAvatarItemId] = item.type1;
                            avatarItemFileNameMap[item.friendsAvatarItemId] = item.fileName;
                        });
                        if (Object.keys(avatarItemTypeMap).length > 0) break;
                    }
                }
                const TYPE1_KO = {
                    BACK_ACCESSORIES: '등 악세서리', HAT: '모자', HEAD_ACCESSORIES: '머리 악세서리',
                    PANTS: '하의', SUIT: '한 벌옷', TOP: '상의', WEAPON: '무기',
                };
                const TYPE1_ORDER = ['HAT', 'HEAD_ACCESSORIES', 'TOP', 'SUIT', 'PANTS', 'BACK_ACCESSORIES', 'WEAPON'];
                const CHARACTER_NAME = ['에러', '뚜이', '나누', '고고', '배로', '라니', '마크'];
                const renderItemId = id => {
                    const type = avatarItemTypeMap[id];
                    const type1 = avatarItemType1Map[id];
                    const fileName = avatarItemFileNameMap[id];
                    const imgPath = (type1 && fileName) ? getAvatarItemImagePath({ type1, fileName }) : null;
                    const isReward = type === 'REWARD';
                    const colorStyle = isReward ? ' style="color:#e91e8c"' : '';
                    const colorCls = isReward ? 'font-bold' : '';
                    if (imgPath) {
                        const allCandidates = getAvatarItemImageCandidates({ type1, fileName });
                        const cAttr = JSON.stringify(allCandidates).replace(/"/g, '&quot;');
                        return `<button class="font-mono text-[10px] ${colorCls} px-1 py-0.5 rounded hover:bg-slate-200 active:bg-slate-300 transition"${colorStyle} onmousedown="showAvatarItemPreview(event,'${imgPath}','${cAttr}')" onmouseup="hideAvatarItemPreview()" onmouseleave="hideAvatarItemPreview()" ontouchstart="showAvatarItemPreview(event,'${imgPath}','${cAttr}')" ontouchend="hideAvatarItemPreview()">${id}</button>`;
                    }
                    return `<span class="font-mono text-[10px] ${colorCls} text-slate-700"${colorStyle}>${id}</span>`;
                };
                const renderItemList = ids => {
                    if (!Array.isArray(ids) || ids.length === 0) return '-';
                    const groups = {};
                    const unknownIds = [];
                    ids.forEach(id => {
                        const t1 = avatarItemType1Map[id];
                        if (t1) { if (!groups[t1]) groups[t1] = []; groups[t1].push(id); }
                        else { unknownIds.push(id); }
                    });
                    if (!Object.keys(groups).length) return ids.map(renderItemId).join('<span class="text-slate-300">, </span>');
                    const sep = '<span class="text-slate-300">, </span>';
                    const lines = [];
                    const orderedKeys = [...TYPE1_ORDER.filter(k => groups[k]), ...Object.keys(groups).filter(k => !TYPE1_ORDER.includes(k))];
                    orderedKeys.forEach(t1 => {
                        lines.push(`<span class="text-slate-400 font-bold">${TYPE1_KO[t1] || t1}:</span> ${groups[t1].map(renderItemId).join(sep)}`);
                    });
                    if (unknownIds.length > 0) lines.push(unknownIds.map(renderItemId).join(sep));
                    return lines.join('<br>');
                };
                const charRows = chars.map(c => `
                    <div class="bg-slate-50 border border-slate-100 rounded p-2 space-y-0.5">
                        <div class="flex items-center gap-1.5 mb-0.5">
                            <span class="text-[14px] font-black text-slate-600">${CHARACTER_NAME[c.friendsAvatarCharacterId]}</span>
                            <div class="flex items-center gap-1">
                                ${c.isOwned ? '<span class="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-black border border-green-200">보유</span>' : '<span class="text-[8px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-black border border-slate-200">미보유</span>'}
                                ${c.friendsAvatarCharacterId === p.mainFriendsAvatarCharacterId ? '<span class="text-[8px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-black border border-yellow-200">메인</span>' : ''}
                            </div>
                        </div>
                        <br>
                        <div class="text-[12px] text-slate-500 leading-relaxed"><b>보유 아이템:</b><br> ${renderItemList(c.ownedFriendsAvatarItemIds)}</div>
                        <br>
                        <div class="text-[12px] text-slate-500 leading-relaxed"><b>착용 아이템:</b><br> ${renderItemList(c.equippedFriendsAvatarItemIds)}</div>
                    </div>`).join('');
                return `<div class="flex flex-col gap-0.5"><span class="text-[9px] font-black text-slate-400 uppercase tracking-widest">아바타 캐릭터 (${chars.length}개)</span><div class="space-y-1 mt-0.5">${charRows}</div></div>`;
            })()}
        </div>`;
    });

    const _mkSec = (id, icon, title, content, open = false) => `
        <div class="border border-slate-100 rounded-xl overflow-hidden mb-2">
            <button onclick="toggleLoginSection('${id}')" class="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition text-left">
                <span class="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <i class="${icon}"></i>${title}
                </span>
                <i id="chevron-${id}" class="fas fa-chevron-down text-slate-400 text-[10px] transition-transform duration-200" style="${open ? 'transform:rotate(180deg)' : ''}"></i>
            </button>
            <div id="section-${id}" class="${open ? '' : 'hidden'} px-3 pt-2 pb-3">
                ${content}
            </div>
        </div>`;

    const profileCarouselHtml = profiles.length > 0 ? `
        <div class="flex items-center gap-2 mb-3">
            <button id="li-profile-prev" onclick="navigateProfile(-1)" class="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 disabled:opacity-30 transition" disabled>
                <i class="fas fa-chevron-left text-[10px]"></i>
            </button>
            <span id="li-profile-counter" class="flex-1 text-center text-[11px] font-bold text-slate-500">1 / ${profiles.length}</span>
            <button id="li-profile-next" onclick="navigateProfile(1)" class="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 disabled:opacity-30 transition" ${profiles.length <= 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-right text-[10px]"></i>
            </button>
        </div>
        <div id="li-profile-slot"></div>`
        : '<div class="text-[10px] text-slate-300 italic">프로필 없음</div>';

    loginInfoBody.innerHTML =
        _mkSec('acc', 'fas fa-user text-blue-500', 'Account', accSection, true) +
        _mkSec('lic', 'fas fa-id-card text-orange-500', 'License', licenseSection, false) +
        _mkSec('sch', 'fas fa-school text-green-500', 'School / Class', schoolSection, false) +
        _mkSec('pro', 'fas fa-users text-purple-500', `Profiles (${profiles.length}개)`, profileCarouselHtml, true);

    loginInfoSection.classList.remove('hidden');

    window._liProfileCards = profileCardArr;
    const mainProfileIdx = profiles.findIndex(p => p.profileId === mainProfileId);
    window._liProfileIdx = 0;
    if (profiles.length > 0) {
        _renderProfileCard(mainProfileIdx >= 0 ? mainProfileIdx : 0);
    }
}

/**
 * 로그인 정보 패널만 독립적으로 여는 함수 (상세 모달 없이)
 * @param {string} logId - 로그 ID
 */
async function openLoginInfoPanel(logId) {
    const log = await findLogById(logId);
    if (!log || !log.login_info) {
        showToast('로그인 정보가 없습니다.', 'error');
        return;
    }
    populateLoginInfoPanel(log.login_info);
}

/** 모달 비즈니스 로직 **/
async function openDetailModal(logId) {
    const log = await findLogById(logId); 
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

    // 로그인 정보 표시
    populateLoginInfoPanel(log.login_info);

    // 개발자 코멘트 표시
    const devCommentSection = document.getElementById('modal-dev-comment-section');
    const modalDevComment = document.getElementById('modal-dev-comment');
    if (log.developer_comment) {
        modalDevComment.innerText = getDisplayDevComment(log);
        devCommentSection.classList.remove('hidden');
    } else {
        devCommentSection.classList.add('hidden');
    }

    // 수정 확인 가능 여부 배지 (컨테이너가 없으면 코멘트 아래에 동적 생성)
    let fixBadgeEl = document.getElementById('modal-fix-verify-badge');
    if (!fixBadgeEl) {
        fixBadgeEl = document.createElement('div');
        fixBadgeEl.id = 'modal-fix-verify-badge';
        modalDevComment.insertAdjacentElement('afterend', fixBadgeEl);
    }
    fixBadgeEl.innerHTML = getFixVerifyBadge(log);

    // 상태별 액션 버튼 생성
    const actionButtonsContainer = document.getElementById('modal-action-buttons');
    const currentState = (log.state || log.status || '').trim();
    let actionButtonsHtml = '';

    if (currentState === '수정 필요') {
        actionButtonsHtml = `<button onclick="openDevProcessModal('${log.id}', '수정 필요')" class="bg-indigo-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-indigo-700 transition text-sm shadow-md"><i class="fas fa-check-circle mr-1"></i>상태 변경</button>`;
    } else if (currentState === '서버 수정 요청') {
        actionButtonsHtml = `<button onclick="closeModal('detailModal'); openDevProcessModal('${log.id}', '서버 수정 요청')" class="bg-teal-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-teal-700 transition text-sm shadow-md"><i class="fas fa-server mr-1"></i>서버 수정 완료</button>`;
    } else if (currentState === '수정 완료') {
        actionButtonsHtml = `
            <button onclick="directUpdateStateFromModal('${log.id}', '수정 확인')" class="bg-green-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-green-700 transition text-sm shadow-md"><i class="fas fa-check-double mr-1"></i>수정 확인</button>
            <button onclick="openReRequestModal('${log.id}')" class="bg-orange-500 text-white px-5 py-2 rounded-xl font-bold hover:bg-orange-600 transition text-sm shadow-md"><i class="fas fa-exclamation-triangle mr-1"></i>재수정요청</button>
        `;
    } else if (currentState === '보류/패스' || currentState === '수정 확인') {
        actionButtonsHtml = `<button onclick="openReRequestModal('${log.id}')" class="bg-orange-500 text-white px-5 py-2 rounded-xl font-bold hover:bg-orange-600 transition text-sm shadow-md"><i class="fas fa-exclamation-triangle mr-1"></i>재수정요청</button>`;
    } else if (currentState === '서버 수정 완료') {
        actionButtonsHtml = `
            <button onclick="directUpdateStateFromModal('${log.id}', '수정 완료')" class="bg-blue-600 text-white px-5 py-2 rounded-xl font-bold hover:bg-blue-700 transition text-sm shadow-md"><i class="fas fa-check mr-1"></i>수정 완료</button>
            <button onclick="directUpdateStateFromModal('${log.id}', '서버 수정 요청')" class="bg-purple-500 text-white px-5 py-2 rounded-xl font-bold hover:bg-purple-600 transition text-sm shadow-md"><i class="fas fa-server mr-1"></i>서버 수정 요청</button>
        `;
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
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('detailModal');
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogsCount(true); // 카운트 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
}

function toggleLogDetail(index) {
    const extra = document.getElementById(`extra-${index}`);
    const icon = document.getElementById(`icon-${index}`);
    const isHidden = extra.classList.contains('hidden');
    extra.classList.toggle('hidden');
    icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

async function openEditDescModal(logId) {
    const log = await findLogById(logId); if (!log) return;
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
    if (error) { 
        alert('실패: ' + error.message); 
    } else { 
        showToast('수정되었습니다.'); 
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('editDescModal'); 
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
}

async function directUpdateState(id, s) {
    const { error } = await supabaseClient.from('qa_logs').update({ state: s }).eq('id', id);
    if (error) { 
        alert('실패: ' + error.message); 
    } else { 
        showToast(`[${s}] 상태로 변경되었습니다.`); 
        await invalidateLogsCache(); // 캐시 무효화
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogsCount(true); // 카운트 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
}

async function openReRequestModal(logId) {
    const log = await findLogById(logId);
    if (!log) return;
    document.getElementById('request-log-id').value = logId; document.getElementById('request-text').value = ''; 
    document.getElementById('request-existing-desc').innerText = log.user_description || '-'; document.getElementById('request-existing-comment').innerText = getDisplayDevComment(log) || '-';
    openModal('requestModal');
}

async function submitReRequest() {
    const id = document.getElementById('request-log-id').value; const t = document.getElementById('request-text').value.trim();
    if (!t) return alert('내용을 입력해주세요.');
    const log = await findLogById(id);
    if (!log) return alert('로그를 찾을 수 없습니다.');
    const { error } = await supabaseClient.from('qa_logs').update({ state: '수정 필요', user_description: `${log.user_description || ''}\n\n[재수정 요청] ${t}` }).eq('id', id);
    if (error) { 
        alert('실패: ' + error.message); 
    } else { 
        showToast('재수정 요청이 완료되었습니다.'); 
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('requestModal'); 
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogsCount(true); // 카운트 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
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
    if (error) { 
        alert('실패: ' + error.message); 
    } else { 
        showToast('삭제되었습니다.'); 
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('deleteModal'); 
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogsCount(true); // 카운트 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
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
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('writeModal');
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogsCount(true); // 카운트 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    } catch (e) { showToast('실패: ' + e.message, 'error'); } finally { btn.innerText = '등록하기'; btn.disabled = false; }
}

async function checkSimilarIssues(text) {
    const listContainer = document.getElementById('similar-list');
    if (!text || text.trim().length < 5) {
        listContainer.innerHTML = '<p class="text-xs text-slate-400 italic text-center py-10">내용을 좀 더 입력해 주세요.</p>';
        return;
    }

    // 서버에서 검색 (ilike 사용)
    const searchTerm = `%${text.trim()}%`;
    const { data: matches, error } = await supabaseClient
        .from('qa_logs')
        .select('id,user_name,state,user_description,created_at')
        .not('is_delete', 'eq', true)
        .ilike('user_description', searchTerm)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error || !matches || matches.length === 0) {
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

async function openImageViewerModal(logId) {
    const log = await findLogById(logId); if (!log || !log.image_url) return;
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
        showToast('이미지가 처리되었습니다.'); 
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('addEditImageModal');
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    } catch (e) { alert('작업 실패: ' + e.message); } finally { btn.innerText = '이미지 저장'; btn.disabled = false; }
}

async function openDevProcessModal(logId, fromState = '수정 필요') {
    const log = await findLogById(logId); if (!log) return;
    document.getElementById('dev-process-log-id').value = logId;
    document.getElementById('dev-comment-text').value = log.developer_comment || '';

    // 상태에 따라 버튼 동적 표시
    const btnArea = document.getElementById('dev-process-action-btns');
    if (btnArea) {
        if (fromState === '서버 수정 요청') {
            btnArea.innerHTML = `
                <button onclick="submitDevProcess('서버 수정 완료')" class="bg-teal-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-teal-700 transition text-sm shadow-md">서버 수정 완료</button>
            `;
        } else {
            btnArea.innerHTML = `
                <button onclick="submitDevProcess('보류/패스')" class="bg-gray-500 text-white px-4 py-2 rounded-xl font-bold hover:bg-gray-600 transition text-sm">보류/패스</button>
                <button onclick="submitDevProcess('서버 수정 요청')" class="bg-purple-500 text-white px-4 py-2 rounded-xl font-bold hover:bg-purple-600 transition text-sm">서버 수정 요청</button>
                <button onclick="submitDevProcess('수정 완료')" class="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-700 transition text-sm shadow-md shadow-blue-100">수정 완료</button>
            `;
        }
    }

    openModal('devProcessModal');
}

async function submitDevProcess(targetState) {
    const id = document.getElementById('dev-process-log-id').value;
    const comment = document.getElementById('dev-comment-text').value.trim();

    // 코멘트가 비어있으면 상태값을 기본 코멘트로 사용
    let finalComment = comment || targetState;

    // 수정완료, 보류/패스, 서버 수정 요청 상태인 경우 bundleCode 추가
    if ((targetState === '수정 완료' || targetState === '보류/패스' || targetState === '서버 수정 요청') && currentBundleCode) {
        if (!comment) {
            // 코멘트가 비어있으면 기본 메시지 + 번들 코드
            finalComment = `${targetState} (${currentBundleCode})`;
        } else {
            // 코멘트가 있으면 코멘트 뒤에 번들 코드 추가
            finalComment = `${comment} (${currentBundleCode})`;
        }
    }

    const { error } = await supabaseClient.from('qa_logs').update({ state: targetState, developer_comment: finalComment, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { 
        alert('실패: ' + error.message); 
    } else { 
        showToast(`[${targetState}] 처리가 완료되었습니다.`); 
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('devProcessModal'); 
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogsCount(true); // 카운트 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
}

async function openDevCommentEditModal(logId) {
    const log = await findLogById(logId); 
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
        await invalidateLogsCache(); // 캐시 무효화
        closeModal('editDevCommentModal');
        await fetchSummaryData(true); // 요약 데이터 갱신
        await fetchLogs(true); // 현재 페이지 갱신
    }
}

/** 검수 계정 관리 함수 **/
function openAddAccountModal() {
    document.getElementById('account-login-id').value = '';
    openModal('addAccountModal');
}

async function submitAddAccount() {
    const loginId = document.getElementById('account-login-id').value.trim();

    if (!loginId) {
        showToast('로그인 ID를 입력해주세요.', 'error');
        return;
    }

    const btn = document.getElementById('account-submit-btn');
    btn.innerText = '등록 중...';
    btn.disabled = true;

    const { error } = await supabaseClient
        .from('qa_accounts')
        .insert([{ login_id: loginId }]);

    btn.innerText = '등록하기';
    btn.disabled = false;

    if (error) {
        showToast('등록 실패: ' + error.message, 'error');
    } else {
        showToast('계정이 등록되었습니다.');
        closeModal('addAccountModal');
        fetchAccounts();
    }
}

async function deleteAccount(id) {
    if (!confirm('이 계정을 삭제하시겠습니까?')) return;

    const { error } = await supabaseClient
        .from('qa_accounts')
        .delete()
        .eq('id', id);

    if (error) {
        showToast('삭제 실패: ' + error.message, 'error');
    } else {
        showToast('계정이 삭제되었습니다.');
        fetchAccounts();
    }
}

async function fetchAccounts() {
    const tbody = document.getElementById('accountTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400"><i class="fas fa-spinner fa-spin mr-2"></i>불러오는 중...</td></tr>';

    const { data, error } = await supabaseClient
        .from('qa_accounts')
        .select('id,created_at,login_id')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-red-500">실패: ${error.message}</td></tr>`;
        return;
    }

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">등록된 계정이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = data.map((acc, idx) => `
        <tr class="hover:bg-blue-50/20 transition">
            <td class="px-6 py-4 text-center text-xs text-slate-400 font-mono">${idx + 1}</td>
            <td class="px-6 py-4 font-bold text-slate-700">${acc.login_id}</td>
            <td class="px-6 py-4 text-center text-xs text-slate-500">${formatKST(acc.created_at)}</td>
            <td class="px-6 py-4 text-center">
                <button onclick="deleteAccount('${acc.id}')" class="text-red-400 hover:text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition">
                    <i class="fas fa-trash-alt mr-1"></i>삭제
                </button>
            </td>
        </tr>
    `).join('');
}

/** 홈 - QA 인원 상태 함수 **/
function openAddQaMemberModal() {
    document.getElementById('qa-member-name').value = '';
    openModal('addQaMemberModal');
}

async function submitAddQaMember() {
    const qaName = document.getElementById('qa-member-name').value.trim();

    if (!qaName) {
        showToast('이름을 입력해주세요.', 'error');
        return;
    }

    const btn = document.getElementById('qa-member-submit-btn');
    btn.innerText = '등록 중...';
    btn.disabled = true;

    const { error } = await supabaseClient
        .from('qa_members')
        .insert([{ qa_name: qaName, on_qa: false }]);

    btn.innerText = '등록하기';
    btn.disabled = false;

    if (error) {
        showToast('등록 실패: ' + error.message, 'error');
    } else {
        showToast('QA 인원이 등록되었습니다.');
        closeModal('addQaMemberModal');
        fetchQaMembers();
    }
}

async function fetchQaMembers() {
    const list = document.getElementById('qaMemberList');
    if (!list) return;

    list.innerHTML = '<p class="col-span-full text-center py-6 text-gray-400 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>불러오는 중...</p>';

    const { data, error } = await supabaseClient
        .from('qa_members')
        .select('id,qa_name,on_qa')
        .order('qa_name', { ascending: true });

    if (error) {
        list.innerHTML = `<p class="col-span-full text-center py-6 text-red-500 text-sm">실패: ${error.message}</p>`;
        return;
    }

    if (!data || data.length === 0) {
        list.innerHTML = '<p class="col-span-full text-center py-6 text-gray-400 text-sm">등록된 인원이 없습니다.</p>';
        return;
    }

    list.innerHTML = data.map(m => `
        <div class="flex items-center justify-between gap-2 p-3 rounded-lg border ${m.on_qa ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-200'}">
            <span class="font-bold text-sm text-slate-700 truncate">${m.qa_name}</span>
            <button onclick="toggleQaMember('${m.id}', ${m.on_qa})" class="shrink-0 px-3 py-1 rounded-full text-xs font-bold transition ${m.on_qa ? 'bg-green-500 text-white hover:bg-green-600' : 'bg-gray-300 text-gray-600 hover:bg-gray-400'}">
                ${m.on_qa ? 'On' : 'Off'}
            </button>
        </div>
    `).join('');
}

async function toggleQaMember(id, currentOn) {
    const nextOn = !currentOn;

    const { error } = await supabaseClient
        .from('qa_members')
        .update({ on_qa: nextOn })
        .eq('id', id);

    if (error) {
        showToast('상태 변경 실패: ' + error.message, 'error');
    } else {
        fetchQaMembers();
    }
}

// 초기 실행
window.onload = async () => {
    // 캐시 매니저 초기화 완료 대기
    if (typeof cacheManagerReady !== 'undefined') {
        await cacheManagerReady;
        console.log('✓ 캐시 매니저 준비 완료');
    }

    showSection('home'); 
    await fetchQAInformation();

    // 첫 로드 시 Summary 데이터는 강제로 새로고침 (1000개 제한 문제 방지)
    // URL에 ?refresh 파라미터가 있거나, 로컬스토리지에 마지막 로드 시간이 1시간 이상 지났으면 강제 새로고침
    const urlParams = new URLSearchParams(window.location.search);
    const forceRefresh = urlParams.has('refresh');
    const lastLoadTime = localStorage.getItem('last_summary_load_time');
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const shouldForceRefresh = forceRefresh || !lastLoadTime || parseInt(lastLoadTime) < oneHourAgo;

    if (shouldForceRefresh) {
        console.log('🔄 Summary 데이터 강제 갱신 (첫 로드 또는 1시간 경과)');
        await fetchSummaryData(true); // 강제 새로고침
        localStorage.setItem('last_summary_load_time', Date.now().toString());
    } else {
        await fetchSummaryData(); // 캐시 사용
    }

    await fetchLogsCount(); // 총 개수 로드
    await fetchLogs(); // 첫 페이지 로드

    // 로그인 정보 패널 드래그 이동
    initLoginInfoPanelDrag();

    // 마스터 데이터 백그라운드 프리로드 (아바타 아이템 미리보기 등에 활용)
    loadMasterData('ko').catch(e => console.warn('마스터 데이터 프리로드 실패:', e));
    // 국가 마스터 데이터 프리로드 (스테이지 정보 모달 활용)
    loadCountryMasterData('KR').catch(e => console.warn('국가 마스터 데이터 프리로드 실패:', e));
};

function showAvatarItemPreview(event, src, candidatesJson) {
    let preview = document.getElementById('avatar-item-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'avatar-item-preview';
        preview.className = 'fixed pointer-events-none bg-white border border-slate-200 rounded-xl shadow-2xl p-2';
        preview.style.zIndex = '2147483647';
        preview.innerHTML = '<img class="w-32 h-32 object-contain" />';
        document.body.appendChild(preview);
    }
    const img = preview.querySelector('img');
    // 전체 후보 배열 사용 (전달된 경우), 없으면 _Icon/_icon 양방향만
    let candidates;
    if (candidatesJson) {
        try { candidates = JSON.parse(candidatesJson.replace(/&quot;/g, '"')); } catch(e) { candidates = null; }
    }
    if (!candidates || !candidates.length) {
        candidates = [src];
        if (src.includes('_Icon.png')) candidates.push(src.replace('_Icon.png', '_icon.png'));
        else if (src.includes('_icon.png')) candidates.push(src.replace('_icon.png', '_Icon.png'));
    }
    img.dataset.c = JSON.stringify(candidates);
    img.dataset.ci = '0';
    img.onerror = function() {
        const ci = +this.dataset.ci + 1;
        const ca = JSON.parse(this.dataset.c);
        this.dataset.ci = ci;
        if (ci < ca.length) this.src = ca[ci];
    };
    img.src = src;
    const rect = event.target.getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top;
    if (left + 150 > window.innerWidth) left = rect.left - 150 - 8;
    if (top + 150 > window.innerHeight) top = window.innerHeight - 160;
    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
    preview.classList.remove('hidden');
}

function hideAvatarItemPreview() {
    const p = document.getElementById('avatar-item-preview');
    if (p) p.classList.add('hidden');
}

function toggleLoginInfoPanel() {
    const panel = document.getElementById('modal-login-info-section');
    if (!panel) return;
    panel.classList.toggle('hidden');
}

function initLoginInfoPanelDrag() {
    const panel = document.getElementById('modal-login-info-section');
    const handle = document.getElementById('login-info-drag-handle');
    if (!panel || !handle) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', (e) => {
        // transform을 제거하고 실제 좌표로 고정
        const rect = panel.getBoundingClientRect();
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.transform = 'none';

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // 화면 경계 제한
        const panelW = panel.offsetWidth;
        const panelH = panel.offsetHeight;
        newLeft = Math.max(0, Math.min(window.innerWidth - panelW, newLeft));
        newTop = Math.max(0, Math.min(window.innerHeight - panelH, newTop));

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

/** 마스터 데이터 **/
let currentMasterLang = 'ko';
let masterDataCache = {}; // { ko: data, en: data }
let currentMdTab = 'translation';
let mdAllRows = []; // 현재 탭의 전체 행 데이터

let currentMasterMode = 'language'; // 'language' | 'country'
let currentCountryCode = 'KR';
let countryDataCache = {}; // { KR: data, EN: data, JP: data }
let currentCountryTab = '';
let countryMdAllRows = [];

const MD_PAGE_SIZE = 200;
let mdCurrentPage = 1;
let mdFilteredRows = [];
let mdCurrentColumns = [];
let mdInputSortDir = null; // null | 'asc' | 'desc'

let countryMdCurrentPage = 1;
let countryMdFilteredRows = [];
let countryMdCurrentColumns = [];

function toggleMdInputSort() {
    if (mdInputSortDir === null || mdInputSortDir === 'desc') {
        mdInputSortDir = 'asc';
    } else {
        mdInputSortDir = 'desc';
    }
    mdCurrentPage = 1;
    _renderMdTableBody(mdFilteredRows, mdCurrentColumns);
}

function changeMdPage(page) {
    mdCurrentPage = page;
    _renderMdTableBody(mdFilteredRows, mdCurrentColumns);
}

function changeCountryMdPage(page) {
    countryMdCurrentPage = page;
    _renderCountryTableBody(countryMdFilteredRows, countryMdCurrentColumns);
}

function _buildMdPagination(containerId, total, currentPage, pageSize, changeFn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (total <= pageSize) return;
    const totalPages = Math.ceil(total / pageSize);
    const prevDis = currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100';
    container.innerHTML += `<button onclick="${changeFn}(${currentPage - 1})" class="px-3 py-1 rounded border border-gray-200 text-slate-600 text-xs font-bold ${prevDis}" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
    const maxV = 10;
    const group = Math.ceil(currentPage / maxV);
    const startP = (group - 1) * maxV + 1;
    const endP = Math.min(startP + maxV - 1, totalPages);
    if (startP > 1) {
        container.innerHTML += `<button onclick="${changeFn}(1)" class="px-3 py-1 rounded border bg-white text-slate-600 border-gray-200 hover:bg-slate-50 text-xs font-bold transition">1</button>`;
        if (startP > 2) container.innerHTML += `<span class="px-2 py-1 text-slate-400">...</span>`;
    }
    for (let i = startP; i <= endP; i++) {
        const ac = i === currentPage ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-gray-200 hover:bg-slate-50';
        container.innerHTML += `<button onclick="${changeFn}(${i})" class="px-3 py-1 rounded border text-xs font-bold transition ${ac}">${i}</button>`;
    }
    if (endP < totalPages) {
        if (endP < totalPages - 1) container.innerHTML += `<span class="px-2 py-1 text-slate-400">...</span>`;
        container.innerHTML += `<button onclick="${changeFn}(${totalPages})" class="px-3 py-1 rounded border bg-white text-slate-600 border-gray-200 hover:bg-slate-50 text-xs font-bold transition">${totalPages}</button>`;
    }
    const nextDis = currentPage === totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100';
    container.innerHTML += `<button onclick="${changeFn}(${currentPage + 1})" class="px-3 py-1 rounded border border-gray-200 text-slate-600 text-xs font-bold ${nextDis}" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
}

const MASTER_API_BASE_DEV  = 'https://dev-v3-api.1promath.com';
const MASTER_API_BASE_PROD = 'https://v3-api.1promath.com';
function getMasterApiBase() {
    return currentServerInfo === 'prod' ? MASTER_API_BASE_PROD : MASTER_API_BASE_DEV;
}

function isLocalEnvironment() {
    return window.location.protocol === 'file:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1';
}

async function loadMasterData(lang = 'ko', forceRefresh = false) {
    currentMasterLang = lang;

    // 언어 버튼 active 상태
    document.querySelectorAll('.md-lang-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`md-lang-${lang}`);
    if (activeBtn) activeBtn.classList.add('active');

    // 캐시 확인
    if (!forceRefresh && masterDataCache[lang]) {
        renderMasterDataUI(masterDataCache[lang]);
        return;
    }

    // 로딩 표시
    document.getElementById('md-loading').classList.remove('hidden');
    document.getElementById('md-content').classList.add('hidden');
    document.getElementById('md-version-bar').classList.add('hidden');

    try {
        let payload;

        if (isLocalEnvironment()) {
            console.log(`[로컬] MasterData 로컬 파일들에서 조립 로드 (lang: ${lang})`);
            const fetchJson = async (path) => {
                const r = await fetch(path);
                if (!r.ok) { console.warn(`[로컬] 파일 없음: ${path}`); return null; }
                return r.json();
            };
            const [translation, stage, avatar, badword, conceptnote, inappproduct, reward, title, video] = await Promise.all([
                fetchJson(`MasterData/${lang}/TranslationMasterData.json`),
                fetchJson(`MasterData/StageMasterData.json`),
                fetchJson(`MasterData/FriendsAvatarMasterData.json`),
                fetchJson(`MasterData/BadWordMasterData.json`),
                fetchJson(`MasterData/ConceptNoteMasterData.json`),
                fetchJson(`MasterData/InAppProductMasterData.json`),
                fetchJson(`MasterData/RewardMasterData.json`),
                fetchJson(`MasterData/TitleMasterData.json`),
                fetchJson(`MasterData/VideoMasterData.json`),
            ]);
            payload = {
                masterData: {
                    translationMasterData: translation,
                    stageMasterData: stage,
                    friendsAvatarMasterData: avatar,
                    badWordMasterData: badword,
                    conceptNoteMasterData: conceptnote,
                    inAppProductMasterData: inappproduct,
                    rewardMasterData: reward,
                    titleMasterData: title,
                    videoMasterData: video,
                },
                appConfig: null
            };
        } else {
            const now = new Date();
            const offsetMin = -now.getTimezoneOffset(); // UTC+9 → 540
            const sign = offsetMin >= 0 ? '+' : '-';
            const absMin = Math.abs(offsetMin);
            const pad2 = n => String(n).padStart(2, '0');
            const offsetStr = offsetMin === 0
                ? '+00:00'
                : `${sign}${pad2(Math.floor(absMin / 60))}:${pad2(absMin % 60)}`;
            const clientDatetime = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}` +
                `T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${offsetStr}`;

            const timezoneIdentifier = Intl.DateTimeFormat().resolvedOptions().timeZone;

            const res = await fetch(`${getMasterApiBase()}/api/v3/app-init/language-codes/${lang}`, {
                headers: {
                    'Client-Datetime': clientDatetime,
                    'Timezone-Identifier': timezoneIdentifier,
                    'App-Version': '3.0.0',
                    'Platform': 'android'
                }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || `HTTP ${res.status}`);
            }

            const json = await res.json();
            payload = { masterData: json.data.masterData, appConfig: json.data.appConfig };
        }

        masterDataCache[lang] = payload;
        renderMasterDataUI(payload);
    } catch (e) {
        document.getElementById('md-loading').classList.add('hidden');
        showToast('마스터 데이터 로드 실패: ' + e.message, 'error');
    }
}

function refreshMasterData() {
    if (currentMasterMode === 'language') {
        loadMasterData(currentMasterLang, true);
    } else {
        loadCountryMasterData(currentCountryCode, true);
    }
}

function switchMasterMode(mode) {
    currentMasterMode = mode;
    const langGroup = document.getElementById('md-lang-btn-group');
    const countryGroup = document.getElementById('md-country-btn-group');
    const langContent = document.getElementById('md-content');
    const countryContent = document.getElementById('md-country-content');
    const versionBar = document.getElementById('md-version-bar');
    const loading = document.getElementById('md-loading');

    document.getElementById('md-mode-language').classList.toggle('active', mode === 'language');
    document.getElementById('md-mode-country').classList.toggle('active', mode === 'country');

    if (mode === 'language') {
        langGroup.classList.remove('hidden');
        countryGroup.classList.add('hidden');
        countryContent.classList.add('hidden');
        loading.classList.add('hidden');
        // 기존 언어 데이터가 캐시에 있으면 바로 표시
        if (masterDataCache[currentMasterLang]) {
            langContent.classList.remove('hidden');
            versionBar.classList.remove('hidden');
        } else {
            langContent.classList.add('hidden');
        }
    } else {
        langGroup.classList.add('hidden');
        countryGroup.classList.remove('hidden');
        langContent.classList.add('hidden');
        versionBar.classList.add('hidden');
        loading.classList.add('hidden');
        // 기존 국가 데이터가 캐시에 있으면 바로 표시
        if (countryDataCache[currentCountryCode]) {
            countryContent.classList.remove('hidden');
        } else {
            countryContent.classList.add('hidden');
            loadCountryMasterData(currentCountryCode);
        }
    }
}

async function loadCountryMasterData(countryCode = 'KR', forceRefresh = false) {
    currentCountryCode = countryCode;

    document.querySelectorAll('#md-country-btn-group .md-lang-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`md-country-${countryCode}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (!forceRefresh && countryDataCache[countryCode]) {
        renderCountryDataUI(countryDataCache[countryCode]);
        return;
    }

    document.getElementById('md-loading').classList.remove('hidden');
    document.getElementById('md-country-content').classList.add('hidden');
    document.getElementById('md-version-bar').classList.add('hidden');

    try {
        let payload;

        if (isLocalEnvironment()) {
            console.log(`[로컬] MasterData 국가 파일들에서 조립 로드 (country: ${countryCode})`);
            const fetchJson = async (path) => {
                const r = await fetch(path);
                if (!r.ok) { console.warn(`[로컬] 파일 없음: ${path}`); return null; }
                return r.json();
            };
            const [curriculum, levelTest] = await Promise.all([
                fetchJson(`MasterData/${countryCode}/CurriculumMasterData.json`),
                fetchJson(`MasterData/${countryCode}/LevelTestMasterData.json`),
            ]);
            payload = {
                nationalCurriculumMasterData: curriculum,
                nationalLevelTestCurriculumData: levelTest,
            };
        } else {
            const now = new Date();
            const offsetMin = -now.getTimezoneOffset();
            const sign = offsetMin >= 0 ? '+' : '-';
            const absMin = Math.abs(offsetMin);
            const pad2 = n => String(n).padStart(2, '0');
            const offsetStr = offsetMin === 0
                ? '+00:00'
                : `${sign}${pad2(Math.floor(absMin / 60))}:${pad2(absMin % 60)}`;
            const clientDatetime = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}` +
                `T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}${offsetStr}`;
            const timezoneIdentifier = Intl.DateTimeFormat().resolvedOptions().timeZone;

            const res = await fetch(`${getMasterApiBase()}/api/v3/app-init/master-data/country-codes/${countryCode}`, {
                headers: {
                    'Client-Datetime': clientDatetime,
                    'Timezone-Identifier': timezoneIdentifier,
                    'App-Version': '3.0.0',
                    'Platform': 'android'
                }
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.message || `HTTP ${res.status}`);
            }

            const json = await res.json();
            payload = json.data;
        }

        countryDataCache[countryCode] = payload;
        renderCountryDataUI(payload);
    } catch (e) {
        document.getElementById('md-loading').classList.add('hidden');
        showToast('국가 코드 데이터 로드 실패: ' + e.message, 'error');
    }
}

function renderCountryDataUI(payload) {
    document.getElementById('md-loading').classList.add('hidden');

    const curriculum = payload.nationalCurriculumMasterData ?? {};
    const levelTest  = payload.nationalLevelTestCurriculumData ?? {};

    // 버전 바
    const versionBar = document.getElementById('md-version-bar');
    const parts = [];
    if (curriculum.masterDataVersion !== undefined)
        parts.push(`<span class="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px]"><span class="font-bold text-slate-600">국가커리큘럼</span> v${curriculum.masterDataVersion}</span>`);
    if (levelTest.masterDataVersion !== undefined)
        parts.push(`<span class="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px]"><span class="font-bold text-slate-600">레벨테스트</span> v${levelTest.masterDataVersion}</span>`);
    const countryCode = curriculum.countryCode ?? levelTest.countryCode ?? currentCountryCode;
    versionBar.innerHTML = `<i class="fas fa-tag text-slate-400"></i><span class="font-bold text-slate-600">버전</span>${parts.join('')}<span class="ml-auto text-slate-400">Country: <span class="font-mono font-bold text-slate-600">${countryCode}</span></span>`;
    versionBar.classList.remove('hidden');

    // 탭 버튼 생성
    const tabsContainer = document.getElementById('md-country-tabs');
    tabsContainer.innerHTML = '';
    const tabOrder = Object.keys(COUNTRY_TAB_CONFIG);
    tabOrder.forEach((key, idx) => {
        const cfg = COUNTRY_TAB_CONFIG[key];
        const rows = cfg.getData(payload);
        const btn = document.createElement('button');
        btn.className = 'md-tab-btn' + (idx === 0 ? ' active' : '');
        btn.id = `md-country-tab-${key}`;
        btn.innerHTML = `${cfg.label} <span class="md-tab-count">${rows.length.toLocaleString()}</span>`;
        btn.onclick = () => showCountryMdTab(key);
        tabsContainer.appendChild(btn);
    });

    document.getElementById('md-country-search').value = '';
    document.getElementById('md-country-content').classList.remove('hidden');
    showCountryMdTab(tabOrder[0]);
}

function _renderIdList(ids, colorCls = 'bg-indigo-50 text-indigo-700') {
    if (!ids || ids.length === 0) return '<span class="text-slate-300 text-xs">-</span>';
    return `<div class="flex flex-wrap gap-0.5 justify-center">${ids.map(id =>
        `<span class="inline-block px-1 py-0.5 rounded text-[10px] font-mono font-bold ${colorCls}">${id}</span>`
    ).join('')}</div>`;
}

const COUNTRY_TAB_CONFIG = {
    supremeChapter: {
        label: '대단원',
        getData: p => {
            const chapters = p.nationalCurriculumMasterData?.nationalChapters ?? [];
            const stages   = p.nationalCurriculumMasterData?.nationalStages ?? [];
            return (p.nationalCurriculumMasterData?.nationalSupremeChapters ?? []).map(sc => {
                const myChapters = chapters.filter(c => c.nationalSupremeChapterId === sc.nationalSupremeChapterId);
                const myChapterIds = new Set(myChapters.map(c => c.nationalChapterId));
                const myStages = stages.filter(s => myChapterIds.has(s.nationalChapterId));
                return { ...sc, _chapters: myChapters, _stages: myStages };
            });
        },
        columns: [
            { label: 'ID',        key: 'nationalSupremeChapterId', cls: 'text-center font-mono text-xs font-bold text-indigo-700' },
            { label: '레벨',      key: 'level',                    cls: 'text-center font-bold' },
            { label: '순서',      key: 'sequence',                 cls: 'text-center' },
            { label: '소단원 수', key: row => `<span class="font-bold text-blue-600">${row._chapters.length}</span>`, cls: 'text-center' },
            { label: '소단원 목록', key: row => _renderIdList(row._chapters.map(c => c.nationalChapterId), 'bg-blue-50 text-blue-700'), cls: 'text-center' },
            { label: '스테이지 수', key: row => `<span class="font-bold text-emerald-600">${row._stages.length}</span>`, cls: 'text-center' },
            { label: '스테이지 목록', key: row => _renderIdList(row._stages.map(s => s.nationalStageId), 'bg-emerald-50 text-emerald-700'), cls: 'text-center' },
            { label: 'Translation Key', key: row => row.translation?.translationKey ?? '-', cls: 'text-center font-mono text-xs text-slate-500 break-all' },
        ]
    },
    chapter: {
        label: '소단원',
        getData: p => {
            const supremeChapters = p.nationalCurriculumMasterData?.nationalSupremeChapters ?? [];
            const stages          = p.nationalCurriculumMasterData?.nationalStages ?? [];
            const scMap = Object.fromEntries(supremeChapters.map(sc => [sc.nationalSupremeChapterId, sc]));
            return (p.nationalCurriculumMasterData?.nationalChapters ?? []).map(c => {
                const parent   = scMap[c.nationalSupremeChapterId] ?? null;
                const myStages = stages.filter(s => s.nationalChapterId === c.nationalChapterId);
                return { ...c, _parent: parent, _stages: myStages };
            });
        },
        columns: [
            { label: '소단원 ID', key: 'nationalChapterId',        cls: 'text-center font-mono text-xs font-bold text-indigo-700' },
            { label: '레벨',      key: row => row._parent?.level ?? '-', cls: 'text-center font-bold text-purple-600' },
            { label: '대단원 ID', key: 'nationalSupremeChapterId', cls: 'text-center font-mono text-xs' },
            { label: '대단원 명', key: row => row._parent?.translation?.translationKey ?? '-', cls: 'text-center text-xs text-slate-500' },
            { label: '순서',      key: 'sequence',                 cls: 'text-center' },
            { label: '스테이지 수', key: row => `<span class="font-bold text-emerald-600">${row._stages.length}</span>`, cls: 'text-center' },
            { label: '스테이지 목록', key: row => _renderIdList(row._stages.map(s => s.nationalStageId), 'bg-emerald-50 text-emerald-700'), cls: 'text-center' },
            { label: 'Translation Key', key: row => row.translation?.translationKey ?? '-', cls: 'text-center font-mono text-xs text-slate-500 break-all' },
        ]
    },
    stage: {
        label: '스테이지',
        getData: p => {
            const supremeChapters = p.nationalCurriculumMasterData?.nationalSupremeChapters ?? [];
            const chapters        = p.nationalCurriculumMasterData?.nationalChapters ?? [];
            const scMap = Object.fromEntries(supremeChapters.map(sc => [sc.nationalSupremeChapterId, sc]));
            const cMap  = Object.fromEntries(chapters.map(c => [c.nationalChapterId, c]));
            return (p.nationalCurriculumMasterData?.nationalStages ?? []).map(s => {
                const chapter      = cMap[s.nationalChapterId] ?? null;
                const supremeChap  = chapter ? (scMap[chapter.nationalSupremeChapterId] ?? null) : null;
                return { ...s, _chapter: chapter, _supremeChapter: supremeChap };
            });
        },
        columns: [
            { label: '국가스테이지 ID', key: 'nationalStageId',   cls: 'text-center font-mono text-xs font-bold text-indigo-700' },
            { label: '레벨',            key: row => row._supremeChapter?.level ?? '-', cls: 'text-center font-bold text-purple-600' },
            { label: '대단원 ID',       key: row => row._supremeChapter?.nationalSupremeChapterId ?? '-', cls: 'text-center font-mono text-xs' },
            { label: '소단원 ID',       key: 'nationalChapterId', cls: 'text-center font-mono text-xs' },
            { label: '순서',            key: 'sequence',          cls: 'text-center' },
            { label: '스테이지 ID',     key: 'stageId',           cls: 'text-center font-mono text-xs text-blue-600' },
            { label: 'Translation Key', key: row => row.translation?.translationKey ?? '-', cls: 'text-center font-mono text-xs text-slate-500 break-all' },
        ]
    },
    levelTest: {
        label: '레벨테스트',
        getData: p => p.nationalLevelTestCurriculumData?.levelTestCurriculums ?? [],
        columns: [
            { label: '소단원 ID',  key: 'nationalChapterId', cls: 'text-center font-mono text-xs font-bold text-indigo-700' },
            { label: 'Logic ID',   key: 'logicId',           cls: 'text-center font-mono text-center text-xs ' },
            { label: '정확도',     key: 'accuracy',          cls: 'text-center text-xs' },
            { label: 'Prefab ID', key: 'prefabId', cls: 'text-center font-mono text-center text-xs' },
            { label: '등급 조건',  key: row => (row.gradeConditions ?? []).join(', '), cls: 'text-center text-xs text-slate-500' },
            //{ label: 'Translation Key', key: row => row.translation?.translationKey ?? '-', cls: 'text-center font-mono text-xs text-slate-500 break-all' },
        ]
    },
};

function showCountryMdTab(tabKey) {
    currentCountryTab = tabKey;
    document.querySelectorAll('#md-country-tabs .md-tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`md-country-tab-${tabKey}`);
    if (btn) btn.classList.add('active');

    const cached = countryDataCache[currentCountryCode];
    if (!cached) return;

    const cfg = COUNTRY_TAB_CONFIG[tabKey];
    if (!cfg) return;

    countryMdAllRows = cfg.getData(cached);
    document.getElementById('md-country-search').value = '';
    renderCountryTable(countryMdAllRows, cfg.columns);
}

function filterCountryMdTable() {
    const q = document.getElementById('md-country-search').value.toLowerCase().trim();
    const cfg = COUNTRY_TAB_CONFIG[currentCountryTab];
    if (!cfg) return;

    const filtered = q ? countryMdAllRows.filter(row =>
        cfg.columns.some(col => {
            const val = typeof col.key === 'function' ? col.key(row) : row[col.key];
            // HTML 태그 제거 후 검색
            const text = String(val ?? '').replace(/<[^>]*>/g, ' ').toLowerCase();
            return text.includes(q);
        })
    ) : countryMdAllRows;

    countryMdCurrentPage = 1;
    renderCountryTable(filtered, cfg.columns);
}

function renderCountryTable(rows, columns) {
    countryMdFilteredRows = rows;
    countryMdCurrentColumns = columns;
    countryMdCurrentPage = 1;

    const thead = document.getElementById('md-country-thead');
    const countEl = document.getElementById('md-country-row-count');

    thead.innerHTML = '<tr>' + columns.map(c =>
        `<th class="px-4 py-3 font-bold border-b whitespace-nowrap">${c.label}</th>`
    ).join('') + '</tr>';

    countEl.textContent = `${rows.length.toLocaleString()}건`;
    _renderCountryTableBody(rows, columns);
}

function _renderCountryTableBody(rows, columns) {
    const tbody = document.getElementById('md-country-tbody');

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columns.length}" class="text-center py-10 text-gray-400">결과 없음</td></tr>`;
        document.getElementById('md-country-pagination').innerHTML = '';
        return;
    }

    const start = (countryMdCurrentPage - 1) * MD_PAGE_SIZE;
    const pageRows = rows.slice(start, start + MD_PAGE_SIZE);
    const globalOffset = start;

    tbody.innerHTML = pageRows.map((row, i) =>
        '<tr class="hover:bg-slate-50/50 transition">' +
        columns.map(col => {
            const raw = typeof col.key === 'function' ? col.key(row, globalOffset + i) : row[col.key];
            const val = raw !== null && raw !== undefined
                ? (typeof raw === 'object' ? JSON.stringify(raw) : raw)
                : '-';
            return `<td class="px-4 py-2.5 border-b border-gray-100 ${col.cls ?? ''}">${val}</td>`;
        }).join('') +
        '</tr>'
    ).join('');

    _buildMdPagination('md-country-pagination', rows.length, countryMdCurrentPage, MD_PAGE_SIZE, 'changeCountryMdPage');
}


function renderMasterDataUI(payload) {

    document.getElementById('md-loading').classList.add('hidden');

    const { masterData, appConfig } = payload;

    // 버전 바 업데이트
    const versionBar = document.getElementById('md-version-bar');
    const sections = [
        { key: 'translationMasterData', label: '번역' },
        { key: 'stageMasterData', label: '스테이지' },
        { key: 'titleMasterData', label: '타이틀' },
        { key: 'rewardMasterData', label: '보상' },
        { key: 'videoMasterData', label: '비디오' },
        { key: 'inAppProductMasterData', label: '인앱결제' },
        { key: 'conceptNoteMasterData', label: '개념노트' },
        { key: 'friendsAvatarMasterData', label: '아바타' },
        { key: 'badWordMasterData', label: '금지어' },
    ];
    const versionHtml = sections.map(s => {
        const v = masterData[s.key]?.masterDataVersion;
        return v !== undefined ? `<span class="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px]"><span class="font-bold text-slate-600">${s.label}</span> v${v}</span>` : '';
    }).filter(Boolean).join('');
    versionBar.innerHTML = `<i class="fas fa-tag text-slate-400"></i><span class="font-bold text-slate-600">버전</span>${versionHtml}` +
        (appConfig ? `<span class="ml-auto text-slate-400">Addressable: <span class="font-mono font-bold text-slate-600">${appConfig.addressableVersion}</span></span>` : '');
    versionBar.classList.remove('hidden');

    // 카운트 뱃지 업데이트
    const counts = {
        translation: masterData.translationMasterData?.translations?.length ?? 0,
        stage: masterData.stageMasterData?.stages?.length ?? 0,
        title: masterData.titleMasterData?.titles?.length ?? 0,
        reward: masterData.rewardMasterData?.rewards?.length ?? 0,
        video: masterData.videoMasterData?.videos?.length ?? 0,
        inappproduct: masterData.inAppProductMasterData?.inAppProducts?.length ?? 0,
        conceptnote: masterData.conceptNoteMasterData?.conceptNotes?.length ?? 0,
        avataritem: masterData.friendsAvatarMasterData?.friendsAvatarItems?.length ?? 0,
        avatarset: masterData.friendsAvatarMasterData?.friendsAvatarSets?.length ?? 0,
        badword: masterData.badWordMasterData?.words?.length ?? 0,
    };
    Object.entries(counts).forEach(([tab, cnt]) => {
        const el = document.getElementById(`mdcnt-${tab}`);
        if (el) el.textContent = cnt.toLocaleString();
    });

    document.getElementById('md-content').classList.remove('hidden');
    document.getElementById('md-search').value = '';
    showMdTab(currentMdTab);
}

// 스테이지 ID 추출 (description에서 "(stageId: 40411)" 패턴 파싱)
function extractStageId(text) {
    if (!text) return null;
    const match = text.match(/\(stageId:\s*(\d+)\)/i);
    return match ? parseInt(match[1]) : null;
}

// 스테이지 정보 모달 열기
function openStageInfoModal(stageId) {
    const modal = document.getElementById('stageInfoModal');
    const body = document.getElementById('stage-modal-body');
    const subtitle = document.getElementById('stage-modal-subtitle');

    subtitle.textContent = `stageId: ${stageId}`;
    body.innerHTML = '<div class="text-center text-gray-400 py-10"><i class="fas fa-spinner fa-spin text-lg mr-2"></i>불러오는 중...</div>';
    modal.classList.remove('hidden');

    // 고정 스테이지 데이터 (language master — ko > en > ja 순으로 탐색)
    let langStageData = null;
    for (const lang of ['ko', 'en', 'ja']) {
        const cache = masterDataCache[lang];
        if (cache) {
            const found = (cache.masterData?.stageMasterData?.stages ?? []).find(s => s.stageId === stageId);
            if (found) { langStageData = found; break; }
        }
    }

    // 국가별 스테이지 데이터 (stageId 필드 기준 매칭)
    const countryLabels = { KR: '🇰🇷 KR (한국)', EN: '🇺🇸 EN (영어권)', JP: '🇯🇵 JP (일본)' };
    const countryResults = [];
    for (const [code, label] of Object.entries(countryLabels)) {
        const cache = countryDataCache[code];
        if (!cache) continue;
        const allStages  = cache.nationalCurriculumMasterData?.nationalStages ?? [];
        const chapters   = cache.nationalCurriculumMasterData?.nationalChapters ?? [];
        const supremeChaps = cache.nationalCurriculumMasterData?.nationalSupremeChapters ?? [];
        const found = allStages.find(s => s.stageId === stageId);
        if (!found) continue;
        const chapter      = chapters.find(c => c.nationalChapterId === found.nationalChapterId) ?? null;
        const supremeChap  = chapter ? (supremeChaps.find(sc => sc.nationalSupremeChapterId === chapter.nationalSupremeChapterId) ?? null) : null;
        countryResults.push({ code, label, stage: found, chapter, supremeChap });
    }

    // ─── 렌더링 ───────────────────────────────────────────────────────────
    let html = '';

    // ① 고정 스테이지 섹션
    html += `
    <div>
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-5 h-5 bg-blue-100 rounded-full"><i class="fas fa-database text-blue-500 text-[9px]"></i></span>
            고정 스테이지 마스터 데이터
        </h4>`;
    if (langStageData) {
        html += `
        <div class="bg-slate-50 rounded-2xl border border-slate-200 p-5">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                ${_stageField('Stage ID', langStageData.stageId, 'blue')}
                ${_stageField('문제 수', langStageData.problemCount, 'indigo')}
                ${_stageField('Pen Type', langStageData.penType ?? '-', 'slate')}
                ${_stageField('Input Type', langStageData.inputType ?? '-', 'slate')}
                ${_stageField('1% 제한시간', langStageData.second1 != null ? langStageData.second1 + 's' : '-', 'slate')}
                ${_stageField('10% 제한시간', langStageData.second10 != null ? langStageData.second10 + 's' : '-', 'slate')}
                ${_stageField('30% 제한시간', langStageData.second30 != null ? langStageData.second30 + 's' : '-', 'slate')}
                ${_stageField('50% 제한시간', langStageData.second50 != null ? langStageData.second50 + 's' : '-', 'slate')}
            </div>
            <div class="flex flex-wrap gap-3 pt-3 border-t border-slate-200">
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] text-slate-400 uppercase font-bold mb-1 tracking-wide">Code</p>
                    <p class="font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg truncate">${langStageData.code ?? '-'}</p>
                </div>
                ${langStageData.prefab ? `
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] text-slate-400 uppercase font-bold mb-1 tracking-wide">Prefab</p>
                    <p class="font-mono text-xs text-purple-700 bg-purple-50 border border-purple-100 px-3 py-1.5 rounded-lg truncate">${langStageData.prefab}</p>
                </div>` : ''}
            </div>
        </div>`;
    } else {
        html += `
        <div class="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-400 text-sm">
            <i class="fas fa-database mr-1 opacity-50"></i> 데이터 없음
            <p class="text-xs mt-1 text-slate-300">언어 마스터 데이터가 로드되지 않았습니다.</p>
        </div>`;
    }
    html += `</div>`;

    // ② 국가별 스테이지 섹션
    html += `
    <div>
        <h4 class="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 rounded-full"><i class="fas fa-globe text-emerald-500 text-[9px]"></i></span>
            국가별 스테이지 데이터
        </h4>`;
    if (countryResults.length > 0) {
        html += `<div class="space-y-3">`;
        for (const { label, stage, chapter, supremeChap } of countryResults) {
            const levelColor = { 1:'purple', 2:'blue', 3:'indigo', 4:'teal' }[supremeChap?.level] ?? 'slate';
            html += `
            <div class="bg-slate-50 rounded-2xl border border-slate-200 p-4">
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-base font-black text-slate-700">${label}</span>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    ${_stageField('국가스테이지 ID', stage.nationalStageId, 'emerald')}
                    ${_stageField('스테이지 ID', stage.stageId, 'blue')}
                    ${supremeChap ? _stageField('대단원 ID', chapter?.nationalSupremeChapterId ?? '-', 'slate') : ''}
                    ${chapter ? _stageField('소단원 ID', stage.nationalChapterId, 'slate') : ''}
                    ${supremeChap ? _stageField('레벨', supremeChap.level +  ' 레벨', levelColor) : ''}
                    ${supremeChap ? _stageField('대단원 순서', supremeChap.sequence ?? '-', 'slate') : ''}
                    ${chapter ? _stageField('소단원 순서', chapter.sequence ?? '-', 'slate') : ''}
                    ${_stageField('스테이지 순서', stage.sequence ?? '-', 'slate')}

                </div>
                ${stage.translation?.translationKey ? `
                <div class="pt-3 border-t border-slate-200">
                    <p class="text-[10px] text-slate-400 uppercase font-bold mb-1 tracking-wide">Translation Key</p>
                    <p class="font-mono text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg inline-block">${stage.translation.translationKey}</p>
                </div>` : ''}
                ${supremeChap?.translation?.translationKey ? `
                <div class="pt-2 mt-1">
                    <p class="text-[10px] text-slate-400 uppercase font-bold mb-1 tracking-wide">대단원 명 (Translation Key)</p>
                    <p class="font-mono text-xs text-purple-700 bg-purple-50 border border-purple-100 px-3 py-1.5 rounded-lg inline-block">${supremeChap.translation.translationKey}</p>
                </div>` : ''}
            </div>`;
        }
        html += `</div>`;
    } else {
        html += `
        <div class="bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-400 text-sm">
            <i class="fas fa-globe mr-1 opacity-50"></i> 국가별 데이터 없음
            <p class="text-xs mt-1 text-slate-300">국가 마스터 데이터가 로드되지 않았습니다.</p>
        </div>`;
    }
    html += `</div>`;

    body.innerHTML = html;
}

// 스테이지 정보 필드 카드 렌더링 헬퍼
function _stageField(label, value, color = 'slate') {
    const colorMap = {
        blue:    'text-blue-700 bg-blue-50 border-blue-100',
        indigo:  'text-indigo-700 bg-indigo-50 border-indigo-100',
        emerald: 'text-emerald-700 bg-emerald-50 border-emerald-100',
        purple:  'text-purple-700 bg-purple-50 border-purple-100',
        teal:    'text-teal-700 bg-teal-50 border-teal-100',
        slate:   'text-slate-700 bg-white border-slate-200',
    };
    const cls = colorMap[color] ?? colorMap.slate;
    return `
    <div class="flex flex-col gap-1">
        <p class="text-[10px] text-slate-400 uppercase font-bold tracking-wide truncate">${label}</p>
        <p class="text-sm font-bold ${cls} border px-2.5 py-1.5 rounded-lg text-center">${value ?? '-'}</p>
    </div>`;
}

// 아바타 아이템 이미지 경로 후보 목록 생성 (대소문자 변형 포함)
function getAvatarItemImageCandidates(item) {
    const type1 = item.type1;
    const f = item.fileName;
    if (!f) return [];
    // 여러 경로 후보에서 _Icon.png / _icon.png 변형을 모두 생성
    const variants = (...bases) => bases.flatMap(b => [`${b}_Icon.png`, `${b}_icon.png`]);
    const MAP = {
        'BACK_ACCESSORIES': variants(
            `Avatar/BACK_ACCESSORIES/AccB${f}/AccB_${f}`,
            `Avatar/BACK_ACCESSORIES/AccB${f}/accB_${f}`,
            `Avatar/BACK_ACCESSORIES/AccB${f}/accb_${f}`,
            `Avatar/BACK_ACCESSORIES/accB${f}/AccB_${f}`,
            `Avatar/BACK_ACCESSORIES/accB${f}/accB_${f}`,
            `Avatar/BACK_ACCESSORIES/accb${f}/accb_${f}`,
        ),
        'HAT': variants(
            `Avatar/HAT/Hat${f}/Hat_${f}`,
            `Avatar/HAT/Hat${f}/hat_${f}`,
            `Avatar/HAT/hat${f}/Hat_${f}`,
            `Avatar/HAT/hat${f}/hat_${f}`,
        ),
        'HEAD_ACCESSORIES': variants(
            `Avatar/HEAD_ACCESSORIES/AccH${f}/AccH_${f}`,
            `Avatar/HEAD_ACCESSORIES/AccH${f}/accH_${f}`,
            `Avatar/HEAD_ACCESSORIES/AccH${f}/acch_${f}`,
            `Avatar/HEAD_ACCESSORIES/accH${f}/AccH_${f}`,
            `Avatar/HEAD_ACCESSORIES/accH${f}/accH_${f}`,
            `Avatar/HEAD_ACCESSORIES/acch${f}/acch_${f}`,
        ),
        'PANTS': variants(
            `Avatar/PANTS/Pants${f}/Pants_${f}`,
            `Avatar/PANTS/Pants${f}/pants_${f}`,
            `Avatar/PANTS/pants${f}/Pants_${f}`,
            `Avatar/PANTS/pants${f}/pants_${f}`,
        ),
        'SUIT': variants(
            `Avatar/SUIT/Suit${f}/Suit_${f}`,
            `Avatar/SUIT/Suit${f}/suit_${f}`,
            `Avatar/SUIT/suit${f}/Suit_${f}`,
            `Avatar/SUIT/suit${f}/suit_${f}`,
        ),
        'TOP': variants(
            `Avatar/TOP/Top${f}/Top_${f}`,
            `Avatar/TOP/Top${f}/top_${f}`,
            `Avatar/TOP/top${f}/Top_${f}`,
            `Avatar/TOP/top${f}/top_${f}`,
        ),
        'WEAPON': variants(
            `Avatar/WEAPON/Weapon${f}/Weapon_${f}`,
            `Avatar/WEAPON/Weapon${f}/weapon_${f}`,
            `Avatar/WEAPON/weapon${f}/Weapon_${f}`,
            `Avatar/WEAPON/weapon${f}/weapon_${f}`,
        ),
    };
    return MAP[type1] ?? [];
}

// 아바타 아이템 이미지 경로 생성 (첫 번째 후보 반환)
function getAvatarItemImagePath(item) {
    return getAvatarItemImageCandidates(item)[0] ?? null;
}

const MD_TAB_CONFIG = {
    translation: {
        getData: md => md.translationMasterData?.translations ?? [],
        columns: [
            { label: 'Translation Key', key: 'translationKey', cls: 'text-center font-mono text-xs text-indigo-700 break-all w-1/2' },
            { label: 'Value', key: 'value', cls: 'text-center text-slate-700 w-1/2' },
        ]
    },
    stage: {
        getData: md => md.stageMasterData?.stages ?? [],
        columns: [
            { label: 'ID', key: 'stageId', cls: 'text-center font-mono text-xs' },
            { label: 'Code', key: 'code', cls: 'text-center font-mono text-xs text-indigo-700' },
            { label: '문제 수', key: 'problemCount', cls: 'text-center' },
            { label: 'Sec 1%', key: 'second1', cls: 'text-center text-xs' },
            { label: 'Sec 10%', key: 'second10', cls: 'text-center text-xs' },
            { label: 'Sec 30%', key: 'second30', cls: 'text-center text-xs' },
            { label: 'Sec 50%', key: 'second50', cls: 'text-center text-xs' },
            { label: 'Pen', key: 'penType', cls: 'text-center text-xs' },
            { label: 'Input', key: 'inputType', cls: 'text-center text-xs', sortable: true },
            { label: 'Prefab', key: 'prefab', cls: 'text-center font-mono text-xs text-slate-500' },
        ]
    },
    title: {
        getData: md => md.titleMasterData?.titles ?? [],
        columns: [
            { label: 'ID', key: 'titleId', cls: 'text-center font-mono text-xs' },
            { label: 'Code', key: 'code', cls: 'text-center font-mono text-xs text-indigo-700 break-all min-w-[200px]' },
            { label: '카테고리', key: 'category', cls: 'text-center text-xs' },
            { label: '등급', key: 'grade', cls: 'text-center text-xs' },
            { label: 'Target', key: 'targetCount', cls: 'text-center text-xs' },
            { label: 'Thumbnail', key: row => `<div class="truncate" title="${row.thumbnailImage ?? ''}">${row.thumbnailImage ?? '-'}</div>`, cls: 'text-center font-mono text-xs text-slate-500', maxWidth: '100px' },
            { label: 'Translation Key', key: row => `<div class="truncate" title="${row.nameTranslation?.translationKey ?? ''}">${row.nameTranslation?.translationKey ?? '-'}</div>`, cls: 'text-center font-mono text-xs text-slate-500', maxWidth: '160px' },
        ]
    },
    reward: {
        getData: md => md.rewardMasterData?.rewards ?? [],
        columns: [
            { label: 'ID', key: 'rewardId', cls: 'text-center font-mono text-xs' },
            { label: 'Code', key: 'code', cls: 'text-center font-mono text-xs text-indigo-700 break-all min-w-[180px]' },
            { label: 'Type', key: 'type', cls: 'text-center text-xs' },
            { label: 'Frame', key: row => `<div class="truncate" title="${row.rewardFrame ?? ''}">${row.rewardFrame ?? '-'}</div>`, cls: 'text-center font-mono text-xs text-slate-500', maxWidth: '100px' },
            { label: 'Icon', key: row => `<div class="truncate" title="${row.rewardIcon ?? ''}">${row.rewardIcon ?? '-'}</div>`, cls: 'text-center font-mono text-xs text-slate-500', maxWidth: '140px' },
            { label: '랭킹', key: row => row.isRankEligible ? '✅' : '❌', cls: 'text-center', maxWidth: '100px' },
        ]
    },
    video: {
        getData: md => md.videoMasterData?.videos ?? [],
        columns: [
            { label: 'ID', key: 'videoId', cls: 'text-center font-mono text-xs' },
            { label: 'Level', key: 'level', cls: 'text-center' },
            { label: 'Seq', key: 'sequence', cls: 'text-center' },
            { label: '제목', key: 'title', cls: 'text-center text-slate-700 min-w-[200px]' },
            { label: '길이(초)', key: 'durationSeconds', cls: 'text-center text-xs' },
            { label: 'Thumbnail', key: row => `<div class="truncate" title="${row.thumbnailImage ?? ''}">${row.thumbnailImage ?? '-'}</div>`, cls: 'text-center font-mono text-xs text-slate-500', maxWidth: '100px' },
        ]
    },
    inappproduct: {
        getData: md => md.inAppProductMasterData?.inAppProducts ?? [],
        columns: [
            { label: 'ID', key: 'inAppProductId', cls: 'text-center font-mono text-xs' },
            { label: 'Product ID', key: 'productId', cls: 'text-center font-mono text-xs text-indigo-700 break-all' },
            { label: 'Android ID', key: 'androidProductId', cls: 'text-center font-mono text-xs text-slate-500 break-all' },
            { label: 'iOS ID', key: 'iosProductId', cls: 'text-center font-mono text-xs text-slate-500 break-all' },
            { label: '일수', key: 'days', cls: 'text-center font-bold' },
        ]
    },
    conceptnote: {
        getData: md => md.conceptNoteMasterData?.conceptNotes ?? [],
        columns: [
            { label: 'ID', key: 'conceptNoteId', cls: 'text-center font-mono text-xs' },
            { label: 'Translation Key', key: row => row.translation?.translationKey ?? '-', cls: 'text-center font-mono text-xs text-indigo-700' },
            { label: '이미지 수', key: row => row.images?.length ?? 0, cls: 'text-center' },
            { label: '이미지 목록', key: row => (row.images ?? []).join(', '), cls: 'text-center font-mono text-xs text-slate-500' },
        ]
    },
    avataritem: {
        getData: md => md.friendsAvatarMasterData?.friendsAvatarItems ?? [],
        columns: [
            { label: '이미지', key: row => {
                const candidates = getAvatarItemImageCandidates(row);
                if (!candidates.length) return '<span class="text-slate-300 text-xs">-</span>';
                const cAttr = JSON.stringify(candidates).replace(/"/g, '&quot;');
                return `<img src="${candidates[0]}" alt="${row.friendsAvatarItemId}" class="w-20 h-20 object-contain mx-auto rounded" data-c="${cAttr}" data-ci="0" onerror="var ci=+this.dataset.ci+1,ca=JSON.parse(this.dataset.c);this.dataset.ci=ci;if(ci<ca.length){this.src=ca[ci]}else{this.style.display='none';this.nextElementSibling.style.display='inline'}"><span class="text-slate-300 text-xs hidden">없음</span>`;
            }, cls: 'text-center w-28' },
            { label: 'ID', key: 'friendsAvatarItemId', cls: 'text-center font-mono text-xs' },
            { label: 'Type1', key: 'type1', cls: 'text-center text-xs', maxWidth: '100px' },
            { label: 'Type2', key: 'type2', cls: 'text-center text-xs', maxWidth: '100px' },
            { label: 'ItemInfoType2', key: 'itemInfoType2', cls: 'text-center text-xs' },
            { label: 'Character', key: 'friendsAvatarCharacterId', cls: 'text-center', maxWidth: '100px' },
            { label: '가격', key: 'price', cls: 'text-center font-bold' },
            { label: '출시 회차', key: 'releaseRound', cls: 'text-center text-xs', maxWidth: '50px' },
            { label: 'File', key: 'fileName', cls: 'text-center font-mono text-xs text-slate-500', maxWidth: '50px' },
        ]
    },
    avatarset: {
        getData: md => md.friendsAvatarMasterData?.friendsAvatarSets ?? [],
        columns: [
            { label: 'ID', key: 'friendsAvatarSetId', cls: 'text-center font-mono text-xs' },
            { label: 'Type', key: 'type', cls: 'text-center text-xs text-indigo-700', maxWidth: '50px' },
            { label: 'ItemInfoType2', key: 'itemInfoType2', cls: 'text-center text-xs' },
            { label: 'Character', key: 'friendsAvatarCharacterId', cls: 'text-center', maxWidth: '50px' },
            { label: '출시 회차', key: 'releaseRound', cls: 'text-center text-xs', maxWidth: '50px' },
            { label: '아이템 수', key: row => row.friendsAvatarItemIds?.length ?? 0, cls: 'text-center', maxWidth: '50px' },
            { label: 'Translation Key', key: row => row.translation?.translationKey ?? '-', cls: 'text-center font-mono text-xs text-slate-500' },
        ]
    },
    badword: {
        getData: md => (md.badWordMasterData?.words ?? []).map(w => ({ word: w })),
        columns: [
            { label: '#', key: (_, i) => i + 1, cls: 'text-center text-xs text-slate-400 w-12' },
            { label: '금지어', key: 'word', cls: 'text-center font-bold text-red-600' },
        ]
    },
};

function showMdTab(tab) {
    currentMdTab = tab;
    document.querySelectorAll('.md-tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(`mdtab-${tab}`);
    if (btn) btn.classList.add('active');

    const payload = masterDataCache[currentMasterLang];
    if (!payload) return;

    const config = MD_TAB_CONFIG[tab];
    if (!config) return;

    mdAllRows = config.getData(payload.masterData);
    mdInputSortDir = null;
    document.getElementById('md-search').value = '';
    renderMdTable(mdAllRows, config.columns);
}

function filterMdTable() {
    const q = document.getElementById('md-search').value.toLowerCase().trim();
    const config = MD_TAB_CONFIG[currentMdTab];
    if (!config) return;
    const filtered = q ? mdAllRows.filter(row =>
        config.columns.some(col => {
            const val = typeof col.key === 'function' ? col.key(row, 0) : row[col.key];
            return String(val ?? '').toLowerCase().includes(q);
        })
    ) : mdAllRows;
    mdCurrentPage = 1;
    renderMdTable(filtered, config.columns);
}

function renderMdTable(rows, columns) {
    mdFilteredRows = rows;
    mdCurrentColumns = columns;
    mdCurrentPage = 1;

    const table = document.getElementById('md-table');
    const thead = document.getElementById('md-thead');
    const countEl = document.getElementById('md-row-count');

    // colgroup으로 컬럼 너비 고정 (table-layout: fixed 전제)
    const existingColgroup = table.querySelector('colgroup');
    if (existingColgroup) existingColgroup.remove();
    const colgroup = document.createElement('colgroup');
    columns.forEach(c => {
        const col = document.createElement('col');
        if (c.maxWidth) col.style.width = c.maxWidth;
        colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, thead);
    table.style.tableLayout = 'fixed';

    // 헤더
    thead.innerHTML = '<tr>' + columns.map(c => {
        if (c.sortable) {
            return `<th class="px-4 py-3 font-bold border-b whitespace-nowrap text-center overflow-hidden">
                <button onclick="toggleMdInputSort()" class="inline-flex items-center gap-1 hover:text-blue-600 transition">
                    ${c.label}
                    <i id="md-input-sort-icon" class="fas fa-sort text-gray-400 text-xs"></i>
                </button>
            </th>`;
        }
        return `<th class="px-4 py-3 font-bold border-b whitespace-nowrap text-center overflow-hidden">${c.label}</th>`;
    }).join('') + '</tr>';

    countEl.textContent = `${rows.length.toLocaleString()}건`;
    _renderMdTableBody(rows, columns);
}

function _renderMdTableBody(rows, columns) {
    const tbody = document.getElementById('md-tbody');

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${columns.length}" class="text-center py-10 text-gray-400">결과 없음</td></tr>`;
        document.getElementById('md-pagination').innerHTML = '';
        return;
    }

    // Input 정렬 적용
    const iconEl = document.getElementById('md-input-sort-icon');
    if (mdInputSortDir !== null) {
        rows = [...rows].sort((a, b) => {
            const va = a.inputType ?? 0;
            const vb = b.inputType ?? 0;
            return mdInputSortDir === 'asc' ? va - vb : vb - va;
        });
        if (iconEl) iconEl.className = `fas fa-sort-${mdInputSortDir === 'asc' ? 'up' : 'down'} text-blue-500 text-xs`;
    } else {
        if (iconEl) iconEl.className = 'fas fa-sort text-gray-400 text-xs';
    }

    const start = (mdCurrentPage - 1) * MD_PAGE_SIZE;
    const pageRows = rows.slice(start, start + MD_PAGE_SIZE);
    const globalOffset = start;

    tbody.innerHTML = pageRows.map((row, i) =>
        '<tr class="hover:bg-slate-50/50 transition">' +
        columns.map(col => {
            const val = typeof col.key === 'function' ? col.key(row, globalOffset + i) : (row[col.key] ?? '-');
            const ovf = col.maxWidth ? ' style="overflow:hidden"' : '';
            return `<td class="px-4 py-2.5 border-b border-gray-100 ${col.cls ?? ''}"${ovf}>${val}</td>`;
        }).join('') +
        '</tr>'
    ).join('');

    _buildMdPagination('md-pagination', rows.length, mdCurrentPage, MD_PAGE_SIZE, 'changeMdPage');
}
