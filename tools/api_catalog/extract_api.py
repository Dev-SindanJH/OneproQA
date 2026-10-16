"""클라이언트 API 정의·호출처·씬 참조를 정적으로 뽑는다.
usage: python -I extract_api.py <unity_project_root> <out.json>
"""
import json, os, re, sys
from collections import defaultdict

ROOT = sys.argv[1]
OUT = sys.argv[2]
ASSETS = os.path.join(ROOT, "Assets")
API_FILE = os.path.join(ASSETS, "Main", "Script", "CommonAPI.cs")

SKIP_DIRS = ("Assets/Tests", "Assets/Editor", "Assets/QAI", "Assets/Plugins", "Assets/VFX", "Assets/JMO Assets",
             "Assets/GooglePlayPlugins", "Assets/Main/ESSET")


def rel(p):
    return os.path.relpath(p, ROOT).replace("\\", "/")


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


# ---------------- 1. API 정의 ----------------
src = read(API_FILE)
lines = src.split("\n")
apis = {}  # class -> {base, members: {name: {...}}}
cls_re = re.compile(r"^\s*public class (API_\w+)\s*:\s*(APIBase_v3|APIBase)")
cur = None
for i, ln in enumerate(lines):
    m = cls_re.match(ln)
    if m:
        cur = m.group(1)
        apis[cur] = {"kind": m.group(2), "base": "", "members": {}, "line": i + 1}
        continue
    if cur is None:
        continue
    m = re.search(r'Domain\s*=>\s*\$?"([^"]*)"', ln)
    if m:
        apis[cur]["base"] = "/api/v3" + m.group(1)
    m = re.search(r'CommonValue\s*=>\s*"([^"]*)"', ln)
    if m:
        apis[cur]["base"] = m.group(1)
    # 멤버: public string Name => / public string Name(
    m = re.match(r"^\s*public string (\w+)\s*(\(([^)]*)\)?)?\s*(=>)?", ln)
    if m and m.group(1) not in ("GetAPI",):
        name = m.group(1)
        # 정의 블록: 다음 public string / class 까지
        block = [ln]
        for j in range(i + 1, min(i + 40, len(lines))):
            if re.match(r"^\s*public (string|class|enum|abstract)|^\s*}\s*$", lines[j]) and not lines[j].strip().startswith("{"):
                if re.match(r"^\s*public", lines[j]):
                    break
            block.append(lines[j])
            if re.match(r"^\s{8}}\s*$", lines[j]):
                break
        text = "\n".join(block)
        urls = re.findall(r'\$"(\{BasePath\}[^"]*)"', text)
        urls += re.findall(r'\$"(/[^"]*)"', text) if not urls else []
        cm = re.search(r"//\s*(.+)$", ln)
        comment = cm.group(1).strip() if cm else ""
        if not comment and i > 0:
            pm = re.search(r"//\s*(.+)$", lines[i - 1])
            if pm:
                comment = pm.group(1).strip()
        base = apis[cur]["base"]
        paths = []
        for u in urls:
            u = u.replace("{BasePath}", base)
            u = re.sub(r"\{G_UserInfo\.Instance\.(\w+)\}", lambda mm: "{" + mm.group(1)[0].lower() + mm.group(1)[1:] + "}", u)
            u = re.sub(r"\{Uri\.EscapeDataString\((\w+)\)\}", r"{\1}", u)
            u = re.sub(r"\{LocalizationStaticManager\.GetCurrentLanguageCode\(\)\}", "{languageCode}", u)
            u = re.sub(r"\{(\w+)\.Value\}", r"{\1}", u)
            u = re.sub(r"\{G_UserInfo\.Instance\.Info\.MainProfile\.(\w+)\}", r"{\1}", u)
            paths.append(u)
        apis[cur]["members"][name] = {"paths": paths, "comment": comment, "line": i + 1, "params": (m.group(3) or "").strip()}

# enum 기반(IApi) GetAPI case → 경로
for cname, info in apis.items():
    if info["kind"] != "APIBase":
        continue
    start = info["line"]
    for j in range(start, min(start + 60, len(lines))):
        m = re.match(r"^\s*case Type\.(\w+):", lines[j])
        if m:
            nxt = lines[j + 1]
            bm = re.search(r"BuildUrl\((.*)\);", nxt)
            p = ""
            if bm:
                args = re.findall(r'\$?"([^"]*)"|inputData\[(\d)\]', bm.group(1))
                parts = [a if a else "{input" + b + "}" for a, b in args]
                p = info["base"] + "/" + "/".join(parts)
                p = re.sub(r"\{inputData\[(\d)\]\}", r"{input\1}", p)
            info["members"]["Type." + m.group(1)] = {"paths": [p], "comment": "", "line": j + 1, "params": ""}
        if j > start + 5 and re.match(r"^\s{4}}\s*$", lines[j]):
            break

