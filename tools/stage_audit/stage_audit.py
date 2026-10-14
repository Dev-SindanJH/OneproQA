"""
QAI 스테이지 검수 — 정적 분석 스캐너

유니티 프로젝트의 스테이지 스크립트(.cs)와 스테이지 프리팹(.prefab YAML)을 읽어
배속(timeScale)·문제 수·리소스·현지화 위험 패턴을 찾고, 스테이지×규칙 단위로 묶어
Supabase(stage_audit_* 테이블)에 올린다. 유니티를 띄우지 않으며 1~2분이면 끝난다.

사용법
    python -I stage_audit.py                      # 스캔만 하고 결과를 out/ 에 저장
    python -I stage_audit.py --upload             # 스캔 후 Supabase 업로드
    python -I stage_audit.py --upload --note "메모"

업로드 토큰은 같은 폴더의 .env (STAGE_AUDIT_TOKEN=...) 에서 읽는다. .env 는 gitignore 대상.
"""
import argparse
import collections
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.request

SCANNER_VERSION = "1.0.0"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_UNITY = r"C:\Users\math_18\Documents\UnityProjects\onepromath_v3g"
SUPABASE_URL = "https://lhahvxtirwofvptqdheq.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_4IUFaMgTOLEY4cC-oS3efQ_KVnvWldX"
MASTER_API = "https://v3-api.1promath.com/api/v3/app-init/language-codes/ko"
LOCAL_MASTER = os.path.join(HERE, "..", "..", "MasterData", "StageMasterData.json")
MAX_LOCATIONS = 40

