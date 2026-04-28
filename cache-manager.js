/**
 * 캐시 관리자 (IndexedDB + 메모리 폴백)
 * Supabase 데이터를 로컬에 캐싱하여 Egress 절감
 * file:// 프로토콜에서는 자동으로 메모리 캐시로 전환
 */

class CacheManager {
    constructor(dbName = 'OneproQA_Cache', version = 2) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.TTL = 30 * 60 * 1000; // 기본 30분 (밀리초) - Egress 절감을 위해 5분에서 30분으로 연장
        this.useMemoryCache = false; // IndexedDB 사용 불가 시 메모리 캐시로 폴백
        this.memoryCache = new Map(); // 메모리 캐시 저장소
    }

    /**
     * IndexedDB 초기화 (실패 시 메모리 캐시로 폴백)
     */
    async init() {
        // IndexedDB 사용 가능 여부 확인
        if (!window.indexedDB) {
            console.warn('⚠️ IndexedDB를 사용할 수 없습니다. 메모리 캐시로 전환합니다.');
            this.useMemoryCache = true;
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(this.dbName, this.version);

                request.onerror = () => {
                    console.warn('⚠️ IndexedDB 열기 실패 (file:// 프로토콜?). 메모리 캐시로 전환합니다.');
                    this.useMemoryCache = true;
                    resolve(); // reject 대신 resolve - 에러가 아님
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    console.log('✅ IndexedDB 초기화 완료');
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // qa_logs 캐시 저장소 (레거시 - 하위 호환성)
                    if (!db.objectStoreNames.contains('qa_logs')) {
                        db.createObjectStore('qa_logs', { keyPath: 'cacheKey' });
                    }

                    // qa_logs_page 캐시 저장소 (페이지별 데이터)
                    if (!db.objectStoreNames.contains('qa_logs_page')) {
                        db.createObjectStore('qa_logs_page', { keyPath: 'cacheKey' });
                    }

                    // qa_logs_summary 캐시 저장소 (대시보드용 요약 데이터)
                    if (!db.objectStoreNames.contains('qa_logs_summary')) {
                        db.createObjectStore('qa_logs_summary', { keyPath: 'cacheKey' });
                    }

                    // qa_logs_count 캐시 저장소 (필터별 카운트)
                    if (!db.objectStoreNames.contains('qa_logs_count')) {
                        db.createObjectStore('qa_logs_count', { keyPath: 'cacheKey' });
                    }

                    // qa_information 캐시 저장소
                    if (!db.objectStoreNames.contains('qa_information')) {
                        db.createObjectStore('qa_information', { keyPath: 'cacheKey' });
                    }

                    // 메타데이터 저장소 (캐시 갱신 시간 등)
                    if (!db.objectStoreNames.contains('metadata')) {
                        db.createObjectStore('metadata', { keyPath: 'key' });
                    }
                };
            } catch (err) {
                console.warn('⚠️ IndexedDB 초기화 예외:', err.message, '. 메모리 캐시로 전환합니다.');
                this.useMemoryCache = true;
                resolve(); // reject 대신 resolve
            }
        });
    }

    /**
     * 캐시에서 데이터 가져오기
     * @param {string} storeName - 저장소 이름
     * @param {string} key - 캐시 키
     * @returns {Promise<any|null>} - 캐시된 데이터 또는 null
     */
    async get(storeName, key = 'default') {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            const fullKey = `${storeName}:${key}`;
            const cached = this.memoryCache.get(fullKey);

            if (!cached) return null;

            // TTL 체크
            const now = Date.now();
            if (cached.expiresAt && now > cached.expiresAt) {
                this.memoryCache.delete(fullKey);
                return null;
            }

            return cached.data;
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);

                request.onsuccess = () => {
                    const result = request.result;

                    // 캐시가 없으면 null 반환
                    if (!result) {
                        resolve(null);
                        return;
                    }

                    // TTL 체크
                    const now = Date.now();
                    if (result.expiresAt && now > result.expiresAt) {
                        // 만료된 캐시 삭제
                        this.delete(storeName, key);
                        resolve(null);
                        return;
                    }

                    resolve(result.data);
                };

                request.onerror = () => reject(request.error);
            } catch (err) {
                console.error('캐시 읽기 오류:', err);
                resolve(null);
            }
        });
    }

    /**
     * 캐시에 데이터 저장
     * @param {string} storeName - 저장소 이름
     * @param {string} key - 캐시 키
     * @param {any} data - 저장할 데이터
     * @param {number} ttl - Time To Live (밀리초, 기본값: this.TTL)
     */
    async set(storeName, key = 'default', data, ttl = this.TTL) {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            const fullKey = `${storeName}:${key}`;
            this.memoryCache.set(fullKey, {
                data: data,
                cachedAt: Date.now(),
                expiresAt: ttl > 0 ? Date.now() + ttl : null
            });
            return Promise.resolve(true);
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);

                const cacheData = {
                    cacheKey: key,
                    data: data,
                    cachedAt: Date.now(),
                    expiresAt: ttl > 0 ? Date.now() + ttl : null
                };

                const request = store.put(cacheData);
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (err) {
                console.error('캐시 저장 오류:', err);
                resolve(false);
            }
        });
    }

    /**
     * 캐시 삭제
     * @param {string} storeName - 저장소 이름
     * @param {string} key - 캐시 키
     */
    async delete(storeName, key = 'default') {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            const fullKey = `${storeName}:${key}`;
            this.memoryCache.delete(fullKey);
            return Promise.resolve(true);
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);

                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (err) {
                console.error('캐시 삭제 오류:', err);
                resolve(false);
            }
        });
    }

    /**
     * 특정 저장소의 모든 캐시 삭제
     * @param {string} storeName - 저장소 이름
     */
    async clearStore(storeName) {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            const prefix = `${storeName}:`;
            for (const key of this.memoryCache.keys()) {
                if (key.startsWith(prefix)) {
                    this.memoryCache.delete(key);
                }
            }
            return Promise.resolve(true);
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();

                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (err) {
                console.error('캐시 스토어 삭제 오류:', err);
                resolve(false);
            }
        });
    }

    /**
     * 모든 캐시 삭제
     */
    async clearAll() {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            this.memoryCache.clear();
            return Promise.resolve(true);
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        const stores = ['qa_logs', 'qa_logs_page', 'qa_logs_summary', 'qa_logs_count', 'qa_information', 'metadata'];
        const promises = stores.map(store => this.clearStore(store));

        return Promise.all(promises);
    }

    /**
     * 캐시 메타데이터 저장
     * @param {string} key - 메타데이터 키
     * @param {any} value - 메타데이터 값
     */
    async setMetadata(key, value) {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            const fullKey = `metadata:${key}`;
            this.memoryCache.set(fullKey, {
                value: value,
                updatedAt: Date.now()
            });
            return Promise.resolve(true);
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['metadata'], 'readwrite');
                const store = transaction.objectStore('metadata');

                const request = store.put({ key, value, updatedAt: Date.now() });
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            } catch (err) {
                console.error('메타데이터 저장 오류:', err);
                resolve(false);
            }
        });
    }

    /**
     * 캐시 메타데이터 가져오기
     * @param {string} key - 메타데이터 키
     */
    async getMetadata(key) {
        // 메모리 캐시 모드
        if (this.useMemoryCache) {
            const fullKey = `metadata:${key}`;
            const cached = this.memoryCache.get(fullKey);
            return cached ? cached.value : null;
        }

        // IndexedDB 모드
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['metadata'], 'readonly');
                const store = transaction.objectStore('metadata');
                const request = store.get(key);

                request.onsuccess = () => {
                    const result = request.result;
                    resolve(result ? result.value : null);
                };
                request.onerror = () => reject(request.error);
            } catch (err) {
                console.error('메타데이터 읽기 오류:', err);
                resolve(null);
            }
        });
    }

    /**
     * 캐시 상태 확인 (디버깅용)
     */
    async getCacheStatus() {
        if (!this.db) await this.init();

        const status = {
            qa_logs: null,
            qa_information: null,
            totalSize: 0
        };

        const stores = ['qa_logs', 'qa_information'];
        
        for (const storeName of stores) {
            const data = await this.get(storeName);
            if (data) {
                status[storeName] = {
                    itemCount: Array.isArray(data) ? data.length : 1,
                    size: JSON.stringify(data).length,
                    cached: true
                };
                status.totalSize += status[storeName].size;
            } else {
                status[storeName] = { cached: false };
            }
        }

        return status;
    }
}

// 전역 캐시 매니저 인스턴스 (window에 명시적으로 할당)
window.cacheManager = new CacheManager();

// 초기화 Promise를 전역으로 노출 (다른 스크립트에서 대기 가능)
window.cacheManagerReady = window.cacheManager.init().catch(err => {
    console.error('⚠️ 캐시 매니저 초기화 실패 (메모리 캐시로 전환):', err);
    // 초기화 실패해도 메모리 캐시로 동작하므로 에러를 던지지 않음
    return Promise.resolve();
});