# ---------------- 2. 호출처 ----------------
call_re = re.compile(r"Api\.Get<(API_\w+)>\(\)\s*\.\s*(\w+)(?:\(\s*(API_\w+\.Type\.\w+))?")
http_re = re.compile(r"Method\.(GET|POST|PUT|PATCH|DELETE)")
meth_re = re.compile(r"^\s*(?:\[[^\]]*\]\s*)?(?:(?:public|private|protected|internal|static|async|override|virtual|IEnumerator|void|Task|UniTask)\b[\w<>\[\],\s]*?)\s(\w+)\s*\([^;]*$")
class_re = re.compile(r"\b(?:class|struct)\s+(\w+)")

calls = []
cs_files = []
for dp, dn, fn in os.walk(ASSETS):
    r = rel(dp)
    if any(r.startswith(s) for s in SKIP_DIRS):
        continue
    for f in fn:
        if f.endswith(".cs"):
            cs_files.append(os.path.join(dp, f))

for p in cs_files:
    if os.path.samefile(p, API_FILE):
        continue
    t = read(p)
    if "Api.Get<API_" not in t:
        continue
    ls = t.split("\n")
    in_block = False
    for i, ln in enumerate(ls):
        s = ln.strip()
        if in_block:
            if "*/" in s:
                in_block = False
            continue
        if s.startswith("/*") and "*/" not in s:
            in_block = True
            continue
        code = ln.split("//")[0] if not s.startswith("//") else ""
        if not code:
            continue
        for m in call_re.finditer(code):
            api, member, enum_arg = m.group(1), m.group(2), m.group(3)
            if member == "GetAPI" and enum_arg:
                member = "Type." + enum_arg.split(".")[-1]
            window = "\n".join(ls[max(0, i - 3): i + 4])
            hm = http_re.findall(window)
            # 둘러싼 메서드
            method = ""
            for k in range(i, max(0, i - 400), -1):
                mm = meth_re.match(ls[k])
                if mm and mm.group(1) not in ("if", "for", "foreach", "while", "switch", "using", "return", "new", "catch", "lock"):
                    method = mm.group(1)
                    break
            cname = ""
            for k in range(i, -1, -1):
                cm = class_re.search(ls[k])
                if cm and not ls[k].strip().startswith("//"):
                    cname = cm.group(1)
                    break
            calls.append({"api": api, "member": member, "file": rel(p), "line": i + 1, "method": method,
                          "class": cname, "http": sorted(set(hm)), "code": s[:240]})

# ---------------- 3. 씬·프리팹 참조 ----------------
guid_re = re.compile(r"guid: ([0-9a-f]{32})")
script_guid = {}
for p in cs_files:
    mp = p + ".meta"
    if os.path.exists(mp):
        m = re.search(r"guid: ([0-9a-f]{32})", read(mp))
        if m:
            script_guid[rel(p)] = m.group(1)

asset_refs = {}  # path -> set(guids)
asset_guid = {}  # guid -> path (scene/prefab)
for dp, dn, fn in os.walk(ASSETS):
    r = rel(dp)
    if any(r.startswith(s) for s in ("Assets/VFX", "Assets/JMO Assets", "Assets/GooglePlayPlugins", "Assets/Plugins", "Assets/Main/ESSET")):
        continue
    for f in fn:
        if f.endswith(".unity") or f.endswith(".prefab"):
            p = os.path.join(dp, f)
            asset_refs[rel(p)] = set(guid_re.findall(read(p)))
            mp = p + ".meta"
            if os.path.exists(mp):
                m = re.search(r"guid: ([0-9a-f]{32})", read(mp))
                if m:
                    asset_guid[m.group(1)] = rel(p)

# 프리팹 → 그 프리팹을 직접/중첩 포함하는 씬
prefab_parents = defaultdict(set)  # prefab path -> assets that reference it
for ap, gs in asset_refs.items():
    for g in gs:
        tp = asset_guid.get(g)
        if tp and tp.endswith(".prefab") and tp != ap:
            prefab_parents[tp].add(ap)


