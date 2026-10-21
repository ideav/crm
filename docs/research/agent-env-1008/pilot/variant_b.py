"""Варианты B0 и B1 пилота python2node#1008: ИИ-агент на ядре ideav.ru (интерфейс — pilot/CONTRACT.md).

  B0 — claude -p с ideav-mcp «как есть» (инструменты list_tables, list_objects, create_object, ...);
  B1 — штатный ИИ-чат ideav.ru (agent-chat: промпт, схема, справочник kb, ig, план и подтверждения,
       Bash/Read/... в песочнице agentrun) против той же базы прогона.

provision и snapshot общие (база rb_<run_id> на стенде ядра, как у probes/probe.py); run_agent выбирает
вариант по ctx["variant"]. Модули pilot/variant_b0.py и pilot/variant_b1.py — тонкие обёртки make("B0"|"B1").

Свои экземпляры сервисов (боевые ideav-mcp :8768 и agent-chat :8767 не трогаются, их .env только читается):
  ideav-mcp  — /root/ideav-mcp, порт 18768, IDEAV_BASE=стенд;
  ac_host.py — код agent-chat из закладки PILOT_DATA/agent-chat-app, порт 18767, INTEGRAM_BASE=стенд.
Оба поднимаются при первом run_agent (ensure_services) и живут дальше; управление:
  python3 pilot/variant_b.py services start|stop|status
"""
import fcntl
import json
import os
import re
import secrets
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app"))
sys.path.insert(0, str(HERE.parent / "probes"))
import funding as F  # noqa: E402
import probe as P  # noqa: E402  (mysql, snapshot строк базы, адрес и логи стенда)

DATA = Path(os.getenv("R1008_PILOT_DATA", "/root/crm1008-pilot"))
STAND = P.STAND
CORE = P.BASE                                     # http://127.0.0.1:18681
SERVICE_ENV = Path(os.getenv("R1008_SERVICE_ENV", "/root/agent-chat/.env"))
AC_SRC = Path(os.getenv("R1008_AC_SRC", "/root/agent-chat/app"))
AC_VENV_PY = os.getenv("R1008_AC_PY", "/root/agent-chat/venv/bin/python")
MCP_SRC = Path(os.getenv("R1008_MCP_SRC", "/root/ideav-mcp"))
MCP_PORT = int(os.getenv("R1008_MCP_PORT", "18768"))
HOST_PORT = int(os.getenv("R1008_HOST_PORT", "18767"))
AGENT_TIMEOUT = int(os.getenv("R1008_AGENT_TIMEOUT", "600"))
USAGE_KEYS = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")

COMPANY_KEY = {name: key for name, key, _ in F.COMPANIES}


# --- база прогона ----------------------------------------------------------------------------

def db_name(run_id: str) -> str:
    name = "rb_" + re.sub(r"[^A-Za-z0-9_]", "_", str(run_id))
    if len(name) > 64:
        raise ValueError(f"имя базы длиннее 64: {name}")
    return name


def _apply_overrides(app: F.App, overrides: dict) -> None:
    """Подмена полей заявок по номеру до сборки базы: text, amount, revenue, verdict, status, company, expert."""
    rows = app.rows
    nid = max(r[0] for r in rows) + 1
    plain = {"text": (F.R_APP_TEXT, 5), "amount": (F.R_APP_AMOUNT, 3), "revenue": (F.R_APP_REVENUE, 4),
             "verdict": (F.R_APP_VERDICT, 7)}
    refs = {"status": (F.R_APP_STATUS, app.status, 2), "company": (F.R_APP_COMPANY, app.company, 1),
            "expert": (F.R_APP_EXPERT, app.user, 6)}
    for number, fields in (overrides or {}).items():
        rec = next((a for a in app.apps if a["number"] == number), None)
        if rec is None:
            raise KeyError(f"overrides: нет заявки {number}")
        for key, value in fields.items():
            if key in plain:
                rid, order = plain[key]
                idx = next((i for i, r in enumerate(rows) if r[1] == rec["id"] and r[3] == rid), None)
                if value is None:
                    if idx is not None:
                        del rows[idx]
                elif idx is not None:
                    rows[idx] = rows[idx][:4] + (str(value),)
                else:
                    rows.append((nid, rec["id"], order, rid, str(value)))
                    nid += 1
                if key == "amount":
                    rec["amount"] = value
            elif key in refs:
                rid, table, order = refs[key]
                idx = next((i for i, r in enumerate(rows) if r[1] == rec["id"] and r[4] == str(rid)
                            and r[3] in table.values()), None)
                if idx is not None:
                    del rows[idx]
                if value is not None:
                    rows.append((nid, rec["id"], order, table[value], str(rid)))
                    nid += 1
                if key in ("status", "company"):
                    rec[key] = value
            else:
                raise KeyError(f"overrides: неизвестное поле {key}")


