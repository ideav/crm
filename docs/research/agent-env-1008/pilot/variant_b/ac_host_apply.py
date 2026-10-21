"""Хост B1a: ac_host.py + «Применить» плана тем же путём, что кнопка на ideav.ru.

Кнопка шлёт POST /agent/chat {action:"apply", plan_id:<job_id вопроса>} с токеном пользователя
(agent_chat.py: parse_request:175 -> process:1262 -> handle_action:1171, ветка apply:1188 ->
execute_plan:1114 -> plan.apply_plan:673). Здесь тот же process(req) с action=apply вызывается
после ответа агента, если в плане остались неисполненные шаги (status=pending). Claude при «Применить»
не запускается — как на ideav.ru; итог исполнения агент узнаёт только на следующем вопросе (.events).
ac_host.py только импортируется, не меняется.
"""
import json
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ac_host as h  # noqa: E402
from fastapi import Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

ac = h.ac


@ac.app.post("/pilot/run_apply")
async def pilot_run_apply(request: Request):
    out = await h.pilot_run(request)
    if isinstance(out, JSONResponse):
        return out
    body = await request.json()
    plan = out.get("plan")
    if not plan:
        return out
    plan_id = plan["id"]
    ws = ac.workspace_of(body["db"], body["login"])
    saved = ac.load_plan(ws, plan_id) or {}
    out["plan"] = {**plan, "ops": saved.get("ops"), "summary": saved.get("summary")}
    if plan["status"] == "pending":
        req = ac.parse_request({
            "db": body["db"], "user": body["login"], "token": body["token"], "action": "apply", "plan_id": plan_id,
            "job_id": secrets.token_hex(8), "callback_url": "https://pilot.invalid/cb", "callback_secret": "pilot"})
        h._run.set({"payload": None, "events": []})
        await ac.process(req)
        payload = h._run.get()["payload"] or {"status": "error", "error": "нет ответа"}
        done = ac.load_plan(ws, plan_id) or {}
        out["plan_applied"] = {"how": "button", "status": (payload.get("plan") or {}).get("status"),
                               "content": payload.get("content") or payload.get("error"),
                               "report": done.get("report"), "error": done.get("error")}
        out["answer"] = f"{out['answer']}\n\n[Применить] {out['plan_applied']['content']}"
    else:  # одиночная правка agent-chat исполнил сам (confirm_over), кнопка не понадобилась
        out["plan_applied"] = {"how": "auto", "status": plan["status"], "content": None,
                               "report": saved.get("report"), "error": saved.get("error")}
    Path(body["log_dir"], "plan_apply.json").write_text(
        json.dumps({"plan": out["plan"], "plan_applied": out["plan_applied"]}, ensure_ascii=False, indent=1, default=str),
        "utf-8")
    return out


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(ac.app, host="127.0.0.1", port=h.PORT, log_level="warning")