def scenes_of(asset, seen=None):
    seen = seen or set()
    if asset in seen:
        return set()
    seen.add(asset)
    if asset.endswith(".unity"):
        return {asset}
    out = set()
    for par in prefab_parents.get(asset, ()):
        out |= scenes_of(par, seen)
    return out


usage = {}
for f in {c["file"] for c in calls}:
    g = script_guid.get(f)
    direct_scenes, prefabs = set(), set()
    if g:
        for ap, gs in asset_refs.items():
            if g in gs:
                (direct_scenes if ap.endswith(".unity") else prefabs).add(ap)
    via = set()
    for pf in prefabs:
        via |= scenes_of(pf)
    usage[f] = {"guid": g, "scenes": sorted(direct_scenes), "prefabs": sorted(prefabs), "scenes_via_prefab": sorted(via - direct_scenes)}

# ---------------- 4. 씬 이동 흐름 ----------------
# LoadingManager.LoadNextScene(SceneName.X) 코드 호출 + SceneName 을 직렬화한 컴포넌트(SceneLoadBtn, GameCenter_v3 등)
enum_src = read(os.path.join(ASSETS, "Main", "Script", "Common_SceneName_List.cs"))
enum_body = enum_src[enum_src.index("enum SceneName"):]
enum_body = enum_body[:enum_body.index("}")]
scene_by_value = {int(v): n for n, v in re.findall(r"(\w+)\s*=\s*(\d+)", enum_body)}
scene_files = {os.path.splitext(os.path.basename(a))[0]: a for a in asset_refs if a.endswith(".unity")}


def owner_scenes(file_rel):
    g = script_guid.get(file_rel)
    out = set()
    if g:
        for ap, gs in asset_refs.items():
            if g in gs:
                out |= {ap} if ap.endswith(".unity") else scenes_of(ap)
    return sorted({os.path.splitext(os.path.basename(x))[0] for x in out}) or ["공통"]


flows = []
load_re = re.compile(r"LoadNextScene\(\s*(?:Common_SceneName_List\.)?SceneName\.(\w+)")
for p in cs_files:
    t = read(p)
    if "LoadNextScene(" not in t:
        continue
    fr = rel(p)
    srcs = None
    for i, ln in enumerate(t.split("\n")):
        if ln.strip().startswith("//"):
            continue
        for m in load_re.finditer(ln.split("//")[0]):
            if m.group(1) not in scene_files:
                continue
            srcs = srcs or owner_scenes(fr)
            for s_ in srcs:
                if s_ != m.group(1):
                    flows.append({"from": s_, "to": m.group(1), "file": fr, "line": i + 1, "kind": "code"})

ser_scripts = {}
for p in cs_files:
    t = read(p)
    if re.search(r"SceneName\s+sceneName\s*;", t) and rel(p) in script_guid:
        ser_scripts[script_guid[rel(p)]] = rel(p)
for ap, gs in asset_refs.items():
    hit = gs & set(ser_scripts)
    if not hit:
        continue
    text = read(os.path.join(ROOT, ap))
    srcs = [os.path.splitext(os.path.basename(ap))[0]] if ap.endswith(".unity") else \
        sorted({os.path.splitext(os.path.basename(x))[0] for x in scenes_of(ap)})
    for doc in text.split("--- !u!"):
        gm = re.search(r"m_Script: \{fileID: \d+, guid: ([0-9a-f]{32})", doc)
        if not gm or gm.group(1) not in hit:
            continue
        for v in re.findall(r"\bsceneName: (\d+)", doc):
            to = scene_by_value.get(int(v))
            if to not in scene_files:
                continue
            for s_ in srcs:
                if s_ != to:
                    flows.append({"from": s_, "to": to, "file": ap, "line": 0, "kind": "button:" + os.path.basename(ser_scripts[gm.group(1)])})

json.dump({"apis": apis, "calls": calls, "usage": usage, "flows": flows}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
n_members = sum(len(a["members"]) for a in apis.values())
used = {(c["api"], c["member"]) for c in calls}
print(f"api classes={len(apis)} members={n_members} calls={len(calls)} files={len(usage)} used_members={len(used)}")
unused = [(a, m) for a, info in apis.items() for m in info["members"] if (a, m) not in used]
print("unused:", unused)
unknown = sorted({(c['api'], c['member']) for c in calls if c['member'] not in apis.get(c['api'], {}).get('members', {})})
print("unknown members:", unknown)
print(f"scene flows={len(flows)} edges={len({(f['from'], f['to']) for f in flows})}")