def _cleanup_files(db: str) -> None:
    for kind in ("log", "sql"):
        (STAND / "logs" / f"{db}_{kind}.jsonl").unlink(missing_ok=True)
    shutil.rmtree(DATA / "b1-data" / "workspaces" / db, ignore_errors=True)


def provision(run_id: str, overrides: dict = None, variant: str = "B0") -> dict:
    db = db_name(run_id)
    tokens = {login: secrets.token_hex(16) for login, _, _ in F.USERS}
    app = F.App(tokens, seed=1008)
    _apply_overrides(app, overrides)
    _cleanup_files(db)
    P.mysql(F.build_sql(db, app))
    return {"variant": variant, "run_id": run_id, "db": db, "tokens": tokens, "core": CORE}


def teardown(ctx) -> None:
    P.mysql(f"DROP TABLE IF EXISTS {ctx['db']};")
    _cleanup_files(ctx["db"])


# --- снимок в предметных терминах ---------------------------------------------------------------

def _name_of(rows: dict, req_id: int) -> str:
    """Имя колонки: alias реквизита (JSON или :ALIAS=..:), иначе имя типа колонки / целевой таблицы."""
    _, _, t, val = rows[req_id]
    alias = ""
    try:
        alias = str(json.loads(val).get("alias") or "") if val.startswith("{") else ""
    except (ValueError, AttributeError):
        pass
    if not alias:
        m = re.search(r":ALIAS=(.*?):", val or "")
        alias = m.group(1) if m else ""
    if alias:
        return alias
    type_row = rows.get(t)
    if type_row and type_row[3] == "" and type_row[2] in rows:  # ссылка: имя целевой таблицы
        return rows[type_row[2]][3]
    return type_row[3] if type_row else str(t)


def _number(val: str):
    s = (val or "").strip()
    if s == "":
        return None
    try:
        return int(s)
    except ValueError:
        pass
    try:
        x = float(s.replace(",", "."))
        return int(x) if x == int(x) else s
    except ValueError:
        return s


def snapshot(ctx) -> dict:
    rows = P.snapshot(ctx["db"])
    reqs = sorted(((o, i) for i, (up, o, t, v) in rows.items() if up == F.T_APP and t != 0), key=lambda x: x)
    names = {i: _name_of(rows, i) for _, i in reqs}
    known = {F.R_APP_COMPANY: "company", F.R_APP_STATUS: "status", F.R_APP_AMOUNT: "amount",
             F.R_APP_REVENUE: "revenue", F.R_APP_TEXT: "text", F.R_APP_EXPERT: "expert",
             F.R_APP_VERDICT: "verdict"}

    companies = {}
    for i, (up, o, t, v) in rows.items():
        if up == 1 and t == F.T_COMPANY:
            kids = {rows[c][2]: rows[c][3] for c in rows if rows[c][0] == i}
            companies[COMPANY_KEY.get(v, v)] = {"name": v, "inn": kids.get(F.R_COMPANY_INN),
                                                "limit": _number(kids.get(F.R_COMPANY_LIMIT))}

    def target(tid: int) -> str:
        r = rows.get(tid)
        if r is None:
            return str(tid)
        return COMPANY_KEY.get(r[3], r[3]) if r[2] == F.T_COMPANY else r[3]

    children = {}
    for i, (up, o, t, v) in rows.items():
        children.setdefault(up, []).append((o, i, t, v))

    apps = {}
    for i, (up, o, t, number) in sorted(rows.items()):
        if up != 1 or t != F.T_APP:
            continue
        rec = {"company": None, "status": None, "amount": None, "revenue": None, "text": "",
               "expert": None, "verdict": "", "extra": {}}
        for _, _, ct, cv in sorted(children.get(i, [])):
            if ct in names:                                   # обычное значение: t — реквизит
                req, value = ct, cv
            elif cv.isdigit() and int(cv) in names:           # ссылка: t — запись-цель, val — реквизит
                req, value = int(cv), target(ct)
            else:
                continue
            field = known.get(req)
            if field in ("amount", "revenue"):
                rec[field] = _number(value)
            elif field:
                rec[field] = value
            elif names[req] in rec["extra"]:
                rec["extra"][names[req]] += ", " + value
            else:
                rec["extra"][names[req]] = value
        apps[number] = rec
    return {"companies": companies, "apps": apps, "app_columns": [names[i] for _, i in reqs]}


