"""Сводка замера python2node#1060: T1 — покрытие проб и цена сборки, T2 — доля верных ответов и правок.

  python3 integ/analyze.py integ/results/run-<дата> [--rerun]

--rerun пересчитывает вердикты текущими пробами: T1 — по снимкам собранных баз (i60*_r<N>), правки T2 —
по снимкам i60*_e<K>_<N>, вопросы T2 — по сохранённому ответу агента и эталону <env>-t2-truth.json.
Без --rerun берутся вердикты из rep.json. Пишет <dir>/summary.json и <dir>/README.md.
"""
import argparse
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import probes_integ as PI  # noqa: E402

ENVS = [("b", "B"), ("a1", "A′"), ("a2", "A″")]


def tokens(u: dict) -> int:
    return sum((u or {}).get(k, 0) for k in ("input_tokens", "cache_creation_input_tokens", "output_tokens"))


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 1) if xs else None


def rerun(rep: dict, d: Path) -> dict:
    import run_integ as RI
    kind = rep["env"]
    if rep["stage"] == "t1":
        probes = PI.run_probes(RI.work(kind), rep["snapshot"], PI.T1)
        rep.update(probes=probes, **RI.summary_t1(probes))
    else:
        truth = json.loads((d / f"{kind}-t2-truth.json").read_text("utf-8"))
        rep.update(RI.verdict_t2(kind, rep["task"], rep.get("answer", ""), rep.get("snapshot"), truth))
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--rerun", action="store_true")
    args = ap.parse_args()
    d = Path(args.dir)
    reps = []
    for f in sorted(d.glob("*/rep.json")):
        rep = json.loads(f.read_text("utf-8"))
        if args.rerun:
            rep = rerun(rep, d)
        reps.append(rep)
    t1 = [r for r in reps if r["stage"] == "t1"]
    t2 = [r for r in reps if r["stage"] == "t2"]
    cost = lambda r: {"turns": r["turns"], "tokens": tokens(r.get("usage")), "duration_s": r["duration_s"],  # noqa: E731
                      "cost_usd": r.get("cost_usd"), "env_calls": r.get("env_calls"), "iterations": r.get("iterations"),
                      "done": r.get("done"), "timeout": r.get("timeout")}
    out = {"t1": [{"env": r["env"], "rep": r["rep"], "coverage": r["coverage"], "passed": r["passed"],
                   "total": r["total"], "failed": r["failed"], "config": r.get("config"), **cost(r)} for r in t1],
           "t2": [{"env": r["env"], "rep": r["rep"], "task": r["task"], "success": r["success"],
                   "failed": r.get("failed") or r.get("missing"), **cost(r)} for r in t2]}
    (d / "summary.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")

    lines = ["# Сводка замера python2node#1060", "",
             "Вердикты — по пробам и эталонным значениям (`integ/probes_integ.py`), заявление агента не считается.", "",
             "## T1 — приложение «Договоры»: медиана по сборкам", "",
             "| среда | сборок | пробы, медиана из 11 | L | A | R | S | ходы | вызовы среды | итерации | токены | время, с | $ |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for kind, label in ENVS:
        rs = [r for r in out["t1"] if r["env"] == kind]
        if not rs:
            continue
        groups = [f"{sum(1 for r in rs if r['coverage'].get(g))}/{len(rs)}" for g in PI.T1_GROUPS]
        lines.append(f"| {label} | {len(rs)} | {med([r['passed'] for r in rs])} | " + " | ".join(groups) +
                     f" | {med([r['turns'] for r in rs])} | {med([r['env_calls'] for r in rs])} | "
                     f"{med([r['iterations'] for r in rs])} | {med([r['tokens'] for r in rs])} | "
                     f"{med([r['duration_s'] for r in rs])} | {med([r['cost_usd'] for r in rs])} |")
    lines += ["", "Группы проб: L — юрист создаёт и правит договоры, читает заявки; A — заявитель видит только "
              "договоры своей компании и не меняет их; R — значения отчёта совпадают с эталоном; S — после смены "
              "лимита и названия в источнике отчёт показывает новое. В ячейке — в скольких сборках группа закрыта.", "",
              "## T2 — задачи по сквозным данным: верно / прогонов и медианы", "",
              "| задача | " + " | ".join(label for _, label in ENVS) + " |",
              "|---|" + "---|" * len(ENVS)]
    for task in PI.T2_TASKS:
        cells = []
        for kind, _ in ENVS:
            rs = [r for r in out["t2"] if r["env"] == kind and r["task"] == task]
            cells.append("—" if not rs else f"{sum(r['success'] for r in rs)}/{len(rs)}; ходы {med([r['turns'] for r in rs])}, "
                         f"токены {med([r['tokens'] for r in rs])}, {med([r['duration_s'] for r in rs])} с")
        lines.append(f"| {task} | " + " | ".join(cells) + " |")
    totals = []
    for kind, label in ENVS:
        rs = [r for r in out["t2"] if r["env"] == kind]
        if rs:
            totals.append(f"{label}: {sum(r['success'] for r in rs)}/{len(rs)} верно, медиана ходов "
                          f"{med([r['turns'] for r in rs])}, токенов {med([r['tokens'] for r in rs])}, "
                          f"времени {med([r['duration_s'] for r in rs])} с")
    lines += ["", "Итого T2: " + ("; ".join(totals) or "прогонов нет") + ".", "", "## По прогонам", ""]
    for r in out["t1"]:
        lines.append(f"- T1 {r['env']}-{r['rep']}: {r['passed']}/{r['total']}, не прошли: {', '.join(r['failed']) or '—'}")
    for r in out["t2"]:
        lines.append(f"- T2 {r['env']}-{r['task']}-{r['rep']}: {'верно' if r['success'] else 'неверно'}"
                     f"{'' if r['success'] else ' (' + ', '.join(map(str, r['failed'] or [])) + ')'}")
    (d / "README.md").write_text("\n".join(lines) + "\n", "utf-8")
    print(f"→ {d / 'README.md'}")


if __name__ == "__main__":
    main()
