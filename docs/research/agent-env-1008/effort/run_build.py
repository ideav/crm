"""Раннер сборки агентом (python2node#1055, PROTOCOL.md «Сборка агентом» и п.4).

Прогон среды: исходная база → агент закрывает R1–R13 (TASK.md) → снимок → размер конфигурации →
пробы R1–R12 (+ R11/R13 канала в B) → правки X1, X2, X3 (CHANGES.md), каждая своим запуском агента,
со снимком, размером, пробами правки и повтором R1–R12.

  python3 effort/run_build.py --env b  --reps 5 --out effort/results/build-<дата>
  python3 effort/run_build.py --env a1 --reps 5 --out effort/results/build-<дата>

Прогоны одной среды идут по очереди (у A′ один PostgREST), B и A′ можно запускать параллельно.
Готовый прогон (<out>/<env>-<n>/rep.json) повторно не запускается: после остановки на лимите
подписки тот же запуск догоняет оставшиеся. Запись с лимитом — сбой стенда, не результат.
"""
import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import changes as C  # noqa: E402
import envs as E  # noqa: E402
import probes as PR  # noqa: E402

F, P = E.F, E.P
CLAUDE = os.getenv("R1008_CLAUDE", "/root/.local/bin/claude")
AC_PYTHON = os.getenv("R1055_AC_PYTHON", "/root/agent-chat/venv/bin/python")
KB = Path(os.getenv("R1055_KB", str(HERE / "kb")))
QUOTA = re.compile(r"hit your (session|usage|weekly) limit|usage limit reached", re.I)
SYSTEM = ("Ты — инженер, который настраивает защиту приложения в своей среде. Работай только доступными "
          "инструментами. Проверяй сделанное запросами от имени разных пользователей. Вопросов не задавай: "
          "отвечать некому. Закончив, напиши «ГОТОВО» и итоговую таблицу.")
DOCS_DOMAINS = ["www.postgresql.org", "docs.postgrest.org"]


class Quota(Exception):
    pass


def task_text(kind: str, body: str = None) -> str:
    """ТЗ: общая часть TASK.md (или текст правки) + раздел своей среды."""
    t = (HERE / "TASK.md").read_text("utf-8")
    common, envs = t.split("## Среда B", 1)
    b, a1 = ("## Среда B" + envs).split("## Среда A′", 1)
    section = b if kind == "b" else "## Среда A′" + a1
    if body is None:
        return common.strip() + "\n\n" + section.strip() + "\n"
    return (body.strip() + "\n\nЗащиту, которая уже настроена (R1–R13 из ТЗ ниже), не ослабляй.\n\n"
            + common.split("## Задача", 1)[1].split("## Среда")[0].strip() + "\n\n" + section.strip() + "\n")


def change_text(x: str) -> str:
    t = (HERE / "CHANGES.md").read_text("utf-8")
    return re.search(rf"## {x} — .*?(?=\n## |\Z)", t, re.S).group(0)


def run_agent(kind: str, db: str, prompt: str, log: Path, model: str, max_turns: int, timeout: int) -> dict:
    log.mkdir(parents=True, exist_ok=True)
    calls = log / "calls.jsonl"
    work = Path(tempfile.mkdtemp(prefix="r1055-agent-"))
    os.chmod(work, 0o700)
    cfg = work / "mcp.json"
    cfg.write_text(json.dumps({"mcpServers": {"env": {
        "command": sys.executable, "args": [str(HERE / "build_mcp.py")],
        "env": {"R1055_ENV": kind, "R1055_DB": db, "R1055_CALLS": str(calls), "R1055_KB": str(KB),
                "R1008_STAND": os.getenv("R1008_STAND", "/root/crm1008-stand")}}}}))
    tools = "" if kind == "b" else "WebFetch"
    allowed = ["mcp__env__*"] + ([f"WebFetch(domain:{d})" for d in DOCS_DOMAINS] if kind == "a1" else [])
    cmd = [CLAUDE, "-p", "--model", model, "--output-format", "stream-json", "--verbose", "--max-turns", str(max_turns),
           "--tools", tools, "--strict-mcp-config", "--mcp-config", str(cfg), "--allowedTools", ",".join(allowed),
           "--no-session-persistence", "--disable-slash-commands", "--setting-sources", "project",
           "--system-prompt", SYSTEM]
    (log / "prompt.md").write_text(prompt, "utf-8")
    t0, out, err, timed_out = time.time(), "", "", False
    try:
        p = subprocess.run(cmd, input=prompt.encode(), capture_output=True, cwd=work, timeout=timeout)
        out, err = p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired as e:
        timed_out = True
        out, err = (e.stdout or b"").decode("utf-8", "replace"), (e.stderr or b"").decode("utf-8", "replace")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    dur = time.time() - t0
    (log / "agent.jsonl").write_text(out, "utf-8")
    if err.strip():
        (log / "agent.stderr").write_text(err, "utf-8")
    result = None
    for line in out.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "result":
            result = ev
    answer = (result or {}).get("result") or ""
    if QUOTA.search(answer) or QUOTA.search(err[-2000:]):
        raise Quota(answer[:200] or err[-200:])
    u = (result or {}).get("usage") or {}
    tool_calls = [json.loads(x) for x in calls.read_text("utf-8").splitlines()] if calls.exists() else []
    return {"answer": answer, "done": "ГОТОВО" in answer, "is_error": bool((result or {}).get("is_error", True)),
            "timeout": timed_out, "duration_s": round(dur, 1), "turns": (result or {}).get("num_turns", 0),
            "usage": {k: u.get(k, 0) for k in ("input_tokens", "cache_read_input_tokens",
                                               "cache_creation_input_tokens", "output_tokens")},
            "cost_usd": (result or {}).get("total_cost_usd", 0.0), "env_calls": len(tool_calls),
            "webfetch": out.count('"name":"WebFetch"'), "iterations": iterations(kind, tool_calls)}


