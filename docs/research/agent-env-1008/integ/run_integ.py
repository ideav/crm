"""Раннер замера python2node#1060 (integ/PROTOCOL.md): T1 — сборка «Договоров», T2 — 10 задач по сквозным данным.

  python3 integ/run_integ.py --env b --stage prepare                       # снимки start, t1, t2
  python3 integ/run_integ.py --env b --stage t1 --reps 5 --out integ/results/run-<дата>
  python3 integ/run_integ.py --env b --stage t2 --reps 5 --out integ/results/run-<дата> [--tasks Q1,E3]
  python3 integ/run_integ.py --env b --stage t1 --reference --out integ/results/validate-<дата>   # без LLM

--reference вместо агента применяет эталон (T1 — integ/reference.py, T2 — правку или ответ эталона) и
рядом прогоняет пробы на нетронутом старте: пробы должны быть зелёными на эталоне и красными без него.

Снимки: B — таблицы ядра i60b_*, A′ — базы i60a1_* кластера crm1055a, A″ — i60a2_* в crm1055a и crm1055c.
A′ и A″ работают с одной базой app стенда crm1055a: их прогоны идут по очереди, B — параллельно с ними.
Готовый прогон (rep.json) повторно не запускается; на лимите подписки раннер останавливается (код 3).
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs_integ as EI  # noqa: E402
import probes_integ as PI  # noqa: E402
import reference as REF  # noqa: E402

E = EI.E
sys.path.insert(0, str(EI.EFFORT))
import run_build as RB  # noqa: E402

SYSTEM_T1 = ("Ты — инженер, который строит приложение в своей среде. Работай только доступными инструментами. "
             "Проверяй сделанное запросами от имени разных пользователей. Вопросов не задавай: отвечать некому. "
             "Закончив, напиши «ГОТОВО» и коротко, что сделано.")
SYSTEM_T2 = ("Ты — инженер поддержки приложений фонда. Работай только доступными инструментами. Вопросов не "
             "задавай: отвечать некому. Закончив, напиши «ГОТОВО» и ответ на вопрос или что изменено.")
PREFIX = {"b": "i60b", "a1": "i60a1", "a2": "i60a2"}
LIVE_B = "i60bl"
ENV_HEAD = {"b": "## Среда B", "a1": "## Среда A′", "a2": "## Среда A″"}


def snap(kind: str, name: str) -> str:
    return f"{PREFIX[kind]}_{name}"


def live(kind: str):
    return EI.env(kind, LIVE_B if kind == "b" else None)


def work(kind: str):
    return EI.env(kind, "i60bw" if kind == "b" else None)


# --- тексты задач ------------------------------------------------------------------------------

def sections(path: Path) -> dict:
    """«## Заголовок» → текст раздела (с заголовком)."""
    out, cur = {}, None
    for line in path.read_text("utf-8").splitlines(keepends=True):
        if line.startswith("## "):
            cur = line[3:].strip()
            out[cur] = ""
        if cur:
            out[cur] += line
    return out


def env_section(kind: str, secs: dict) -> str:
    key = next(k for k in secs if ("## " + k).startswith(ENV_HEAD[kind]))
    text = secs[key]
    if kind == "a2":
        reg = EI.RegistryEnv()
        text = text.replace("{CRM_READER_DSN}", f"host=crm1055c-db port=5432 dbname=registry user=crm_reader "
                                                f"password={reg.env_file['READER_PASSWORD']}")
    return text.strip()


def task_t1(kind: str) -> str:
    secs = sections(HERE / "TASK_T1.md")
    return "\n\n".join(secs[k].strip() for k in ("Что уже есть", "Задача")) + "\n\n" + env_section(kind, secs) + "\n"


def task_t2(kind: str, task: str) -> str:
    secs = sections(HERE / "TASKS_T2.md")
    body = secs[task].split("\n", 1)[1].strip()
    return (secs["Общая часть"].strip() + "\n\n## Задача\n\n" + body + "\n\n" + env_section(kind, secs) + "\n")


# --- подготовка снимков ------------------------------------------------------------------------

