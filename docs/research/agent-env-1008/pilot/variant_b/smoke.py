"""Проверки адаптеров B0/B1 на песочнице (без LLM, а с --live — по одному прогону haiku на вариант).

    python3 pilot/variant_b/smoke.py            # provision/snapshot/параллельность/teardown
    python3 pilot/variant_b/smoke.py --live B0,B1 [--out /tmp/smoke-b]
"""
import argparse
import json
import re
import sys
import threading
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant_b as vb  # noqa: E402

F = vb.F

INSTRUCTIONS = ("Ты помощник по заявкам на финансирование. Данные бери только через доступные тебе инструменты, "
                "отвечай кратко по-русски.")
TASK = "Сколько у меня черновиков?"


def check(name, ok, detail=""):
    print(f"{'OK  ' if ok else 'FAIL'} {name} {detail}")
    return ok


def offline() -> bool:
    ok = True
    v = vb.make("B0")
    ctx = v.provision("smoke1")
    snap = v.snapshot(ctx)
    ref = F.App({u: "x" for u, _, _ in F.USERS}, seed=1008)
    ok &= check("snapshot: 9 заявок", len(snap["apps"]) == 9, f"({len(snap['apps'])})")
    same = all(snap["apps"][a["number"]]["amount"] == a["amount"] and snap["apps"][a["number"]]["company"] == a["company"]
               and snap["apps"][a["number"]]["status"] == a["status"] for a in ref.apps)
    ok &= check("snapshot: суммы, компании, статусы как в funding.App", same,
                f"сумма={sum(a['amount'] for a in snap['apps'].values())} эталон={sum(a['amount'] for a in ref.apps)}")
    ok &= check("snapshot: колонки и extra", snap["app_columns"] == ["Компания", "Статус", "Сумма", "Выручка",
                "Описание проекта", "Эксперт", "Заключение эксперта"] and all(a["extra"] == {} for a in snap["apps"].values()))
    ok &= check("snapshot: компании", set(snap["companies"]) == {"alpha", "beta", "gamma"})
    v.teardown(ctx)
    ok &= check("teardown: базы нет", vb.P.mysql(f"SHOW TABLES LIKE '{ctx['db'].replace('_', chr(92) + '_')}'") == [])

    ctxs = {}
    spec = {"pa": {"З-001": {"text": "ПЕРВАЯ", "amount": 111}}, "pb": {"З-001": {"text": "ВТОРАЯ", "status": "Подана"}}}
    ths = [threading.Thread(target=lambda n=n: ctxs.__setitem__(n, v.provision("smoke_" + n, spec[n]))) for n in spec]
    [t.start() for t in ths]
    [t.join() for t in ths]
    a, b = (v.snapshot(ctxs[n])["apps"]["З-001"] for n in ("pa", "pb"))
    ok &= check("параллельно: базы раздельны", (a["text"], a["amount"], a["status"]) == ("ПЕРВАЯ", 111, "Черновик")
                and (b["text"], b["status"]) == ("ВТОРАЯ", "Подана") and b["amount"] == snap["apps"]["З-001"]["amount"])
    for c in ctxs.values():
        v.teardown(c)
    ok &= check("teardown: обе базы удалены", vb.P.mysql("SHOW TABLES LIKE 'rb\\_smoke\\_%'") == [])
    return ok


def live(variant: str, out: Path) -> bool:
    v = vb.make(variant)
    ctx = v.provision(f"live_{variant.lower()}")
    try:
        log_dir = out / variant
        res = v.run_agent(ctx, "alpha_user", INSTRUCTIONS, TASK, model="haiku", max_turns=8, log_dir=str(log_dir))
        tools = [c["name"] for c in res["tool_calls"]]
        ok = check(f"{variant}: без ошибки", not res["is_error"], f"turns={res['turns']} {res['duration_s']}с")
        ok &= check(f"{variant}: агент ходил через инструменты", bool(tools), str(tools))
        ans = res["answer"]
        ok &= check(f"{variant}: ответ — ровно 1 черновик", bool(re.search(r"(?<!\d)1(?!\d)|один|одн", ans))
                    and "З-001" in ans and not re.search(r"З-00[47]", ans), repr(ans[:200]))
        print(f"{variant}: usage={res['usage']} cost_usd={res['cost_usd']}")
        api = [json.loads(x) for x in (log_dir / "api.jsonl").read_text("utf-8").splitlines() if x.strip()]
        print(f"{variant}: api.jsonl — {len(api)} запросов к ядру, пользователи {sorted({r['user'] for r in api})}, "
              f"методы {sorted({r['m'] + ' ' + r['path'].split('/')[2] for r in api if len(r['path'].split('/')) > 2})}")
        (log_dir / "result.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), "utf-8")
        return ok
    finally:
        if not out.joinpath("keep").exists():
            v.teardown(ctx)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", default="")
    ap.add_argument("--out", default="/tmp/smoke-b")
    args = ap.parse_args()
    ok = True
    if args.live:
        for var in args.live.split(","):
            ok &= live(var, Path(args.out))
    else:
        ok = offline()
    sys.exit(0 if ok else 1)