# --- свои сервисы -------------------------------------------------------------------------------

def _service_env() -> dict:
    """CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_BIN, CLAUDE_ARGS, KB_DIR боевого .env (только чтение; значения не печатаются)."""
    out = {}
    if SERVICE_ENV.exists():
        for line in SERVICE_ENV.read_text("utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() in ("CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_BIN", "CLAUDE_ARGS", "KB_DIR", "AGENT_USER") and v.strip():
                out[k.strip()] = " ".join(shlex.split(v.strip()))
    return out


def _alive(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.status == 200
    except (OSError, urllib.error.URLError):
        return False


def _spawn(name: str, port: int, health: str, argv: list, env: dict, cwd: str) -> None:
    url = f"http://127.0.0.1:{port}{health}"
    if _alive(url):
        return
    DATA.mkdir(parents=True, exist_ok=True)
    with open(DATA / f"{name}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if _alive(url):
            return
        log = open(DATA / f"{name}.log", "ab")
        p = subprocess.Popen(argv, env=env, cwd=cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                             start_new_session=True)
        (DATA / f"{name}.pid").write_text(str(p.pid))
        for _ in range(60):
            if _alive(url):
                return
            if p.poll() is not None:
                raise RuntimeError(f"{name} не запустился, см. {DATA / (name + '.log')}")
            time.sleep(0.5)
        raise RuntimeError(f"{name}: нет ответа на {url}")


def _pin_agent_chat() -> Path:
    """Копия кода agent-chat (agent_chat.py, plan.py, core_tasks.py, bin/ig): версия не плывёт между прогонами."""
    dst = DATA / "agent-chat-app"
    if not (dst / "agent_chat.py").exists():
        tmp = Path(tempfile.mkdtemp(dir=DATA))
        for f in ("agent_chat.py", "plan.py", "core_tasks.py"):
            shutil.copy2(AC_SRC / f, tmp / f)
        shutil.copytree(AC_SRC / "bin", tmp / "bin")
        os.chmod(tmp, 0o755)
        try:
            tmp.rename(dst)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
    return dst


def _host_key() -> str:
    f = DATA / "host.key"
    if not f.exists():
        DATA.mkdir(parents=True, exist_ok=True)
        fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(secrets.token_hex(24))
    return f.read_text().strip()


def ensure_services(need_mcp: bool = False, need_host: bool = False) -> None:
    base = {"PATH": f"/root/.local/bin:{os.environ.get('PATH', '/usr/bin:/bin')}", "HOME": "/root", "LANG": "C.UTF-8"}
    if need_mcp:
        _spawn("ideav-mcp-pilot", MCP_PORT, "/health", ["node", str(MCP_SRC / "bin" / "ideav-mcp.mjs")],
               {**base, "PORT": str(MCP_PORT), "HOST": "127.0.0.1", "IDEAV_BASE": CORE}, str(MCP_SRC))
    if need_host:
        svc = _service_env()
        app_dir = _pin_agent_chat()
        (DATA / "b1-data").mkdir(parents=True, exist_ok=True)
        env = {**base, "AC_APP": str(app_dir), "PILOT_HOST_PORT": str(HOST_PORT), "PILOT_KEY": _host_key(),
               "INTEGRAM_BASE": CORE, "DATA_DIR": str(DATA / "b1-data"), "AGENT_BEARER_TOKEN": secrets.token_hex(16),
               "CALLBACK_HOSTS": "pilot.invalid", "MAX_PARALLEL": "6", "CHAT_TIMEOUT": str(AGENT_TIMEOUT),
               "PYTHONDONTWRITEBYTECODE": "1", "CONFIRM_OVER": "1",
               **{k: v for k, v in svc.items()}}
        env.setdefault("AGENT_USER", "agentrun")
        _spawn("agent-chat-pilot", HOST_PORT, "/agent/health", [AC_VENV_PY, str(HERE / "variant_b" / "ac_host.py")],
               env, str(app_dir))


def services(action: str) -> None:
    names = ("ideav-mcp-pilot", "agent-chat-pilot")
    ports = {"ideav-mcp-pilot": (MCP_PORT, "/health"), "agent-chat-pilot": (HOST_PORT, "/agent/health")}
    for n in names:
        pidf = DATA / f"{n}.pid"
        if action == "start":
            continue
        if action == "stop" and pidf.exists():
            try:
                os.killpg(int(pidf.read_text()), signal.SIGTERM)
            except (ProcessLookupError, ValueError, PermissionError):
                pass
            pidf.unlink(missing_ok=True)
        if action == "status":
            print(n, "up" if _alive(f"http://127.0.0.1:{ports[n][0]}{ports[n][1]}") else "down")
    if action == "start":
        ensure_services(True, True)
        services("status")


# --- общее: журнал и разбор stream-json ----------------------------------------------------------

def _copy_api_log(ctx, log_dir: Path) -> None:
    """api.jsonl — журнал запросов к ядру по базе прогона (его пишет само ядро, не прокси: ловит всё, что дошло
    до ядра, независимо от пути — MCP, ig, прямой curl); core_sql.jsonl — журнал записей."""
    for kind, name in (("log", "api.jsonl"), ("sql", "core_sql.jsonl")):
        src = STAND / "logs" / f"{ctx['db']}_{kind}.jsonl"
        (log_dir / name).write_bytes(src.read_bytes() if src.exists() else b"")


def _parse_stream(lines: list) -> dict:
    tool_calls, result = [], {}
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        if e.get("type") == "assistant":
            for part in (e.get("message") or {}).get("content") or []:
                if isinstance(part, dict) and part.get("type") == "tool_use":
                    tool_calls.append({"name": part.get("name"), "input": part.get("input")})
        elif e.get("type") == "result":
            result = e
    usage = {k: int((result.get("usage") or {}).get(k) or 0) for k in USAGE_KEYS}
    return {"answer": str(result.get("result") or ""), "is_error": bool(result.get("is_error")) or not result,
            "turns": result.get("num_turns"), "usage": usage, "cost_usd": result.get("total_cost_usd"),
            "tool_calls": tool_calls}


# --- B0: claude -p + ideav-mcp ---------------------------------------------------------------------

def _run_b0(ctx, login, instructions, task, model, max_turns, log_dir: Path) -> dict:
    ensure_services(need_mcp=True)
    svc = _service_env()
    work = Path(tempfile.mkdtemp(prefix="b0-", dir=DATA))
    try:
        # Токен — через окружение процесса (${IDEAV_TOKEN} в конфиге): в файлах и логах его нет.
        cfg = work / "mcp.json"
        cfg.write_text(json.dumps({"mcpServers": {"ideav": {
            "type": "http", "url": f"http://127.0.0.1:{MCP_PORT}/mcp/{ctx['db']}",
            "headers": {"Authorization": "Bearer ${IDEAV_TOKEN}"}}}}))
        # Чистый дом: ни CLAUDE.md, ни навыков, ни памяти хозяина песочницы.
        (work / "home").mkdir()
        env = {"PATH": f"/root/.local/bin:{os.environ.get('PATH', '/usr/bin:/bin')}", "HOME": str(work / "home"),
               "CLAUDE_CONFIG_DIR": str(work / "home" / ".claude"), "DISABLE_AUTOUPDATER": "1", "LANG": "C.UTF-8",
               "IDEAV_TOKEN": ctx["tokens"][login]}
        if svc.get("CLAUDE_CODE_OAUTH_TOKEN"):
            env["CLAUDE_CODE_OAUTH_TOKEN"] = svc["CLAUDE_CODE_OAUTH_TOKEN"]
        argv = [svc.get("CLAUDE_BIN", "/root/.local/bin/claude"), "-p", "--model", model,
                "--output-format", "stream-json", "--verbose", "--max-turns", str(max_turns),
                "--tools", "", "--strict-mcp-config", "--mcp-config", str(cfg),
                "--allowedTools", "mcp__ideav__*", "--system-prompt", instructions,
                "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence"]
        started = time.monotonic()
        try:
            p = subprocess.run(argv, input=task.encode("utf-8"), capture_output=True, env=env, cwd=work / "home",
                               timeout=AGENT_TIMEOUT)
            out, err, timed_out = p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace"), False
        except subprocess.TimeoutExpired as e:
            out, err, timed_out = (e.stdout or b"").decode("utf-8", "replace"), "timeout", True
        duration = round(time.monotonic() - started, 1)
        lines = [ln for ln in out.splitlines() if ln.strip()]
        (log_dir / "agent.jsonl").write_text("\n".join(lines) + "\n", "utf-8")
        if err.strip():
            (log_dir / "agent.stderr.txt").write_text(err[-4000:].replace(ctx["tokens"][login], "***"), "utf-8")
        res = _parse_stream(lines)
        if timed_out:
            res.update(is_error=True, answer=res["answer"] or f"таймаут {AGENT_TIMEOUT} с")
        return {**res, "duration_s": duration}
    finally:
        shutil.rmtree(work, ignore_errors=True)


# --- B1: agent-chat ----------------------------------------------------------------------------------

def _run_b1(ctx, login, instructions, task, model, max_turns, log_dir: Path) -> dict:
    ensure_services(need_host=True)
    body = json.dumps({"db": ctx["db"], "login": login, "token": ctx["tokens"][login], "task": task,
                       "instructions": instructions, "model": model, "max_turns": max_turns,
                       "log_dir": str(log_dir)}).encode("utf-8")
    req = urllib.request.Request(f"http://127.0.0.1:{HOST_PORT}/pilot/run", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "X-Pilot-Key": _host_key()})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=AGENT_TIMEOUT + 120) as r:
            return json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError) as e:
        return {"answer": f"хост agent-chat: {e}", "is_error": True, "duration_s": round(time.monotonic() - started, 1),
                "turns": None, "usage": dict.fromkeys(USAGE_KEYS, 0), "cost_usd": None, "tool_calls": []}


def run_agent(ctx, login: str, instructions: str, task: str, *, model: str, max_turns: int, log_dir: str) -> dict:
    out = Path(log_dir)
    out.mkdir(parents=True, exist_ok=True)
    if login not in ctx["tokens"]:
        raise KeyError(f"нет пользователя {login}")
    run = {"B0": _run_b0, "B1": _run_b1}[ctx["variant"]]
    try:
        res = run(ctx, login, instructions, task, model, max_turns, out)
    finally:
        _copy_api_log(ctx, out)
    return res


def make(variant: str) -> SimpleNamespace:
    """Модуль-вариант: provision/snapshot/run_agent/teardown по контракту, вариант зашит."""
    if variant not in ("B0", "B1"):
        raise ValueError(variant)
    return SimpleNamespace(
        VARIANT=variant,
        provision=lambda run_id, overrides=None: provision(run_id, overrides, variant),
        snapshot=snapshot, run_agent=run_agent, teardown=teardown)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "services" and sys.argv[2] in ("start", "stop", "status"):
        services(sys.argv[2])
    else:
        sys.exit(__doc__)