def prepare(kind: str):
    """start — стартовый набор; t1 — эталон T1; t2 — эталон T1 + договоры integ/seed.py."""
    env = live(kind)
    env.deploy("start")
    env.ready()
    env.save(snap(kind, "start"))
    REF.t1(env)
    env.save(snap(kind, "t1"))
    env.force_contracts(EI.S.CONTRACTS)
    env.save(snap(kind, "t2"))
    print(f"{kind}: снимки {snap(kind, 'start')}, {snap(kind, 't1')}, {snap(kind, 't2')}", flush=True)


def restore(kind: str, src: str):
    env = live(kind)
    env.clone(src)
    if kind == "b":
        env.ready()
    return env


def mcp_db(kind: str) -> str:
    return LIVE_B if kind == "b" else E.PgrstEnv.WORK


# --- T1 ----------------------------------------------------------------------------------------

def summary_t1(probes: list) -> dict:
    return {"coverage": PI.coverage(probes), "passed": sum(PI.passed(p) for p in probes), "total": len(probes),
            "failed": [p["id"] for p in probes if not PI.passed(p)]}


def t1_rep(kind: str, n: int, out: Path, args):
    rep = out / f"{kind}-t1-{n}"
    if (rep / "rep.json").exists():
        return
    restore(kind, snap(kind, "start"))
    res = RB.run_agent(kind, mcp_db(kind), task_t1(kind), rep, args.model, args.max_turns or 300,
                       args.timeout or 3600, system=SYSTEM_T1)
    built = snap(kind, f"r{n}")
    live(kind).save(built)
    res["snapshot"] = built
    res["config"] = RB.config_size(kind, RB.config_state(kind, snap(kind, "start")), RB.config_state(kind, built))
    res["probes"] = PI.run_probes(work(kind), built, PI.T1)
    res.update(summary_t1(res["probes"]))
    res.update(env=kind, rep=n, stage="t1", model=args.model)
    (rep / "rep.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), "utf-8")
    print(f"  {rep.name}: ходов {res['turns']}, {res['duration_s']} с, пробы {res['passed']}/{res['total']}, "
          f"группы {[g for g, v in res['coverage'].items() if v]}", flush=True)


def t1_reference(kind: str, out: Path):
    """Пробы T1 на нетронутом старте и на эталоне."""
    result = {}
    w = work(kind)
    result["start"] = PI.run_probes(w, snap(kind, "start"), PI.T1)
    result["reference"] = PI.run_probes(w, snap(kind, "t1"), PI.T1)
    path = out / f"validate-{kind}-t1.json"
    path.write_text(json.dumps({k: {**summary_t1(v), "probes": v} for k, v in result.items()},
                               ensure_ascii=False, indent=1, default=str), "utf-8")
    for k, v in result.items():
        s = summary_t1(v)
        print(f"{kind} T1 {k:9}: {s['passed']}/{s['total']} проб, группы закрыты "
              f"{[g for g, ok in s['coverage'].items() if ok]}; не прошли {s['failed']}", flush=True)
    return result


# --- T2 ----------------------------------------------------------------------------------------

def t2_truth(kind: str, out: Path) -> dict:
    """Эталоны ответов Q1–Q4 — из данных старта T2 этой среды."""
    path = out / f"{kind}-t2-truth.json"
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    w = work(kind)
    w.clone(snap(kind, "t2"))
    state = w.state()
    w.drop()
    truth = {t: [[k, str(v)] for k, v in PI.q_expected(t, state)] for t in PI.T2_TASKS if t.startswith("Q")}
    path.write_text(json.dumps({"state": state, "report": PI.truth(state), "answers": truth},
                               ensure_ascii=False, indent=1), "utf-8")
    return json.loads(path.read_text("utf-8"))


def verdict_t2(kind: str, task: str, answer: str, snapshot: str, truth: dict) -> dict:
    if task.startswith("Q"):
        ok, missing = PI.answer_ok(answer, truth["answers"][task])
        return {"success": ok, "missing": missing, "expected": truth["answers"][task]}
    probes = PI.run_probes(work(kind), snapshot, PI.T2_PROBES[task])
    return {"success": all(PI.passed(p) for p in probes), "probes": probes,
            "failed": [p["id"] for p in probes if not PI.passed(p)]}


def t2_rep(kind: str, task: str, n: int, out: Path, args, truth: dict):
    rep = out / f"{kind}-t2-{task}-{n}"
    if (rep / "rep.json").exists():
        return
    restore(kind, snap(kind, "t2"))
    res = RB.run_agent(kind, mcp_db(kind), task_t2(kind, task), rep, args.model, args.max_turns or 80,
                       args.timeout or 900, system=SYSTEM_T2)
    built = None
    if task.startswith("E"):
        built = snap(kind, f"{task.lower()}_{n}")
        live(kind).save(built)
    res.update(verdict_t2(kind, task, res["answer"], built, truth))
    res.update(env=kind, rep=n, stage="t2", task=task, model=args.model, snapshot=built)
    (rep / "rep.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), "utf-8")
    print(f"  {rep.name}: {'верно' if res['success'] else 'НЕВЕРНО'}, ходов {res['turns']}, {res['duration_s']} с",
          flush=True)


def t2_reference(kind: str, out: Path, tasks: list) -> dict:
    """Каждая задача: без правки (старт T2) и с эталонной правкой или эталонным ответом."""
    truth = t2_truth(kind, out)
    result = {}
    for task in tasks:
        r = {}
        for mode in ("start", "reference"):
            answer, built = "", None
            if task.startswith("E"):
                env = restore(kind, snap(kind, "t2"))
                if mode == "reference":
                    REF.fix(env, task)
                built = snap(kind, f"v_{task.lower()}")
                env.save(built)
            elif mode == "reference":
                answer = REF.answer(task, [(k, float(v) if k == "num" else v) for k, v in truth["answers"][task]])
            v = verdict_t2(kind, task, answer, built, truth)
            v["answer"] = answer
            r[mode] = v
            if built:
                live(kind).drop_snapshot(built)
        result[task] = r
        print(f"{kind} T2 {task}: старт {'зелёный' if r['start']['success'] else 'красный'}"
              f"{'' if r['start']['success'] else ' ' + str(r['start'].get('failed') or r['start'].get('missing'))}; "
              f"эталон {'зелёный' if r['reference']['success'] else 'красный ' + str(r['reference'].get('failed') or r['reference'].get('missing'))}",
              flush=True)
    (out / f"validate-{kind}-t2.json").write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str),
                                                  "utf-8")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["b", "a1", "a2"], required=True)
    ap.add_argument("--stage", choices=["prepare", "t1", "t2"], required=True)
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--first", type=int, default=1)
    ap.add_argument("--tasks", default=",".join(PI.T2_TASKS))
    ap.add_argument("--out", default=str(HERE / "results" / f"run-{datetime.date.today():%Y%m%d}"))
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--max-turns", type=int, default=0, help="по умолчанию T1 — 300, T2 — 80")
    ap.add_argument("--timeout", type=int, default=0, help="секунд; по умолчанию T1 — 3600, T2 — 900")
    ap.add_argument("--reference", action="store_true", help="эталон вместо агента: проверка проб")
    args = ap.parse_args()
    if args.stage == "prepare":
        prepare(args.env)
        return 0
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tasks = [t for t in args.tasks.split(",") if t]
    if args.reference:
        t1_reference(args.env, out) if args.stage == "t1" else t2_reference(args.env, out, tasks)
        return 0
    truth = t2_truth(args.env, out) if args.stage == "t2" else None
    for n in range(args.first, args.first + args.reps):
        print(f"{args.env}-{args.stage}-{n}", flush=True)
        try:
            if args.stage == "t1":
                t1_rep(args.env, n, out, args)
            else:
                for task in tasks:
                    t2_rep(args.env, task, n, out, args, truth)
        except RB.Quota as e:
            print(f"СТОП: лимит подписки claude — {e}", flush=True)
            return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