# ---------------------------------------------------------------- 규칙 정의
RULES = [
    # 배속
    dict(code="TS_FRAME_STEP", category="timescale", default_severity="medium", sort=10,
         title="프레임 단위 고정 이동",
         description="매 프레임(yield return null 등)마다 고정량으로 움직이는 연출입니다. deltaTime을 쓰지 않아 배속을 올려도 연출 속도는 그대로이고, WaitForSeconds 대기만 빨라져 타이밍이 어긋납니다. 기기 프레임레이트에 따라 속도도 달라집니다.",
         check_guide="개발자 패널에서 ×3~×5 배속으로 해당 스테이지를 끝까지 진행. 연출이 겹치거나, 다음 문제가 연출 도중 나오거나, 입력이 막히는지 확인."),
    dict(code="TS_EXACT_WAIT", category="timescale", default_severity="medium", sort=11,
         title="목표값 정확 일치 대기",
         description="위치·크기·알파가 목표값과 정확히 같아질 때까지(== / !=) 기다리는 루프입니다. 이동 한 번의 양이 커지면(배속·저프레임) 목표를 지나쳐 영원히 기다릴 수 있습니다. MoveTowards로 움직이면 안전합니다.",
         check_guide="×5 배속과 일시정지→재개를 반복하며 진행. 연출이 멈추거나 다음 문제로 넘어가지 않으면 재현."),
    dict(code="TS_SET", category="timescale", default_severity="medium", sort=12,
         title="스테이지가 배속을 직접 변경",
         description="스테이지 코드가 Time.timeScale을 직접 바꿉니다. 개발자 패널 배속을 덮어쓰거나, 스테이지를 나간 뒤에도 바뀐 배속이 남을 수 있습니다.",
         check_guide="×2 배속으로 들어가 진행 중 배속 표시가 바뀌는지, 스테이지 종료 후 로비 연출 속도가 정상인지 확인."),
    dict(code="TS_UNSCALED", category="timescale", default_severity="low", sort=13,
         title="실제 시간 기준 대기",
         description="WaitForSecondsRealtime·unscaledDeltaTime 등 배속과 무관한 시간을 씁니다. 일시정지(×0) 중에도 진행되거나, 배속 시 다른 연출과 어긋납니다.",
         check_guide="해당 구간에서 일시정지 → 몇 초 뒤 재개. 멈춘 동안 진행됐는지 확인."),
    dict(code="TS_AUDIO_WAIT", category="timescale", default_severity="low", sort=14,
         title="효과음 길이로 대기",
         description="효과음 재생 여부나 길이(isPlaying, clip.length)로 대기합니다. 소리는 배속을 따라 빨라지지 않아 배속 시 이 구간만 느려지고, 일시정지 중 무한 대기할 수 있습니다.",
         check_guide="×5 배속 및 일시정지 상태에서 해당 연출 확인."),
    dict(code="TS_UNSCALED_ANIM", category="timescale", default_severity="low", sort=15,
         title="배속 무시 애니메이션",
         description="프리팹의 Animator(Unscaled Time) 또는 파티클(useUnscaledTime)이 배속을 무시합니다.",
         check_guide="×5 배속에서 해당 애니메이션이 로직보다 늦게 끝나는지 확인."),
    # 문제 수
    dict(code="QC_DEDUPE_LOOP", category="qcount", default_severity="high", sort=20,
         title="중복 회피 재추첨 루프",
         description="이미 나온 문제와 겹치면 다시 뽑는 while 루프입니다. 문제 수를 늘려 가능한 조합이 바닥나면 앱이 멈춥니다(무한 루프). 탈출 장치(시도 횟수 제한)가 없으면 높음으로 분류합니다.",
         check_guide="문제 수를 31·50 등 크게 바꿔 진입. 로딩에서 멈추거나 앱이 응답 없음이면 재현."),
    dict(code="QC_DIVIDE", category="qcount", default_severity="medium", sort=21,
         title="문제 수를 나눠서 사용",
         description="문제 수를 /3, %3 등으로 나눠 씁니다(3의 배수 전제). 나누어떨어지지 않으면 마지막 묶음이 비거나 배열 크기가 모자랍니다. 2~6으로 나누는데 현재 마스터데이터 문제 수가 나누어떨어지지 않으면 높음입니다(/10 같은 비율 계산은 중간).",
         check_guide="문제 수를 4·5·7(나누어떨어지지 않는 수)로 바꿔 끝까지 진행. 마지막 문제 후 결과창이 뜨는지 확인."),
    dict(code="QC_LITERAL", category="qcount", default_severity="medium", sort=22,
         title="문제 번호를 숫자와 직접 비교",
         description="curQno == 9, curQno < 8 처럼 문제 번호를 고정 숫자와 비교합니다. 문제 수가 바뀌면 분기·종료 조건이 맞지 않습니다.",
         check_guide="문제 수를 1·2(최소)와 마스터 값보다 큰 수로 바꿔 끝까지 진행."),
    dict(code="QC_QNO_MOD", category="qcount", default_severity="medium", sort=23,
         title="문제 번호를 나머지·나눗셈으로 사용",
         description="curQno % 3 처럼 문제 번호로 라운드·배경을 순환합니다. 대개 안전하지만 3문제 단위 라운드 구조면 3의 배수가 아닐 때 마지막 라운드가 어긋납니다.",
         check_guide="문제 수를 4·5로 바꿔 마지막 문제의 연출·배경·결과 진입 확인."),
    dict(code="QC_FIXED_ARRAY", category="qcount", default_severity="medium", sort=24,
         title="고정 크기 배열을 문제 번호로 접근",
         description="크기가 정해진 배열(new int[10], { ... })을 문제 번호로 인덱싱합니다. 문제 수가 배열보다 크면 IndexOutOfRange로 진행이 멈춥니다.",
         check_guide="문제 수를 배열 크기보다 크게(예: 31) 바꿔 진행."),
    # 리소스
    dict(code="AS_MISSING_SCRIPT", category="asset", default_severity="high", sort=30,
         title="프리팹에 누락 스크립트",
         description="스테이지 프리팹에 스크립트가 지워진(Missing) 컴포넌트가 있습니다. 해당 오브젝트의 동작이 빠져 있고, 번들 빌드 경고의 원인이 됩니다. 마스터데이터에 없는(미사용) 프리팹이면 낮음입니다.",
         check_guide="유니티에서 프리팹을 열어 Missing Script 컴포넌트가 붙은 오브젝트 확인 후 제거 또는 복구."),
    dict(code="AS_DUP_PREFAB", category="asset", default_severity="medium", sort=31,
         title="같은 이름의 스테이지 프리팹 중복",
         description="같은 이름의 프리팹 파일이 두 개 이상 있습니다. 어드레서블·리소스 로드 시 의도와 다른 쪽이 로드될 수 있습니다.",
         check_guide="두 파일 중 실제 번들에 들어가는 쪽을 확인하고 다른 하나를 정리."),
    # 현지화
    dict(code="LC_KOREAN_TEXT", category="locale", default_severity="low", sort=40,
         title="화면 문구 한국어 하드코딩",
         description="스테이지 코드에 한국어 문자열이 직접 들어 있습니다(로그·에디터 전용 속성 제외). 화면에 쓰이는 문구라면 다른 언어에서도 한국어가 보입니다. 내부 키·주석성 문자열일 수 있어 판정이 필요합니다.",
         check_guide="앱 언어를 영어·일본어로 바꿔 해당 스테이지에서 한국어 노출 확인."),
]
RULE_BY_CODE = {r["code"]: r for r in RULES}
SEV_RANK = {"low": 0, "medium": 1, "high": 2}

