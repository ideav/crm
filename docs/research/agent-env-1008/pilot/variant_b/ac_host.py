"""Хост agent-chat для пилота python2node#1008 (вариант B1).

Запускает ТОТ ЖЕ код agent-chat, что на ideav.ru (agent_chat.py, plan.py, bin/ig: копия-закладка
в PILOT_DATA/agent-chat-app), своим процессом на своём порту и против стенда ядра. Боевой сервис
не трогается. К приложению добавлен один маршрут POST /pilot/run: он вызывает process(req) — тот же
путь, что у POST /agent/chat (промпт, схема, справочник, ig, план, песочница AGENT_USER), только без
callback: ответ возвращается телом, а stream-json пишется в log_dir/agent.jsonl.

Что подменено (и больше ничего):
  - deliver / send_progress — ответ остаётся в процессе;
  - run_claude — запоминает события stream-json и не продолжает прошлую сессию (как eval agent-chat);
  - claude_argv — к аргументам сервиса добавлены --model и --max-turns прогона;
  - build_prompt — к промпту agent-chat добавлены инструкции процесса (перед сообщением пользователя).
Запуск: <venv agent-chat>/bin/python ac_host.py (переменные — из variant_b.py).
"""
import asyncio
import contextvars
import json
import os
import secrets
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, os.environ["AC_APP"])

import agent_chat as ac  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

PILOT_KEY = os.environ.pop("PILOT_KEY")  # ключ маршрута /pilot/run; процессу Claude не передаётся
ac.SERVICE_SECRETS.add("PILOT_KEY")
PORT = int(os.environ["PILOT_HOST_PORT"])
ac.IG_URL = f"http://127.0.0.1:{PORT}/agent/ig"

_run = contextvars.ContextVar("pilot_run", default=None)
_orig_build, _orig_argv, _orig_parse = ac.build_prompt, ac.claude_argv, ac.parse_claude_output
MARKER = "СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n<<<\n"


def build_prompt(req, *a, **k):
    prompt = _orig_build(req, *a, **k)
    ins = ((req.get("pilot") or {}).get("instructions") or "").strip()
    i = prompt.find(MARKER)
    if ins and i >= 0:
        prompt = (prompt[:i] + "ПРАВИЛА ПРОЦЕССА (инструкции организации, обязательны):\n" + ins + "\n\n"
                  + prompt[i:])
    return prompt


def claude_argv(prompt, resume):
    argv = _orig_argv(prompt, resume)
    run = _run.get()
    if run:
        argv += ["--model", run["model"], "--max-turns", str(run["max_turns"])]
    return argv


def parse_claude_output(stdout):
    run = _run.get()
    if run is not None:
        run["raw_result"] = stdout
    return _orig_parse(stdout)


ac.build_prompt, ac.claude_argv, ac.parse_claude_output = build_prompt, claude_argv, parse_claude_output

_real_run_claude = ac.app.state.run_claude


async def run_claude(prompt, cwd, resume, env, on_event=None):
    run = _run.get()

    def ev(event):
        run["events"].append(event)
        if on_event:
            on_event(event)

    return await _real_run_claude(prompt, cwd, None, env, on_event=ev)


async def deliver(req, payload):
    _run.get()["payload"] = payload


async def send_progress(req, text):
    pass


ac.app.state.run_claude, ac.app.state.deliver, ac.app.state.send_progress = run_claude, deliver, send_progress


def usage_of(raw: str) -> tuple:
    keys = ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens")
    for line in reversed((raw or "").strip().splitlines()):
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("type") == "result":
            u = obj.get("usage") or {}
            return {k: int(u.get(k) or 0) for k in keys}, obj
    return {k: 0 for k in keys}, {}  # (usage, объект result)


@ac.app.post("/pilot/run")
async def pilot_run(request: Request):
    host = request.client.host if request.client else ""
    if host not in ac.IG_CLIENTS or "x-forwarded-for" in request.headers:
        return JSONResponse({"error": "только локально"}, status_code=403)
    if not secrets.compare_digest(request.headers.get("x-pilot-key", ""), PILOT_KEY):
        return JSONResponse({"error": "ключ"}, status_code=403)
    body = await request.json()
    job_id = secrets.token_hex(8)
    try:
        req = ac.parse_request({
            "db": body["db"], "user": body["login"], "token": body["token"], "message": body["task"],
            "job_id": job_id, "callback_url": "https://pilot.invalid/cb", "callback_secret": "pilot"})
    except ac.BadRequest as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    req["pilot"] = {"instructions": body.get("instructions") or ""}
    run = {"model": body["model"], "max_turns": int(body["max_turns"]), "events": [], "payload": None,
           "raw_result": ""}
    _run.set(run)
    started = time.monotonic()
    await ac.process(req)
    duration = round(time.monotonic() - started, 1)
    payload = run["payload"] or {"status": "error", "error": "нет ответа"}

    log_dir = Path(body["log_dir"])
    log_dir.mkdir(parents=True, exist_ok=True)
    with open(log_dir / "agent.jsonl", "w", encoding="utf-8") as f:
        for e in run["events"]:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
        if run["raw_result"]:
            f.write(run["raw_result"].strip() + "\n")

    usage, result = usage_of(run["raw_result"])
    tool_calls = []
    for e in run["events"]:
        if isinstance(e, dict) and e.get("type") == "assistant":
            for part in (e.get("message") or {}).get("content") or []:
                if isinstance(part, dict) and part.get("type") == "tool_use":
                    tool_calls.append({"name": part.get("name"), "input": part.get("input")})
    done = payload.get("status") == "done"
    out = {"answer": payload.get("content") if done else payload.get("error", ""),
           "is_error": (not done) or bool(result.get("is_error")),
           "duration_s": duration, "turns": result.get("num_turns"), "usage": usage,
           "cost_usd": result.get("total_cost_usd"), "tool_calls": tool_calls}
    if payload.get("plan"):
        out["plan"] = payload["plan"]  # pending — ответить на «Применить» некому: это условие пилота
    return out


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(ac.app, host="127.0.0.1", port=PORT, log_level="warning")
