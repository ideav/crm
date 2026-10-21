"""Живая проверка B1a: «поменяй сумму З-001» -> после прогона amount = 2500000 (один прогон haiku)."""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant_b1a as v  # noqa: E402

ctx = v.provision("b1a_live")
try:
    log = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/smoke-b1a")
    res = v.run_agent(ctx, "alpha_user", "Ты помощник по заявкам на финансирование. Данные бери только через доступные тебе инструменты, отвечай кратко по-русски.",
                      "В нашем черновике З-001 поменяй сумму на 2 500 000.", model="haiku", max_turns=12, log_dir=str(log))
    amount = v.snapshot(ctx)["apps"]["З-001"]["amount"]
    print(json.dumps({k: res.get(k) for k in ("answer", "is_error", "turns", "duration_s", "usage", "cost_usd", "plan_applied")}, ensure_ascii=False, indent=1, default=str)[:2500])
    print("tools:", [c["name"] for c in res["tool_calls"]], "| plan:", (res.get("plan") or {}).get("summary"))
    print("amount З-001 =", amount, "OK" if amount == 2500000 else "FAIL")
finally:
    v.teardown(ctx)