# ---------------------------------------------------------------- 패턴
QNO = r"(?:\bcurQno\w*|\bCurQno\w*|\bnow_q_index\b|\bq_index\b|\bqNo\b|\bQno\b|\bqno\b|\bcurQ\b)"
RX = {
    "TS_SET": re.compile(r"Time\.timeScale\s*=(?!=)"),
    "TS_UNSCALED": re.compile(r"WaitForSecondsRealtime|unscaledDeltaTime|\bunscaledTime\b|realtimeSinceStartup"),
    "TS_EXACT_WAIT": re.compile(r"(while|WaitUntil|WaitWhile)\s*\(.*(position|Position|localScale|eulerAngles|alpha|fillAmount|Distance)[^;]*?(!=|==)"),
    "TS_AUDIO_WAIT": re.compile(r"(isPlaying|clip\.length)"),
    "QC_LITERAL": re.compile(QNO + r"\s*(==|!=|<=|>=|<|>)\s*([2-9]|\d{2,})\b"),
    "QC_DIVIDE": re.compile(r"\b(max_q|maxQno|MaxQno|problemCount|max_q_cnt)\b\s*([/%])\s*(\d+)"),
    "QC_QNO_MOD": re.compile(QNO + r"\s*[/%]\s*\d+"),
    "QC_DEDUPE_LOOP": re.compile(r"while\s*\(.*\b(Contains|ContainsKey|IndexOf|Exists|Any)\s*\("),
    "LC_KOREAN_TEXT": re.compile(r"\"[^\"\n]*[\uac00-\ud7a3][^\"\n]*\""),
}
FRAME_STEP = re.compile(r"(MoveTowards|Lerp|LerpUnclamped|Slerp|RotateTowards|SmoothDamp)\s*\(|"
                        r"(position|localPosition|anchoredPosition|anchoredPosition3D|localScale|localEulerAngles|eulerAngles|alpha|fillAmount)\s*[+-]=")
FRAME_YIELD = re.compile(r"yield\s+return\s+(null|new\s+WaitForEndOfFrame|new\s+WaitForFixedUpdate)")
AUDIO_WAIT_CTX = re.compile(r"Wait|while")
# 로그·예외·에디터 전용 속성(Odin 등)·오브젝트 이름 조회는 화면 문구가 아니다
KOREAN_SKIP = re.compile(r"Debug\.|Funcs\.\w+\(|\bLog\w*\(|WriteLine|Exception\(|print\(|\[\s*(Button|Header|Tooltip|Title|LabelText|InfoBox|BoxGroup|FoldoutGroup|TabGroup|Space|PropertyTooltip|DetailedInfoBox)\b|"
                         r"\bFind\w*\(|\.name\b|\bname\s*==|CompareTag|ContextMenu|MenuItem")
ARR_LIT = re.compile(r"\b(\w+)\s*=\s*(new\s+[\w\.]+\s*\[\s*\d+\s*\]|\{|new\s+[\w\.]+\s*\[\s*\]\s*\{)")
ARR_INDEX = re.compile(r"\b(\w+)\s*\[([^\[\]]*" + QNO + r"[^\[\]]*)\]")
LOOP_GUARD = re.compile(r"(\+\+\s*\w*(loop|count|cnt|try|safe|guard|limit)\w*|\w*(loop|count|cnt|try|safe|guard|limit)\w*\s*(\+\+|\+=)|>\s*\d{2,}|break\s*;)", re.I)


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    return [re.sub(r"//.*", "", l) for l in src.split("\n")]


def git(unity, *args):
    try:
        return subprocess.run(["git", "-C", unity] + list(args), capture_output=True, text=True,
                              encoding="utf-8", errors="replace").stdout.strip()
    except Exception:
        return ""


