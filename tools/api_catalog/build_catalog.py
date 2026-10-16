"""API 호출 지도(api-catalog.json) 생성.

정적 추출(extract_api.py) 결과에 사람이/에이전트가 쓴 설명(descriptions.json)을 합친다.
- 설명은 엔드포인트 key + 호출 파일 + 메서드로 이어 붙이고, 줄 번호는 최신 추출 값으로 갱신한다.
- 추출에는 있는데 설명이 없는 호출 지점은 "설명 없음"으로 넣고 콘솔에 알린다.
- 설명에는 있는데 코드에서 사라진 호출 지점은 빼고 콘솔에 알린다(WS.* 처럼 추출 대상이 아닌 key 는 그대로 둔다).

usage:
  python -I extract_api.py <unity_project_root> raw.json
  python -I build_catalog.py raw.json descriptions.json <unity_project_root> ../../api-catalog.json
"""
import json, os, subprocess, sys
from datetime import datetime, timezone, timedelta

RAW, DESC, UNITY, OUT = sys.argv[1:5]

# API 클래스 → 페이지 묶음 키 (api-catalog.js 의 AC_GROUPS 와 맞출 것)
GROUP_OF = {
    'API_AppInit': 'boot', 'API_Device': 'boot',
    'API_Authentication': 'auth', 'API_Account': 'auth', 'API_Profile': 'auth', 'API_Class': 'auth',
    'API_Learning': 'learning', 'API_LearningProgress': 'learning', 'API_LearningResult': 'learning', 'API_Video': 'learning',
    'API_LevelTest': 'leveltest',
    'API_Game': 'game',
    'API_MathBattle': 'netgame', 'API_NetGame': 'netgame', 'API_GroupActivity': 'netgame', 'API_NetGameMakeTen': 'netgame', 'WS': 'netgame',
    'API_Ranking': 'ranking',
    'API_Avatar': 'avatar', 'API_Title': 'avatar', 'API_Contest': 'avatar',
    'API_Purchase': 'shop', 'API_Coin': 'shop', 'API_Voucher': 'shop', 'API_Reward': 'shop', 'API_License': 'shop', 'API_Coupon': 'shop', 'API_Gacha': 'shop',
    'API_Event': 'event', 'API_Calendar': 'event', 'API_Mission': 'event', 'API_Keyring': 'event',
    'API_Inquiry': 'comm', 'API_Message': 'comm', 'API_Notcie': 'comm', 'API_Banner': 'comm',
    'API_Developer': 'dev',
}

raw = json.load(open(RAW, encoding='utf-8'))
desc = json.load(open(DESC, encoding='utf-8'))


def git(*args):
    try:
        return subprocess.check_output(['git', '-C', UNITY, *args], text=True, encoding='utf-8').strip()
    except Exception:
        return ''


# 추출된 호출 지점: key -> [call]
raw_calls = {}
for c in raw['calls']:
    raw_calls.setdefault(f"{c['api']}.{c['member']}", []).append(c)

# 정의 위치·경로
defs = {}
for cls, info in raw['apis'].items():
    for m, v in info['members'].items():
        if v['paths']:
            defs[f'{cls}.{m}'] = v

