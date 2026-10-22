"""Вариант B1a пилота: B1 (agent-chat) + автоматическое «Применить» плана (CONTRACT.md).

Отдельная копия variant_b.py (загружается под другим именем) со своими данными и портом, чтобы не
мешать идущему B0/B1: PILOT_DATA=/root/crm1008-pilot-a, хост agent-chat на :18769. База, провижн,
снимок и teardown — те же. run_agent: B1 как есть, затем «Применить» тем же путём, что кнопка на
ideav.ru (см. variant_b/ac_host_apply.py); в результат добавлены plan и plan_applied.
"""
import importlib.util
import json
import os
import secrets
import sys
import time
import urllib.request
from pathlib import Path
from types import SimpleNamespace

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
_PORT = os.getenv("R1008_HOST_PORT_A", "18769")


def _load():
    saved = {k: os.environ.get(k) for k in ("R1008_PILOT_DATA", "R1008_HOST_PORT")}
    os.environ["R1008_PILOT_DATA"] = os.getenv("R1008_PILOT_DATA_A", "/root/crm1008-pilot-a")
    os.environ["R1008_HOST_PORT"] = _PORT
    try:
        spec = importlib.util.spec_from_file_location("variant_b_a", HERE / "variant_b.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return mod


vb = _load()


def _ensure_host() -> None:
    vb.DATA.mkdir(parents=True, exist_ok=True)
    svc = vb._service_env()
    app_dir = vb._pin_agent_chat()
    (vb.DATA / "b1-data").mkdir(parents=True, exist_ok=True)
    env = {"PATH": f"/root/.local/bin:{os.environ.get('PATH', '/usr/bin:/bin')}", "HOME": "/root", "LANG": "C.UTF-8",
           "AC_APP": str(app_dir), "PILOT_HOST_PORT": str(vb.HOST_PORT), "PILOT_KEY": vb._host_key(),
           "INTEGRAM_BASE": vb.CORE, "DATA_DIR": str(vb.DATA / "b1-data"), "AGENT_BEARER_TOKEN": secrets.token_hex(16),
           "CALLBACK_HOSTS": "pilot.invalid", "MAX_PARALLEL": "6", "CHAT_TIMEOUT": str(vb.AGENT_TIMEOUT),
           "PYTHONDONTWRITEBYTECODE": "1", "CONFIRM_OVER": "1", **svc}
    env.setdefault("AGENT_USER", "agentrun")
    vb._spawn("agent-chat-pilot-a", vb.HOST_PORT, "/agent/health",
              [vb.AC_VENV_PY, str(HERE / "variant_b" / "ac_host_apply.py")], env, str(app_dir))


def run_agent(ctx, login, instructions, task, *, model, max_turns, log_dir) -> dict:
    out = Path(log_dir)
    out.mkdir(parents=True, exist_ok=True)
    _ensure_host()
    body = json.dumps({"db": ctx["db"], "login": login, "token": ctx["tokens"][login], "task": task,
                       "instructions": instructions, "model": model, "max_turns": max_turns,
                       "log_dir": str(out)}).encode("utf-8")
    req = urllib.request.Request(f"http://127.0.0.1:{vb.HOST_PORT}/pilot/run_apply", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "X-Pilot-Key": vb._host_key()})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=vb.AGENT_TIMEOUT + 180) as r:
            res = json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError) as e:
        res = {"answer": f"хост agent-chat: {e}", "is_error": True, "duration_s": round(time.monotonic() - started, 1),
               "turns": None, "usage": dict.fromkeys(vb.USAGE_KEYS, 0), "cost_usd": None, "tool_calls": []}
    vb._copy_api_log(ctx, out)
    return res


def make(variant: str = "B1a") -> SimpleNamespace:
    return SimpleNamespace(
        VARIANT="B1a",
        provision=lambda run_id, overrides=None: vb.provision(run_id, overrides, "B1a"),
        snapshot=vb.snapshot, run_agent=run_agent, teardown=vb.teardown)


_v = make()
VARIANT = _v.VARIANT
provision, snapshot, teardown = _v.provision, _v.snapshot, _v.teardown