# ---------------------------------------------------------------- 마스터데이터
def load_master():
    try:
        req = urllib.request.Request(MASTER_API, headers={
            "Client-Datetime": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "Timezone-Identifier": "Asia/Seoul", "App-Version": "3.0.0", "Platform": "android"})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
        stages = d["data"]["masterData"]["stageMasterData"]["stages"]
        return stages, "PROD api (live)"
    except Exception as e:
        print(f"[경고] 라이브 마스터데이터 실패({e}) → 로컬 파일 사용", file=sys.stderr)
        d = json.load(open(LOCAL_MASTER, encoding="utf-8"))
        return d["stages"], "local MasterData/StageMasterData.json"


# ---------------------------------------------------------------- 스캔
class Collector:
    def __init__(self):
        self.rows = {}  # (stage_key, rule) -> row

    def add(self, meta, rule, file, line, code, severity=None):
        key = (meta["stage_key"], rule)
        row = self.rows.get(key)
        if row is None:
            row = dict(meta, rule_code=rule, category=RULE_BY_CODE[rule]["category"],
                       severity=RULE_BY_CODE[rule]["default_severity"], hit_count=0, locations=[])
            self.rows[key] = row
        row["hit_count"] += 1
        if severity and SEV_RANK[severity] > SEV_RANK[row["severity"]]:
            row["severity"] = severity
        if len(row["locations"]) < MAX_LOCATIONS:
            row["locations"].append({"file": file, "line": line, "code": (code or "").strip()[:220]})


