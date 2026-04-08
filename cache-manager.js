/**
 * IndexedDB 기반 캐시 관리자
 * Supabase 데이터를 로컬에 캐싱하여 Egress 절감
 */

class CacheManager {
    constructor(dbName = 'OneproQA_Cache', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
        this.TTL = 5 * 60 * 1000; // 기본 5분 (밀리초)
    }

    /**
     * IndexedDB 초기화
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // qa_logs 캐시 저장소
                if (!db.objectStoreNames.contains('qa_logs')) {
                    db.createObjectStore('qa_logs', { keyPath: 'cacheKey' });
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
        });
    }

    /**
     * 캐시에서 데이터 가져오기
     * @param {string} storeName - 저장소 이름
     * @param {string} key - 캐시 키
     * @returns {Promise<any|null>} - 캐시된 데이터 또는 null
     */
    async get(storeName, key = 'default') {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
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
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
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
        });
    }

    /**
     * 캐시 삭제
     * @param {string} storeName - 저장소 이름
     * @param {string} key - 캐시 키
     */
    async delete(storeName, key = 'default') {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 특정 저장소의 모든 캐시 삭제
     * @param {string} storeName - 저장소 이름
     */
    async clearStore(storeName) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 모든 캐시 삭제
     */
    async clearAll() {
        if (!this.db) await this.init();

        const stores = ['qa_logs', 'qa_information', 'metadata'];
        const promises = stores.map(store => this.clearStore(store));
        
        return Promise.all(promises);
    }

    /**
     * 캐시 메타데이터 저장
     * @param {string} key - 메타데이터 키
     * @param {any} value - 메타데이터 값
     */
    async setMetadata(key, value) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            
            const request = store.put({ key, value, updatedAt: Date.now() });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 캐시 메타데이터 가져오기
     * @param {string} key - 메타데이터 키
     */
    async getMetadata(key) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : null);
            };
            request.onerror = () => reject(request.error);
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

// 전역 캐시 매니저 인스턴스
const cacheManager = new CacheManager();
