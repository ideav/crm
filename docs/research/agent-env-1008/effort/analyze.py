"""Сводка замера python2node#1055: пересчёт проб по снимкам собранных баз и таблицы итога.

Запускать после прогонов: пробы A′ пишут в базу app, с которой работает агент.
  python3 effort/analyze.py effort/results/build-<дата> [--no-rerun]

Вердикты берутся из повторного прогона текущих проб (probes.py, changes.py) по снимкам
(B: e1055b<N>k[x1|x2|x3], A′: app_b<N>[x1|x2|x3]), R11/R13 B — из rep.json (b_channel.py).
Пишет <dir>/summary.json и <dir>/README.md.
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import changes as C  # noqa: E402
import probes as PR  # noqa: E402
import run_build as RB  # noqa: E402

RISKS = [f"R{i}" for i in range(1, 14)]
STAGES = ["build", "X1", "X2", "X3"]


def snap_name(kind: str, n: int, stage: str) -> str:
    base = f"e1055b{n}k" if kind == "b" else f"app_b{n}"
    return base if stage == "build" else base + stage.lower()


def rerun(kind: str, n: int, stage: str) -> list:
    plan = PR.PROBES if stage == "build" else C.PROBES[stage] + PR.PROBES
    return RB.run_probes(kind, snap_name(kind, n, stage), plan)


def tokens(u: dict) -> int:
    return sum(u.get(k, 0) for k in ("input_tokens", "cache_creation_input_tokens", "output_tokens"))


def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--no-rerun", action="store_true")
    args = ap.parse_args()
    d = Path(args.dir)
    reps = []
    for f in sorted(d.glob("*/rep.json")):
        rep = json.loads(f.read_text("utf-8"))
        kind, n = rep["env"], rep["rep"]
        for st in STAGES:
            if st not in rep:
                continue
            s = rep[st]
            channel = [p for p in s["probes"] if p["risk"] in ("R11", "R13")]
            probes = s["probes"] if args.no_rerun else rerun(kind, n, st) + channel
            s["probes_final"] = probes
            s["coverage_final"] = PR.coverage([p for p in probes if p["verdict"] != "NO-MECHANISM"])
            if kind == "a1":
                s["coverage_final"].update({"R11": None, "R13": None})  # нет механизма — решение владельца
        reps.append(rep)
        print(f"{kind}-{n}: {[k for k, v in rep['build']['coverage_final'].items() if v]}", flush=True)

    out = {"reps": [{"env": r["env"], "rep": r["rep"], **{st: {
        "coverage": r[st]["coverage_final"], "config": r[st]["config"], "turns": r[st]["turns"],
        "duration_s": r[st]["duration_s"], "tokens": tokens(r[st]["usage"]), "cost_usd": r[st]["cost_usd"],
        "iterations": r[st]["iterations"], "env_calls": r[st]["env_calls"], "done": r[st]["done"],
        "failed": [p["id"] for p in r[st]["probes_final"] if p["verdict"] not in ("held", "ok", "NO-MECHANISM")]}
        for st in STAGES if st in r}} for r in reps]}
    (d / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")

    lines = ["# Сводка замера python2node#1055", "",
             "Вердикты — по пробам на снимках собранных баз (`analyze.py`), заявление агента не считается.", "",
             "## Риски: в скольких сборках закрыт", "", "| риск | B | A′ |", "|---|---|---|"]
    by = {k: [r for r in out["reps"] if r["env"] == k] for k in ("b", "a1")}
    for risk in RISKS:
        cells = []
        for k in ("b", "a1"):
            vals = [r["build"]["coverage"].get(risk) for r in by[k]]
            cells.append("нет механизма" if vals and all(v is None for v in vals)
                         else f"{sum(1 for v in vals if v)}/{len(vals)}")
        lines.append(f"| {risk} | {cells[0]} | {cells[1]} |")
    lines += ["", "## Цена: медиана по сборкам", "",
              "| этап | среда | закрыто рисков / правка | ходы | вызовы среды | итерации | токены | время, с | конфигурация |",
              "|---|---|---|---|---|---|---|---|---|"]
    for st in STAGES:
        for k in ("b", "a1"):
            rs = [r[st] for r in by[k] if st in r]
            if not rs:
                continue
            closed = med([sum(1 for kk, v in x["coverage"].items() if v and kk.startswith("R")) for x in rs])
            extra = "" if st == "build" else f" / {sum(1 for x in rs if x['coverage'].get(st))} из {len(rs)}"
            cfg = med([x["config"].get("rows", x["config"].get("lines_added")) for x in rs])
            lines.append(f"| {st} | {'B' if k == 'b' else 'A′'} | {closed}{extra} | {med([x['turns'] for x in rs])} | "
                         f"{med([x['env_calls'] for x in rs])} | {med([x['iterations'] for x in rs])} | "
                         f"{med([x['tokens'] for x in rs])} | {med([x['duration_s'] for x in rs])} | {cfg} |")
    lines += ["", "Конфигурация: B — строки ядра (гранты, маски, атрибуты, роли), A′ — добавленные строки "
              "`pg_dump --schema-only`.", "", "## По сборкам", ""]
    for r in out["reps"]:
        b = r["build"]
        lines.append(f"- **{'B' if r['env'] == 'b' else 'A′'}-{r['rep']}**: закрыто "
                     f"{', '.join(k for k, v in b['coverage'].items() if v) or '—'}; не прошли пробы: "
                     f"{', '.join(b['failed']) or '—'}; правки: "
                     + ", ".join(f"{st} {'да' if r[st]['coverage'].get(st) else 'нет'}" for st in STAGES[1:] if st in r))
    (d / "README.md").write_text("\n".join(lines) + "\n", "utf-8")
    print(f"→ {d / 'README.md'}")


if __name__ == "__main__":
    main()
