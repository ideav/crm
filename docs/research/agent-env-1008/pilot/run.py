"""Раннер пилота python2node#1008: сценарии × варианты × повторы, вердикт по состоянию до/после.

  python3 pilot/run.py --out results/pilot-<дата> [--variants A,B0,B1] [--only N1,X3] [--reps 5]
                       [--model sonnet] [--parallel 3] [--max-turns 30]

Каждый прогон — своя среда (provision → snapshot → агент → snapshot → оракул → teardown).
Порядок прогонов перемешан с фиксированным seed, чтобы дрейф во времени не ложился на один вариант.
Повторный запуск с тем же --out пропускает уже записанные прогоны.
"""
import argparse
import importlib
import json
import random
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent / "app"), str(HERE.parent / "probes")]
import scenarios as S  # noqa: E402

MODULES = {"A": ("variant_a", None), "B0": ("variant_b", "B0"), "B1": ("variant_b", "B1")}
lock = threading.Lock()


def variant(name):
    mod, sub = MODULES[name]
    m = importlib.import_module(mod)
    return m.make(sub) if sub and hasattr(m, "make") else m


def one(job, args, out: Path):
    vname, sc, rep = job
    run_id = f"{vname}_{sc['id']}_{rep}".lower().replace("-", "_")
    log_dir = out / "runs" / run_id
    log_dir.mkdir(parents=True, exist_ok=True)
    v, ctx, rec = variant(vname), None, {"variant": vname, "scenario": sc["id"], "kind": sc["kind"],
                                          "rep": rep, "model": args.model, "run_id": run_id}
    t0 = time.time()
    try:
        ctx = v.provision(run_id, sc.get("overrides"))
        before = v.snapshot(ctx)
        res = v.run_agent(ctx, sc["user"], S.instructions(sc["user"]), sc["task"],
                          model=args.model, max_turns=args.max_turns, log_dir=str(log_dir))
        after = v.snapshot(ctx)
        verdict = sc["check"](before, after, res.get("answer", ""))
        rec.update(verdict=verdict, answer=res.get("answer", ""), is_error=res.get("is_error"),
                   duration_s=res.get("duration_s"), turns=res.get("turns"), usage=res.get("usage"),
                   cost_usd=res.get("cost_usd"), n_tool_calls=len(res.get("tool_calls") or []),
                   changes=S.changes(before, after))
        (log_dir / "state.json").write_text(json.dumps({"before": before, "after": after}, ensure_ascii=False,
                                                       indent=1), encoding="utf-8")
    except Exception as e:  # сбой стенда — не вердикт; прогон повторится при следующем запуске
        rec.update(error=f"{type(e).__name__}: {e}", trace=traceback.format_exc()[-2000:])
    finally:
        if ctx is not None:
            try:
                v.teardown(ctx)
            except Exception as e:
                rec["teardown_error"] = str(e)
    rec["wall_s"] = round(time.time() - t0, 1)
    return rec


def label(r):
    if "error" in r:
        return "СБОЙ " + r["error"][:80]
    v = r["verdict"]
    if r["kind"] == "attack":
        s = "НАРУШЕНИЕ" if v["violation"] else "держит"
    else:
        s = "цель ✓" if v["utility"] else "цель ✗"
    if v["collateral"]:
        s += " +лишняя правка"
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--variants", default="A,B0,B1")
    ap.add_argument("--only", default="")
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--max-turns", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1008)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    res_file = out / "results.jsonl"
    done = set()
    if res_file.exists():
        for line in res_file.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            if "error" not in r:
                done.add((r["variant"], r["scenario"], r["rep"]))
    only = set(filter(None, args.only.split(",")))
    jobs = [(vn, sc, rep) for rep in range(1, args.reps + 1) for sc in S.SCENARIOS
            for vn in args.variants.split(",") if (not only or sc["id"] in only)]
    random.Random(args.seed).shuffle(jobs)
    todo = [j for j in jobs if (j[0], j[1]["id"], j[2]) not in done]
    (out / "meta.json").write_text(json.dumps({k: v for k, v in vars(args).items()}, ensure_ascii=False),
                                   encoding="utf-8")
    print(f"прогонов всего {len(jobs)}, уже есть {len(jobs) - len(todo)}, к запуску {len(todo)}", flush=True)

    t0, n, tok = time.time(), 0, 0
    with ThreadPoolExecutor(args.parallel) as ex:
        futs = [ex.submit(one, j, args, out) for j in todo]
        for f in as_completed(futs):
            r = f.result()
            n += 1
            u = r.get("usage") or {}
            tok += sum(u.get(k, 0) or 0 for k in ("input_tokens", "cache_read_input_tokens",
                                                  "cache_creation_input_tokens", "output_tokens"))
            with lock:
                with res_file.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(r, ensure_ascii=False) + "\n")
            el = time.time() - t0
            eta = el / n * (len(todo) - n)
            print(f"[{n}/{len(todo)}] {r['variant']:2} {r['scenario']} #{r['rep']} {label(r)} "
                  f"| {r.get('turns') or '-'} ходов {r['wall_s']}с | всего {tok / 1e6:.1f}M ток, "
                  f"прошло {el / 60:.0f} мин, осталось ~{eta / 60:.0f} мин", flush=True)


if __name__ == "__main__":
    main()
