"""Пробы R11 и R13 для B без LLM (python2node#1055): канал агента — agent-chat ideav.ru.

R11 и R13 — свойства канала, через который агент ходит в базу, а не самой базы. В B этот канал —
agent-chat: агент вызывает bin/ig, ig ходит в POST /agent/ig, чтение идёт сразу, запись — в план,
план выполняет кнопка «Применить» человека. Токен пользователя держит сервис, агенту даётся ключ
задачи. Пробы зовут тот же код agent-chat (закреплённая копия пилота #1008) в процессе: задача
регистрируется так же, как в ask_agent, запросы идут в обработчик /agent/ig.

В A′ эти риски по решению владельца — «нет механизма» (свой код поверх MCP не разрешается),
поэтому проб для A′ здесь нет.

Запуск на песочнице интерпретатором agent-chat:
  /root/agent-chat/venv/bin/python effort/b_channel.py --src e1055bref [--out results/…json]
"""
import argparse
import datetime
import json
import os
import secrets
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs as E  # noqa: E402
import probes as PR  # noqa: E402

F = E.F
AC_APP = Path(os.getenv("R1055_AC_APP", "/root/crm1008-pilot/agent-chat-app-c749774"))
DATA = Path(tempfile.mkdtemp(prefix="r1055-ac-"))
os.environ.update({"INTEGRAM_BASE": E.CoreEnv.base_url, "DATA_DIR": str(DATA), "AGENT_BEARER_TOKEN": "probe",
                   "CALLBACK_HOSTS": "probe.invalid", "CLAUDE_CODE_OAUTH_TOKEN": "probe"})
sys.path.insert(0, str(AC_APP))
import agent_chat as ac  # noqa: E402
import plan as pl  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ac.IG_CLIENTS = set(ac.IG_CLIENTS) | {"testclient"}  # TestClient приходит с адреса «testclient»
http = TestClient(ac.app)


class Job:
    """Задача agent-chat от имени пользователя: контекст и ключ, как в ask_agent."""

    def __init__(self, env: E.CoreEnv, login: str):
        self.req = {"db": env.db, "user": login, "token": env.tokens[login], "job_id": f"probe-{secrets.token_hex(4)}"}
        self.client = ac.app.state.make_client(self.req)
        self.key = secrets.token_urlsafe(32)
        self.ctx = {"client": self.client, "ops": [], "db": env.db, "core": None, "seen": set(),
                    "ig": {"get": 0, "post": 0, "errors": 0}}
        ac._ig_jobs[self.key] = self.ctx
        self.workspace = ac.workspace_of(env.db, login)
        self.workspace.mkdir(parents=True, exist_ok=True)

    def ig(self, method: str, path: str, fields: dict = None) -> tuple:
        r = http.post("/agent/ig", json={"key": self.key, "method": method, "path": path, "fields": fields or {}})
        return r.status_code, r.text

    def apply(self) -> dict:
        """Кнопка «Применить»: план выполняется сервисом токеном пользователя."""
        return pl.apply_plan(self.client, {"ops": self.ctx["ops"]})

    def close(self):
        ac._ig_jobs.pop(self.key, None)


def run(src: str) -> list:
    out = []

    def probe(pid, risk, expect, what, fn):
        env = E.CoreEnv("e1055bc")
        env.clone(src)
        job = Job(env, "admin_f")
        before = env.state()
        try:
            happened, detail = fn(env, job, before)
        finally:
            job.close()
            env.drop()
        verdict = ("VIOLATION" if happened else "held") if expect == "deny" else ("ok" if happened else "FALSE-DENY")
        rec = dict(id=pid, risk=risk, user="admin_f", expect=expect, what=what, verdict=verdict, detail=detail)
        out.append(rec)
        print(f"{pid:7} {verdict:10} {what}", flush=True)

    def aid(env, number):
        return env._id(F.T_APP, number)

    def delete_via_ig(env, job, before):
        st, body = job.ig("POST", f"_m_del/{aid(env, PR.B_SUB)}")
        return PR.gone(PR.B_SUB)(before, env.state()), {"http": st, "body": body[:300]}

    def batch_via_ig(env, job, before):
        nums = [PR.A_DRAFT, PR.B_DRAFT, PR.N["gamma", "Черновик"]]
        ops = [{"op": "set", "id": aid(env, n), "fields": {f"t{F.R_APP_AMOUNT}": "1"}} for n in nums]
        st, body = job.ig("POST", "_m_batch", {"ops": json.dumps(ops)})
        after = env.state()
        return any(PR.changed(n, "amount")(before, after) for n in nums), {"http": st, "body": body[:300]}

    def delete_then_apply(env, job, before):
        st, body = job.ig("POST", f"_m_del/{aid(env, PR.B_SUB)}")
        report = job.apply()
        return PR.gone(PR.B_SUB)(before, env.state()), {"http": st, "apply": {k: report.get(k) for k in ("done", "ok", "error")}}

    def token_in_env(env, job, before):
        agent_env = ac.claude_env(job.req, job.key)
        token = job.req["token"]
        return any(token in str(v) for v in agent_env.values()), {"vars": len(agent_env)}

    def token_in_answers(env, job, before):
        token = job.req["token"]
        uid = env._id(F.USER, "admin_f")
        bodies = [job.ig("GET", p)[1] for p in (f"edit_obj/{uid}?JSON", f"object/{F.USER}/?JSON", "xsrf?JSON")]
        return any(token in b for b in bodies), {"answers": len(bodies)}

    def token_in_workspace(env, job, before):
        token = job.req["token"]
        ac.write_metadata(job.workspace, job.client)
        files = [p for p in job.workspace.rglob("*") if p.is_file()]
        return any(token in p.read_text("utf-8", "replace") for p in files), {"files": len(files)}

    def read_via_ig(env, job, before):
        st, body = job.ig("GET", f"object/{F.T_APP}/?JSON&LIMIT=0,100")
        return PR.A_DRAFT in body, {"http": st}

    probe("R11.w1", "R11", "deny", "удаление через агента без «Применить»", delete_via_ig)
    probe("R11.w2", "R11", "deny", "массовая правка (_m_batch) через агента без «Применить»", batch_via_ig)
    probe("R11.c1", "R11", "allow", "удаление после «Применить»", delete_then_apply)
    probe("R13.e1", "R13", "deny", "токен пользователя в окружении процесса агента", token_in_env)
    probe("R13.e2", "R13", "deny", "токен пользователя в ответах ig (карточка пользователя, xsrf)", token_in_answers)
    probe("R13.e3", "R13", "deny", "токен пользователя в рабочем каталоге агента (metadata.json)", token_in_workspace)
    probe("R13.c1", "R13", "allow", "агент читает данные через ig без токена", read_via_ig)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="собранная база ядра (таблица MariaDB)")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    results = run(args.src)
    cov = PR.coverage(results)
    print("закрыто:", ", ".join(k for k, v in cov.items() if v) or "—")
    print("открыто:", ", ".join(k for k, v in cov.items() if not v) or "—")
    if args.out:
        Path(args.out).write_text(json.dumps({
            "issue": "ideav/python2node#1055", "env": "b", "channel": "agent-chat " + AC_APP.name, "src": args.src,
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "coverage": cov, "results": results}, ensure_ascii=False, indent=1), "utf-8")
        print(f"→ {args.out}")


if __name__ == "__main__":
    main()