endpoints, warn = [], []
seen_keys = set()
for ep in desc['endpoints']:
    key = ep['key']
    seen_keys.add(key)
    cls = key.split('.')[0]
    extracted = cls == 'WS' or key in defs or key in raw_calls
    calls_out = []
    pool = raw_calls.get(key, [])
    covered = set()
    for c in ep.get('calls', []):
        if cls == 'WS':
            calls_out.append(c)
            continue
        # 같은 파일·메서드 → 같은 파일(줄 가장 가까운 것) 순으로 짝을 찾는다.
        # 한 호출 지점을 콘텐츠 타입별로 여러 줄로 나눠 적은 설명도 있어 짝은 중복될 수 있다.
        cand = [r for r in pool if r['file'] == c['file'] and r['method'] == c.get('method')] or \
               [r for r in pool if r['file'] == c['file']]
        if cand:
            r = min(cand, key=lambda r: abs(r['line'] - int(c.get('line') or 0)))
            covered.add(id(r))
            calls_out.append({**c, 'file': r['file'], 'line': r['line'], 'method': r['method'] or c.get('method', '')})
        elif os.path.exists(os.path.join(UNITY, c['file'])):
            # 공용 메서드(EditProfile 등)를 거쳐 부르는 상위 화면 — 추출 대상은 아니지만 유지
            calls_out.append({**c, 'indirect': True})
        else:
            warn.append(f"[사라짐] {key} {c['file']}:{c.get('line')} ({c.get('method')})")
    for r in pool:
        if id(r) in covered:
            continue
        warn.append(f"[설명 없음] {key} {r['file']}:{r['line']} ({r['method']})")
        calls_out.append({'file': r['file'], 'line': r['line'], 'method': r['method'], 'path': '', 'scenes': [],
                          'screen': '', 'trigger': '(설명 없음 — 새 호출 지점)', 'on_fail': '', 'note': ''})
    d = defs.get(key, {})
    endpoints.append({
        'key': key,
        'group': GROUP_OF.get(cls, 'dev'),
        'name': ep.get('name', ''),
        'http': ep.get('http', ''),
        'paths': ep.get('paths') or d.get('paths', []),
        'desc': ep.get('desc', ''),
        'unused': not calls_out,
        'def_line': d.get('line'),
        'calls': sorted(calls_out, key=lambda c: (c['file'], c['line'])),
    })

for key in sorted(set(raw_calls) - seen_keys):
    warn.append(f"[엔드포인트 설명 없음] {key} ({len(raw_calls[key])}곳)")
    cls = key.split('.')[0]
    endpoints.append({'key': key, 'group': GROUP_OF.get(cls, 'dev'), 'name': key, 'http': '/'.join(sorted({h for c in raw_calls[key] for h in c['http']})),
                      'paths': defs.get(key, {}).get('paths', []), 'desc': '', 'unused': False, 'def_line': defs.get(key, {}).get('line'),
                      'calls': [{'file': c['file'], 'line': c['line'], 'method': c['method'], 'path': '', 'scenes': [], 'screen': '',
                                 'trigger': '(설명 없음 — 새 호출 지점)', 'on_fail': '', 'note': ''} for c in raw_calls[key]]})

# 씬 이동 흐름 → 지도용 간선. 구버전 로비 씬은 빼고, "공통"(팝업·매니저)에서만 들어가는 씬은 로비에서 팝업을 거쳐 간다고 본다.
LEGACY_SCENES = {'MainLobbyScene', 'MainLobbyScene_mf'}
edges = {}
for f in raw.get('flows', []):
    if f['from'] in LEGACY_SCENES or f['to'] in LEGACY_SCENES:
        continue
    e = edges.setdefault((f['from'], f['to']), {'from': f['from'], 'to': f['to'], 'kinds': set(), 'refs': []})
    e['kinds'].add('button' if f['kind'].startswith('button') else 'code')
    e['refs'].append(f"{f['file']}:{f['line']}" if f['line'] else f['file'])
has_direct_in = {t for (s, t) in edges if s != '공통'}
for (s, t), e in list(edges.items()):
    if s != '공통':
        continue
    del edges[(s, t)]
    if t not in has_direct_in and t != 'MainLobbyScene_v4':
        edges[('MainLobbyScene_v4', t)] = {'from': 'MainLobbyScene_v4', 'to': t, 'kinds': {'popup'}, 'refs': e['refs']}
flows = [{**e, 'kinds': sorted(e['kinds']), 'refs': sorted(set(e['refs']))[:6]} for e in edges.values()]

out = {
    'generated_at': datetime.now(timezone(timedelta(hours=9))).strftime('%Y-%m-%d %H:%M KST'),
    'unity_branch': git('rev-parse', '--abbrev-ref', 'HEAD'),
    'unity_commit': git('rev-parse', '--short=9', 'HEAD'),
    'api_file': 'Assets/Main/Script/CommonAPI.cs',
    'note': desc.get('note', ''),
    'endpoints': endpoints,
    'flows': flows,
}
json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f"flows={len(flows)}")
print(f"endpoints={len(endpoints)} used={sum(not e['unused'] for e in endpoints)} calls={sum(len(e['calls']) for e in endpoints)}")
for w in warn:
    print(w)