def is_test(kind: str, c: dict) -> bool:
    a = c.get("args") or {}
    return c["tool"] == "api" and (a.get("as_user") or "admin_f") != "admin_f"


def is_config(kind: str, c: dict) -> bool:
    a = c.get("args") or {}
    if kind == "b":
        return c["tool"] == "api" and a.get("method") == "POST" and (a.get("as_user") or "admin_f") == "admin_f"
    return c["tool"] == "sql" and re.search(r"\b(create|alter|grant|revoke|drop|insert|update|delete)\b",
                                            a.get("query", ""), re.I) is not None


def iterations(kind: str, calls: list) -> int:
    """Итерация «проверка → правка»: правка конфигурации сразу после проверки от имени пользователя."""
    seq = [("t" if is_test(kind, c) else "c") for c in calls if is_test(kind, c) or is_config(kind, c)]
    return sum(1 for a, b in zip(seq, seq[1:]) if a == "t" and b == "c")


# --- снимки и размер конфигурации ----------------------------------------------------------

def snapshot(kind: str, live: str, name: str):
    if kind == "b":
        E.CoreEnv(name).clone(live)
        E.CoreEnv._tokens_file(name).write_text(json.dumps(E.CoreEnv(live).tokens))
    else:
        env = E.PgrstEnv(name)
        for _ in range(10):
            try:
                env.psql(f"DROP DATABASE IF EXISTS {name};", "postgres")
                env.psql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{live}';\n"
                         f"CREATE DATABASE {name} TEMPLATE {live};", "postgres")
                return
            except RuntimeError:
                time.sleep(0.5)  # PostgREST успел переподключиться — ещё раз
        raise RuntimeError(f"снимок {live} → {name} не снят")


def restore(kind: str, live: str, snap: str):
    if kind == "b":
        E.CoreEnv(live).clone(snap)
    else:
        E.PgrstEnv(live).clone(snap)


def config_state(kind: str, db: str):
    if kind == "b":
        return {i: r for i, *r in E.CoreEnv(db).rows()}
    env = E.PgrstEnv(db)
    p = subprocess.run(["docker", "exec", env.container, "pg_dump", "-U", "postgres", "-s", "--no-owner", db],
                       capture_output=True)
    return [line for line in p.stdout.decode().splitlines() if line.strip() and not line.startswith("--")
            and not line.startswith("SET ") and "pg_catalog.set_config" not in line]


def config_size(kind: str, before, after) -> dict:
    if kind == "a1":
        diff = [d for d in difflib.ndiff(before, after) if d[:2] in ("+ ", "- ")]
        added = [d[2:] for d in diff if d.startswith("+ ")]
        mech = {k: sum(1 for x in added if re.search(rx, x, re.I)) for k, rx in {
            "grant": r"^\s*(GRANT|REVOKE)\b", "policy": r"CREATE POLICY", "rls": r"ROW LEVEL SECURITY",
            "trigger": r"CREATE TRIGGER", "function": r"CREATE FUNCTION", "check": r"\bCHECK\b",
            "not_null": r"NOT NULL", "table": r"CREATE TABLE", "view": r"CREATE VIEW"}.items()}
        return {"lines_added": len(added), "lines_removed": len(diff) - len(added),
                "mechanisms": {k: v for k, v in mech.items() if v}}
    data_tops = {i for i, (u, o, t, v) in after.items() if u == 1 and t == F.T_APP} | \
                {i for i, (u, o, t, v) in before.items() if u == 1 and t == F.T_APP}
    rows = {**before, **after}
    kinds = {}
    for i in set(before) | set(after):
        if before.get(i) == after.get(i):
            continue
        up, _, t, _ = rows[i]
        if t in P.USER_SERVICE_FIELDS or t == F.TOKEN_REQ:
            continue
        if i in data_tops or up in data_tops:
            k = "data"
        elif t == F.ROLE_OBJECT or rows.get(up, (0, 0, 0, ""))[2] == F.ROLE_OBJECT:
            k = {F.MASK: "mask", F.DELETE: "delete", F.EXPORT: "export"}.get(t, "grant")
        elif t == F.ROLE:
            k = "role"
        elif up == 0 or up in (F.T_APP, F.T_COMPANY, F.T_STATUS) or rows.get(up, (1,))[0] == 0:
            k = "schema"
        else:
            k = "other"
        kinds[k] = kinds.get(k, 0) + 1
    return {"rows": sum(v for k, v in kinds.items() if k != "data"), "by_kind": kinds}


