"""
QAI 판정 결과 업로드

판정 결과 JSON 파일([{"id", "ai_verdict", "ai_note"}, ...])을 읽어
stage_audit_findings 의 ai_verdict / ai_note 를 갱신한다 (stage_audit_set_verdicts RPC).

사용법
    python -I upload_verdicts.py results_1.json results_2.json ...
"""
import json
import os
import sys

# python -I 는 스크립트 폴더를 import 경로에서 빼므로 직접 넣는다
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stage_audit import read_token, rpc  # noqa: E402

VERDICTS = {"미판정", "문제 있음", "의심", "문제 없음"}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    items = {}
    for path in sys.argv[1:]:
        for it in json.load(open(path, encoding="utf-8")):
            if it.get("ai_verdict") not in VERDICTS:
                sys.exit(f"{path}: id {it.get('id')} 판정값이 올바르지 않습니다: {it.get('ai_verdict')!r}")
            items[int(it["id"])] = {"id": int(it["id"]), "ai_verdict": it["ai_verdict"],
                                    "ai_note": (it.get("ai_note") or "").strip() or None}
    token = read_token()
    rows = list(items.values())
    done = 0
    for i in range(0, len(rows), 200):
        done += rpc("stage_audit_set_verdicts", {"p_token": token, "p_items": rows[i:i + 200]})
    print(f"판정 {len(rows)}건 중 {done}건 반영")


if __name__ == "__main__":
    main()