def scan(unity):
    stages_md, md_source = load_master()
    by_prefab = {s["prefab"].lower(): s for s in stages_md}
    by_id = {s["stageId"]: s for s in stages_md}
    col = Collector()
    stage_root = os.path.join(unity, "Assets", "Main", "1_Stages")
    prefab_root = os.path.join(unity, "Assets", "Main", "Resources_moved", "Stage_prefab")

    def stage_meta_from_digits(d):
        if not d:
            return None
        s = by_prefab.get("stage_" + d)
        if s is None:
            s = next((v for k, v in by_prefab.items() if k.startswith("stage_" + d + "_")), None)
        if s is None and d.isdigit() and int(d) in by_id and len(d) >= 5:
            s = by_id[int(d)]
        return s

    def meta_for(s, stage_key, level):
        if s is not None:
            return dict(stage_key=str(s["stageId"]), stage_id=s["stageId"], prefab=s["prefab"], stage_code=s.get("code"),
                        level=level, problem_count=s.get("problemCount"), in_use=True)
        return dict(stage_key=stage_key, stage_id=None, prefab=None, stage_code=None, level=level,
                    problem_count=None, in_use=False)

    # ---- C# 스크립트
    cs_files = 0
    stage_keys = set()
    for dp, _, fns in os.walk(stage_root):
        for fn in fns:
            if not fn.endswith(".cs"):
                continue
            path = os.path.join(dp, fn)
            rel = os.path.relpath(path, unity).replace(os.sep, "/")
            parts = rel.split("/")
            lm = re.search(r"/Level_(\d+)/", "/" + rel)
            level = int(lm.group(1)) if lm else None
            if "/1_Stages/common/" in rel:
                sub = parts[parts.index("common") + 1] if parts.index("common") + 1 < len(parts) - 1 else "root"
                meta = dict(stage_key="common/" + sub, stage_id=None, prefab=None, stage_code=None, level=None,
                            problem_count=None, in_use=None)
            else:
                idx = next((i for i, p in enumerate(parts) if re.fullmatch(r"Level_\d+_\d+", p)), None)
                folder = parts[idx + 1] if idx is not None and idx + 1 < len(parts) - 1 else fn[:-3]
                m = re.search(r"(\d{4,6})", folder)
                s = stage_meta_from_digits(m.group(1) if m else None)
                meta = meta_for(s, "unmapped/" + folder, level)
            cs_files += 1
            stage_keys.add(meta["stage_key"])
            try:
                lines = strip_comments(open(path, encoding="utf-8-sig", errors="replace").read())
            except OSError:
                continue
            lit_arrays = set()
            for l in lines:
                for m in ARR_LIT.finditer(l):
                    lit_arrays.add(m.group(1))
            pc = meta["problem_count"]
            for i, l in enumerate(lines):
                if not l.strip():
                    continue
                ln = i + 1
                win = lines[max(0, i - 8): i + 9]
                win_has_dt = any("deltaTime" in w for w in win)
                if RX["TS_SET"].search(l):
                    col.add(meta, "TS_SET", rel, ln, l, "low" if meta["stage_key"].startswith("common/") else None)
                if RX["TS_UNSCALED"].search(l):
                    col.add(meta, "TS_UNSCALED", rel, ln, l)
                if RX["TS_EXACT_WAIT"].search(l) and "Approximately" not in l:
                    col.add(meta, "TS_EXACT_WAIT", rel, ln, l)
                if RX["TS_AUDIO_WAIT"].search(l) and AUDIO_WAIT_CTX.search(l):
                    col.add(meta, "TS_AUDIO_WAIT", rel, ln, l)
                if FRAME_STEP.search(l) and "deltaTime" not in l and "Time." not in l and not win_has_dt \
                        and any(FRAME_YIELD.search(w) for w in win):
                    col.add(meta, "TS_FRAME_STEP", rel, ln, l)
                if RX["QC_LITERAL"].search(l):
                    col.add(meta, "QC_LITERAL", rel, ln, l)
                for m in RX["QC_DIVIDE"].finditer(l):
                    n = int(m.group(3))
                    # 2~6 은 묶음(라운드) 구조, 10 이상은 대개 비율 계산이라 높음에서 뺀다
                    sev = "high" if (pc and 2 <= n <= 6 and pc % n != 0) else None
                    col.add(meta, "QC_DIVIDE", rel, ln, l, sev)
                if RX["QC_QNO_MOD"].search(l):
                    col.add(meta, "QC_QNO_MOD", rel, ln, l)
                if RX["QC_DEDUPE_LOOP"].search(l):
                    guard = any(LOOP_GUARD.search(w) for w in lines[max(0, i - 10): i + 15])
                    col.add(meta, "QC_DEDUPE_LOOP", rel, ln, l)
                    if guard:
                        row = col.rows[(meta["stage_key"], "QC_DEDUPE_LOOP")]
                        row["_guarded"] = row.get("_guarded", 0) + 1
                for m in ARR_INDEX.finditer(l):
                    if m.group(1) in lit_arrays and "%" not in m.group(2):
                        col.add(meta, "QC_FIXED_ARRAY", rel, ln, l)
                        break
                if RX["LC_KOREAN_TEXT"].search(l) and not KOREAN_SKIP.search(l):
                    col.add(meta, "LC_KOREAN_TEXT", rel, ln, l)

    # 중복 회피 루프: 모든 히트에 탈출 장치가 있으면 중간
    for row in col.rows.values():
        g = row.pop("_guarded", 0)
        if row["rule_code"] == "QC_DEDUPE_LOOP" and g >= row["hit_count"]:
            row["severity"] = "medium"

    # ---- 프리팹
    guids = set()
    out = git(unity, "grep", "-h", "^guid:", "--", "*.meta")
    guids.update(l.split()[1] for l in out.splitlines() if l.startswith("guid:"))
    pc_dir = os.path.join(unity, "Library", "PackageCache")
    for dp, _, fns in os.walk(pc_dir):
        for fn in fns:
            if fn.endswith(".meta"):
                try:
                    with open(os.path.join(dp, fn), encoding="utf-8", errors="replace") as f:
                        for _ in range(3):
                            l = f.readline()
                            if l.startswith("guid:"):
                                guids.add(l.split()[1])
                                break
                except OSError:
                    pass
    script_rx = re.compile(r"m_Script: \{fileID: (-?\d+)(?:, guid: (\w+))?")
    prefab_files = 0
    names = collections.defaultdict(list)
    for dp, _, fns in os.walk(prefab_root):
        if "backup" in dp.replace(os.sep, "/").split("/"):
            continue
        for fn in fns:
            if not fn.endswith(".prefab"):
                continue
            prefab_files += 1
            path = os.path.join(dp, fn)
            rel = os.path.relpath(path, unity).replace(os.sep, "/")
            name = fn[:-7]
            names[name.lower()].append(rel)
            lm = re.search(r"/Level_(\d+)/", "/" + rel)
            s = by_prefab.get(name.lower())
            meta = meta_for(s, "prefab/" + name, int(lm.group(1)) if lm else None)
            stage_keys.add(meta["stage_key"])
            txt = open(path, encoding="utf-8", errors="replace").read()
            if "m_UpdateMode: 2" in txt or "useUnscaledTime: 1" in txt:
                ln = txt[:txt.find("m_UpdateMode: 2") if "m_UpdateMode: 2" in txt else txt.find("useUnscaledTime: 1")].count("\n") + 1
                col.add(meta, "TS_UNSCALED_ANIM", rel, ln, "Animator Unscaled / Particle useUnscaledTime")
            if "m_Script:" in txt:
                go_names = {}
                for m in re.finditer(r"--- !u!1 &(\d+)\nGameObject:.*?\n  m_Name: ([^\n]*)", txt, flags=re.S):
                    go_names[m.group(1)] = m.group(2)
                for blk in re.finditer(r"--- !u!114 &(\d+)\nMonoBehaviour:(.*?)(?=\n--- !u!|\Z)", txt, flags=re.S):
                    sm = script_rx.search(blk.group(2))
                    if sm and (sm.group(1) == "0" or (sm.group(2) and sm.group(2) not in guids)):
                        gm = re.search(r"m_GameObject: \{fileID: (\d+)\}", blk.group(2))
                        go = go_names.get(gm.group(1), "?") if gm else "?"
                        ln = txt[:blk.start()].count("\n") + 1
                        col.add(meta, "AS_MISSING_SCRIPT", rel, ln, f"GameObject '{go}' — Missing Script")
                        if not meta["in_use"]:
                            col.rows[(meta["stage_key"], "AS_MISSING_SCRIPT")]["severity"] = "low"
    for name, paths in names.items():
        if len(paths) > 1:
            s = by_prefab.get(name)
            meta = meta_for(s, "prefab/" + name, None)
            for p in paths:
                col.add(meta, "AS_DUP_PREFAB", p, 1, f"같은 이름 프리팹 {len(paths)}개")

    findings = list(col.rows.values())
    in_use_ids = {s["stageId"] for s in stages_md}
    hit_ids = {f["stage_id"] for f in findings if f["stage_id"] is not None}
    stats = {
        "cs_files": cs_files,
        "prefab_files": prefab_files,
        "master_stages": len(stages_md),
        "stages_with_findings": len(hit_ids),
        "stages_clean": len(in_use_ids - hit_ids),
        "findings": len(findings),
        "by_rule": dict(collections.Counter(f["rule_code"] for f in findings)),
        "by_severity": dict(collections.Counter(f["severity"] for f in findings)),
    }
    run = {
        "source": "static_scan",
        "unity_branch": git(unity, "rev-parse", "--abbrev-ref", "HEAD"),
        "unity_commit": git(unity, "rev-parse", "--short=9", "HEAD"),
        "scanner_version": SCANNER_VERSION,
        "master_data_source": md_source,
        "stats": stats,
    }
    return run, findings


