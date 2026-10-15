"""
QAI 스테이지 검수 — 문제 수 안전 범위 업로드

판정 노트에서 정리한 스테이지별 안전 범위 JSON 을 stage_audit_count_limits 에 올린다
(stage_audit_set_count_limits RPC, run 단위 upsert).

입력 항목: {stage_id, stage_code, level, prefab, server_count, safe_values[], safe_text, live,
           server_at_limit, conditions[], summary, fixed_note?}

사용법
    python -I upload_count_limits.py <run_id> limits.json
"""
import json
import os
import sys

# python -I 는 스크립트 폴더를 import 경로에서 빼므로 직접 넣는다
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stage_audit import read_token, rpc  # noqa: E402


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    run_id = int(sys.argv[1])
    items = json.load(open(sys.argv[2], encoding="utf-8"))
    for it in items:
        bad = [v for v in it.get("safe_values", []) if not (1 <= int(v) <= 50)]
        if bad:
            sys.exit(f"stage {it.get('stage_id')}: safe_values 범위 밖 값 {bad}")
    token = read_token()
    done = 0
    for i in range(0, len(items), 200):
        done += rpc("stage_audit_set_count_limits", {"p_token": token, "p_run_id": run_id, "p_items": items[i:i + 200]})
    print(f"안전 범위 {len(items)}건 중 {done}건 반영 (run {run_id})")


if __name__ == "__main__":
    main()
