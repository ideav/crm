"""Вариант A пилота python2node#1008: «таблицы MariaDB + REST + MCP + инструкция». Контракт: pilot/CONTRACT.md.

Выполняется на песочнице рядом с контейнером crm1008-db. Каждый прогон: своя база ra_<run_id>,
свой процесс REST-сервиса на свободном порту, свой MCP-процесс у агента.
"""
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app"))
sys.path.insert(0, str(HERE / "variant_a"))
import funding as F  # noqa: E402
import db as D  # noqa: E402
import seed as S  # noqa: E402

RUNS = Path(os.getenv("R1008_RUNS", "/root/crm1008-research/runs"))
CLAUDE = os.getenv("R1008_CLAUDE", "/root/.local/bin/claude")
AGENT_TIMEOUT = int(os.getenv("R1008_AGENT_TIMEOUT", "900"))
REVIEW_NOTE = "На экспертизе"


def provision(run_id: str, overrides: dict | None = None) -> dict:
    db = D.safe_db_name(run_id)
    run_dir = RUNS / db
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True)
    tokens = {login: secrets.token_hex(24) for login, _, _ in F.USERS}
    app = F.App(tokens, seed=1008)
    sql = (f"DROP DATABASE IF EXISTS {D.ident(db)};\n"
           f"CREATE DATABASE {D.ident(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n")
    D.run(sql)
    try:
        D.run("SET FOREIGN_KEY_CHECKS=1;\n" + S.SCHEMA + S.seed_sql(app, overrides), db)
    except Exception:
        D.run(f"DROP DATABASE IF EXISTS {D.ident(db)};")
        raise
    ready = run_dir / "ready.json"
    svc_log = open(run_dir / "service.log", "ab")
    proc = subprocess.Popen(
        [sys.executable, str(HERE / "variant_a" / "rest_service.py"), "--db", db, "--port", "0",
         "--log", str(run_dir / "api.jsonl"), "--ready", str(ready)],
        stdout=svc_log, stderr=svc_log, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(200):
        if ready.exists():
            break
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    if not ready.exists():
        _kill(proc.pid, db)
        D.run(f"DROP DATABASE IF EXISTS {D.ident(db)};")
        raise RuntimeError("REST-сервис не поднялся: " + (run_dir / "service.log").read_text(errors="replace")[-500:])
    info = json.loads(ready.read_text())
    return {"variant": "a", "run_id": run_id, "db": db, "tokens": tokens, "port": info["port"], "pid": info["pid"],
            "api_url": f"http://127.0.0.1:{info['port']}", "run_dir": str(run_dir), "api_log_offset": 0}


def _kill(pid: int, db: str):
    try:
        cmd = Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace")
        if db not in cmd:
            return  # pid уже чужой
        os.killpg(pid, signal.SIGTERM)
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        pass


def snapshot(ctx) -> dict:
    db = ctx["db"]

    def num(v):
        if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
            return int(v)
        return v

    comp = D.rows("SELECT JSON_OBJECT('code',code,'name',name,'inn',inn,'limit',limit_amount) FROM companies ORDER BY id", db)
    extras = D.rows("SELECT JSON_OBJECT('name',name,'type',type) FROM app_columns ORDER BY ord", db)
    pairs = ("'number',a.number,'company',c.code,'status',s.name,'amount',a.amount,'revenue',a.revenue,"
             "'text',a.description,'expert',u.login,'verdict',a.verdict")
    ex_pairs = "".join(f",'x{i}',a.{D.ident(e['name'])}" for i, e in enumerate(extras))
    recs = D.rows(f"SELECT JSON_OBJECT({pairs}{ex_pairs}) FROM applications a "
                  "LEFT JOIN companies c ON c.id=a.company_id LEFT JOIN statuses s ON s.id=a.status_id "
                  "LEFT JOIN users u ON u.id=a.expert_user_id ORDER BY a.id", db)
    apps = {}
    for r in recs:
        apps[r["number"]] = {
            "company": r["company"], "status": r["status"], "amount": num(r["amount"]), "revenue": num(r["revenue"]),
            "text": r["text"] or "", "expert": r["expert"], "verdict": r["verdict"] or "",
            "extra": {e["name"]: num(r[f"x{i}"]) for i, e in enumerate(extras)}}
    return {"companies": {c["code"]: {"name": c["name"], "inn": c["inn"], "limit": num(c["limit"])} for c in comp},
            "apps": apps,
            "app_columns": ["Компания", "Статус", "Сумма", "Выручка", "Описание проекта", "Эксперт",
                            "Заключение эксперта"] + [e["name"] for e in extras],
            "alpha_sees": _alpha_sees(ctx)}


def _alpha_sees(ctx) -> list:
    """Какие заявки отдаёт REST-сервис заявителю «Альфы» — проба эскалации прав (H4)."""
    import urllib.request
    import scenarios as SC  # noqa: E402  (pilot/ — в sys.path раннера)
    req = urllib.request.Request(f"{ctx['api_url']}/api/applications?limit=500",
                                 headers={"Authorization": f"Bearer {ctx['tokens']['alpha_user']}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return SC.app_numbers(r.read().decode("utf-8", "replace"))
    except OSError:
        return []


def _scrub(text: str, tokens: dict) -> str:
    for login, t in tokens.items():
        text = text.replace(t, f"<token:{login}>")
    return text


def run_agent(ctx, login: str, instructions: str, task: str, *, model: str, max_turns: int, log_dir: str) -> dict:
    log = Path(log_dir)
    log.mkdir(parents=True, exist_ok=True)
    tokens = ctx["tokens"]
    work = Path(tempfile.mkdtemp(prefix="ra-agent-"))  # пустой cwd и конфиг с токеном вне log_dir
    os.chmod(work, 0o700)
    mcp_cfg = work / "mcp.json"
    mcp_cfg.write_text(json.dumps({"mcpServers": {"fund": {
        "command": sys.executable, "args": [str(HERE / "variant_a" / "mcp_server.py")],
        "env": {"FUND_API_URL": ctx["api_url"], "FUND_TOKEN": tokens[login]}}}}))
    os.chmod(mcp_cfg, 0o600)
    cmd = [CLAUDE, "-p", "--model", model, "--output-format", "stream-json", "--verbose", "--max-turns", str(max_turns),
           "--tools", "", "--strict-mcp-config", "--mcp-config", str(mcp_cfg),
           "--allowedTools", "mcp__fund__*",
           "--no-session-persistence", "--disable-slash-commands", "--setting-sources", "project",
           "--system-prompt", instructions]
    t0 = time.time()
    out, err, timed_out = "", "", False
    try:
        p = subprocess.run(cmd, input=task.encode("utf-8"), capture_output=True, cwd=work, timeout=AGENT_TIMEOUT)
        out, err = p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace")
    except subprocess.TimeoutExpired as e:
        timed_out = True
        out = (e.stdout or b"").decode("utf-8", "replace")
        err = (e.stderr or b"").decode("utf-8", "replace")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    dur = time.time() - t0
    (log / "agent.jsonl").write_text(_scrub(out, tokens), encoding="utf-8")
    if err.strip():
        (log / "agent.stderr").write_text(_scrub(err, tokens), encoding="utf-8")

    # журнал API этого вызова (срез с прошлого смещения)
    src = Path(ctx["run_dir"]) / "api.jsonl"
    if src.exists():
        data = src.read_bytes()[ctx.get("api_log_offset", 0):]
        ctx["api_log_offset"] = ctx.get("api_log_offset", 0) + len(data)
        with open(log / "api.jsonl", "ab") as f:
            f.write(data)

    calls, result = [], None
    for line in out.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for b in (ev.get("message") or {}).get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    calls.append({"name": b.get("name"), "input": b.get("input")})
        elif ev.get("type") == "result":
            result = ev
    if result is None:
        return {"answer": "", "is_error": True, "duration_s": round(dur, 1), "turns": 0,
                "usage": {"input_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                          "output_tokens": 0},
                "cost_usd": 0.0, "tool_calls": calls,
                "error": "timeout" if timed_out else "нет события result: " + _scrub(err, tokens)[-300:]}
    u = result.get("usage") or {}
    return {"answer": result.get("result") or "", "is_error": bool(result.get("is_error")),
            "duration_s": round(dur, 1), "turns": result.get("num_turns", 0),
            "usage": {k: u.get(k, 0) for k in ("input_tokens", "cache_read_input_tokens",
                                               "cache_creation_input_tokens", "output_tokens")},
            "cost_usd": result.get("total_cost_usd", 0.0), "tool_calls": calls}


def teardown(ctx) -> None:
    _kill(ctx["pid"], ctx["db"])
    D.run(f"DROP DATABASE IF EXISTS {D.ident(ctx['db'])};")
    shutil.rmtree(ctx.get("run_dir", ""), ignore_errors=True)


if __name__ == "__main__":
    # ручной смоук без LLM: python3 variant_a.py <run_id>
    c = provision(sys.argv[1] if len(sys.argv) > 1 else "smoke")
    print(json.dumps({k: v for k, v in c.items() if k != "tokens"}, ensure_ascii=False))
    print(json.dumps(snapshot(c), ensure_ascii=False, indent=1))
    teardown(c)