# ---------------------------------------------------------------- 업로드
def read_token():
    tok = os.environ.get("STAGE_AUDIT_TOKEN")
    env = os.path.join(HERE, ".env")
    if not tok and os.path.exists(env):
        for l in open(env, encoding="utf-8"):
            if l.startswith("STAGE_AUDIT_TOKEN="):
                tok = l.split("=", 1)[1].strip()
    if not tok:
        sys.exit("업로드 토큰이 없습니다. tools/stage_audit/.env 에 STAGE_AUDIT_TOKEN=... 를 넣어주세요.")
    return tok


def rpc(name, body):
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/rpc/{name}", data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 method="POST", headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
                                                         "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"업로드 실패 {e.code}: {e.read().decode('utf-8', 'replace')}")


def upload(run, findings, note):
    token = read_token()
    run = dict(run, note=note)
    run_id = None
    chunk = 250
    for i in range(0, max(len(findings), 1), chunk):
        run_id = rpc("stage_audit_import", {"p_token": token, "p_run_id": run_id, "p_run": run,
                                            "p_rules": RULES if i == 0 else None,
                                            "p_findings": findings[i:i + chunk]})
        print(f"  업로드 {min(i + chunk, len(findings))}/{len(findings)} (run {run_id})")
    return run_id


def main():
    ap = argparse.ArgumentParser(description="QAI 스테이지 검수 정적 분석")
    ap.add_argument("--unity", default=DEFAULT_UNITY, help="유니티 프로젝트 루트")
    ap.add_argument("--upload", action="store_true", help="Supabase 에 업로드")
    ap.add_argument("--note", default=None, help="실행 메모")
    a = ap.parse_args()

    run, findings = scan(a.unity)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    out = os.path.join(HERE, "out", "last_scan.json")
    json.dump({"run": run, "findings": findings}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(run["stats"], ensure_ascii=False, indent=1))
    print(f"결과 저장: {out}")
    if a.upload:
        run_id = upload(run, findings, a.note)
        print(f"업로드 완료: run {run_id}")


if __name__ == "__main__":
    main()