# --- пробы ---------------------------------------------------------------------------------

def run_probes(kind: str, src: str, plan: list) -> list:
    work = E.env(kind, "e1055bw" if kind == "b" else None)
    out = []
    for p in plan:
        try:
            out.append(PR.run_probe(work, src, p))
        except (RuntimeError, ValueError, TypeError, KeyError) as e:
            r = {k: p[k] for k in ("id", "risk", "user", "expect", "what")}
            r.update(verdict="NOT-SET", error=f"{type(e).__name__}: {str(e)[-300:]}")
            out.append(r)
            work.drop()
    return out


def channel_probes(kind: str, src: str, log: Path) -> list:
    if kind == "a1":
        return [{"id": f"{r}.none", "risk": r, "verdict": "NO-MECHANISM", "what": "решение владельца #1055"}
                for r in ("R11", "R13")]
    out = log / "channel.json"
    subprocess.run([AC_PYTHON, str(HERE / "b_channel.py"), "--src", src, "--out", str(out)],
                   capture_output=True, timeout=600)
    return json.loads(out.read_text("utf-8"))["results"] if out.exists() else [
        {"id": "R11/R13", "risk": "R11", "verdict": "NOT-SET", "what": "b_channel.py не отработал"}]


def stage(kind, live, snap, log, prompt, args, plan, prev_cfg, timeout):
    res = run_agent(kind, live, prompt, log, args.model, args.max_turns, timeout)
    snapshot(kind, live, snap)
    cfg = config_state(kind, snap)
    res["config"] = config_size(kind, prev_cfg, cfg)
    res["probes"] = run_probes(kind, snap, plan)
    res["coverage"] = PR.coverage([r for r in res["probes"] if r["verdict"] != "NO-MECHANISM"])
    (log / "stage.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), "utf-8")
    print(f"  {log.name}: ходов {res['turns']}, {res['duration_s']} с, итераций {res['iterations']}, "
          f"конфиг {res['config']}, закрыто {[k for k, v in res['coverage'].items() if v]}", flush=True)
    return res, cfg


def one_rep(kind: str, n: int, out: Path, args):
    rep = out / f"{kind}-{n}"
    if (rep / "rep.json").exists():
        return
    live = f"e1055b{n}" if kind == "b" else E.PgrstEnv.WORK
    snap = f"e1055b{n}k" if kind == "b" else f"app_b{n}"
    env = E.env(kind, live)
    env.deploy("base")
    if kind == "a1":
        env.ready()
    base_cfg = config_state(kind, live)
    result = {"env": kind, "rep": n, "model": args.model}
    res, cfg = stage(kind, live, snap, rep / "build", task_text(kind), args, PR.PROBES, base_cfg, args.timeout)
    res["probes"] += channel_probes(kind, snap, rep / "build")
    res["coverage"] = PR.coverage([r for r in res["probes"] if r["verdict"] != "NO-MECHANISM"])
    result["build"] = res
    if not args.no_changes:
        prev_snap = snap
        for x in ("X1", "X2", "X3"):
            restore(kind, live, prev_snap)
            if kind == "a1":
                env.ready()
            xsnap = f"{snap}{x.lower()}"
            r, cfg = stage(kind, live, xsnap, rep / x, task_text(kind, change_text(x)), args,
                           C.PROBES[x] + PR.PROBES, cfg, args.timeout_change)
            result[x] = r
            prev_snap = xsnap
    (rep / "rep.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["b", "a1"], required=True)
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--first", type=int, default=1)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--max-turns", type=int, default=300)
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--timeout-change", type=int, default=1800)
    ap.add_argument("--no-changes", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for n in range(args.first, args.first + args.reps):
        print(f"{args.env}-{n}", flush=True)
        try:
            one_rep(args.env, n, out, args)
        except Quota as e:
            print(f"СТОП: лимит подписки claude — {e}", flush=True)
            return 3


if __name__ == "__main__":
    sys.exit(main())
