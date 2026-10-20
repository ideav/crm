"""Пробы механизмов ядра ideav.ru без LLM (python2node#1008, фаза 3, шаг 1).

Каждая проба — одно детерминированное действие пользователя приложения «Заявки» через HTTP API
ядра (как это делают ideav-mcp и agent-chat: токен в X-Authorization и куке, _xsrf, client=ai).
Проба получает свою свежую базу; результат определяется не по ответу ядра, а по дифф-снимку
таблицы базы до и после (для чтения — по тому, попали ли чужие данные в ответ).

Вердикты:
  held      — ожидался отказ, база не изменилась / чужого в ответе нет;
  VIOLATION — ожидался отказ, а ядро пропустило (база изменилась / данные утекли);
  ok        — ожидалось разрешение, действие выполнено (контроль);
  FALSE-DENY — ожидалось разрешение, а ядро отказало (контроль не прошёл — пробы рядом недостоверны).

Запуск на песочнице (стенд — stand/stand.sh up):
  python3 probes/probe.py [--only W1,W2] [--out results/probes-<дата>.json]
"""
import argparse
import datetime
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app"))
import funding as F  # noqa: E402

STAND = Path(os.getenv("R1008_STAND", "/root/crm1008-stand"))
BASE = f"http://127.0.0.1:{os.getenv('R1008_PORT', '18681')}"
DB_CONTAINER = os.getenv("R1008_DB_CONTAINER", "crm1008-db")
USER_SERVICE_FIELDS = {124, 40, 300}  # Activity, xsrf, Retries — ядро пишет их само при входе


# --- база ------------------------------------------------------------------------------------

def mysql(sql: str) -> list:
    p = subprocess.run(
        ["docker", "exec", "-i", DB_CONTAINER, "sh", "-c",
         'exec mariadb -N -B -uroot -p"$MARIADB_ROOT_PASSWORD" "$MARIADB_DATABASE"'],
        input=sql.encode("utf-8"), capture_output=True)
    if p.returncode:
        raise RuntimeError(f"mariadb: {p.stderr.decode('utf-8', 'replace')[-500:]}")
    return [line.split("\t") for line in p.stdout.decode("utf-8").splitlines()]


def snapshot(db: str) -> dict:
    return {int(i): (int(u), int(o), int(t), bytes.fromhex(v).decode("utf-8"))
            for i, u, o, t, v in mysql(f"SELECT id, up, ord, t, HEX(val) FROM {db}")}


def diff(before: dict, after: dict) -> list:
    def service(rows, i):
        up, _, t, _ = rows[i]
        return t in USER_SERVICE_FIELDS and rows.get(up, (0, 0, 0, ""))[2] == F.USER
    out = []
    for i in sorted(before.keys() | after.keys()):
        b, a = before.get(i), after.get(i)
        if b == a or service(after if a else before, i):
            continue
        out.append({"id": i, "before": b, "after": a})
    return out


# --- HTTP ------------------------------------------------------------------------------------

class Session:
    def __init__(self, db: str, token: str):
        self.db, self.token, self.xsrf = db, token, None

    def call(self, method: str, path: str, query: dict = None, form: dict = None):
        q = dict(query or {})
        q.update({"client": "ai", "ai_job": "probe-1008"})
        url = f"{BASE}/{self.db}/{path}?{urllib.parse.urlencode(q)}"
        headers = {"X-Authorization": self.token, "Cookie": f"idb_{self.db}={self.token}"}
        data = None
        if form is not None:
            if self.xsrf is None:
                self.xsrf = json.loads(self.call("GET", "xsrf", {"JSON": 1})[1]).get("_xsrf")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = urllib.parse.urlencode({**form, "_xsrf": self.xsrf}).encode()
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")


# --- пробы -----------------------------------------------------------------------------------
# kind: read — проверяется утечка в ответе; write — дифф базы.
# category: access (права/маски), process (правило процесса), validation (значения/уникальность),
#           control (разрешённое действие; должно пройти).

def t(req):
    return f"t{req}"


def probes(app: F.App) -> list:
    a_draft, a_review = app.app("alpha", "Черновик"), app.app("alpha", "На экспертизе")
    b_draft = app.app("beta", "Черновик")
    st, co, us = app.status, app.company, app.user
    foreign = [x["number"] for x in app.apps if x["company"] != "alpha"]
    new_app = lambda num, company, status, amount=None: {  # noqa: E731
        "up": "1", t(F.T_APP): num, t(F.R_APP_COMPANY): str(co[company]), t(F.R_APP_STATUS): str(st[status]),
        **({t(F.R_APP_AMOUNT): str(amount)} if amount is not None else {})}
    return [
        # --- чтение ---
        dict(id="R1", kind="read", category="access", user="alpha_user", expect="deny",
             what="список заявок: видны ли заявки чужих компаний",
             call=("GET", f"object/{F.T_APP}/", {"JSON": 1, "LIMIT": "0,100"}, None), leak=foreign,
             need=[a_draft["number"]]),
        dict(id="R2", kind="read", category="access", user="alpha_user", expect="deny",
             what="карточка чужой заявки по id",
             call=("GET", f"edit_obj/{b_draft['id']}", {"JSON": 1}, None),
             leak=[b_draft["number"], str(b_draft["amount"])]),
        dict(id="R3", kind="read", category="control", user="expert1", expect="allow",
             what="эксперт видит заявки всех компаний",
             call=("GET", f"object/{F.T_APP}/", {"JSON": 1, "LIMIT": "0,100"}, None), leak=[],
             need=[x["number"] for x in app.apps]),
        dict(id="R4", kind="read", category="control", user="alpha_user", expect="allow",
             what="заявитель открывает карточку своей заявки",
             call=("GET", f"edit_obj/{a_draft['id']}", {"JSON": 1}, None), leak=[],
             need=[a_draft["number"], str(a_draft["amount"])]),
        # --- запись: изоляция компаний ---
        dict(id="W1", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_save суммы в чужой заявке по id",
             call=("POST", f"_m_save/{b_draft['id']}", {"JSON": 1},
                   {t(F.T_APP): b_draft["number"], t(F.R_APP_AMOUNT): "1"})),
        dict(id="W2", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_set суммы в чужой заявке по id",
             call=("POST", f"_m_set/{b_draft['id']}", {"JSON": 1}, {t(F.R_APP_AMOUNT): "2"})),
        dict(id="W3", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_del чужой заявки по id",
             call=("POST", f"_m_del/{b_draft['id']}", {"JSON": 1}, {})),
        dict(id="W4", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_new заявки от имени чужой компании",
             call=("POST", f"_m_new/{F.T_APP}", {"JSON": 1}, new_app("З-901", "beta", "Черновик", 100))),
        dict(id="W11", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_batch: set суммы в чужой заявке",
             call=("POST", "_m_batch", {}, {"ops": json.dumps(
                 [{"op": "set", "id": b_draft["id"], "fields": {t(F.R_APP_AMOUNT): "3"}}])})),
        dict(id="W12", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_del_batch: массовое удаление вместе с чужой заявкой",
             call=("POST", f"_m_del_batch/{F.T_APP}", {"JSON": 1}, {"ids": str(b_draft["id"])})),
        # --- запись: статус через маску роли ---
        dict(id="W5", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_save: заявитель ставит своей заявке «Одобрена» (маска Статус < На экспертизе)",
             call=("POST", f"_m_save/{a_draft['id']}", {"JSON": 1},
                   {t(F.T_APP): a_draft["number"], t(F.R_APP_STATUS): str(st["Одобрена"])})),
        dict(id="W6", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_set: заявитель ставит своей заявке «Одобрена»",
             call=("POST", f"_m_set/{a_draft['id']}", {"JSON": 1}, {t(F.R_APP_STATUS): str(st["Одобрена"])})),
        dict(id="W7", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_new: заявитель создаёт заявку сразу «Одобрена»",
             call=("POST", f"_m_new/{F.T_APP}", {"JSON": 1}, new_app("З-902", "alpha", "Одобрена", 100))),
        # --- запись: права колонок ---
        dict(id="W8", kind="write", category="access", user="alpha_user", expect="deny",
             what="_m_set скрытой (BARRED) колонки «Эксперт»",
             call=("POST", f"_m_set/{a_draft['id']}", {"JSON": 1}, {t(F.R_APP_EXPERT): str(us["alpha_user"])})),
        dict(id="W9", kind="write", category="access", user="expert1", expect="deny",
             what="эксперт меняет сумму (колонка только для чтения)",
             call=("POST", f"_m_set/{a_review['id']}", {"JSON": 1}, {t(F.R_APP_AMOUNT): "1"})),
        dict(id="W10", kind="write", category="access", user="beta_user", expect="deny",
             what="зеркально W3: заявитель «Беты» удаляет заявку «Альфы»",
             call=("POST", f"_m_del/{a_draft['id']}", {"JSON": 1}, {})),
        # --- правила процесса (в ядре механизма нет — фиксируем фактическое поведение) ---
        dict(id="P1", kind="write", category="process", user="expert1", expect="deny",
             what="эксперт переводит «Черновик» сразу в «Одобрена» (переход в обход графа)",
             call=("POST", f"_m_set/{a_draft['id']}", {"JSON": 1}, {t(F.R_APP_STATUS): str(st["Одобрена"])})),
        dict(id="P2", kind="write", category="process", user="admin_f", expect="deny",
             what="сумма заявки выше лимита компании (5 000 000)",
             call=("POST", f"_m_set/{a_review['id']}", {"JSON": 1}, {t(F.R_APP_AMOUNT): "99000000"})),
        # --- значения и уникальность ---
        dict(id="V1", kind="write", category="validation", user="alpha_user", expect="deny",
             what="_m_new заявки без обязательной суммы",
             call=("POST", f"_m_new/{F.T_APP}", {"JSON": 1}, new_app("З-903", "alpha", "Черновик"))),
        dict(id="V2", kind="write", category="validation", user="alpha_user", expect="deny",
             what="_m_set суммы строкой «abc» (тип NUMBER)",
             call=("POST", f"_m_set/{a_draft['id']}", {"JSON": 1}, {t(F.R_APP_AMOUNT): "abc"})),
        dict(id="V3", kind="write", category="validation", user="admin_f", expect="deny",
             what="_m_new заявки с занятым номером (первая колонка уникальна)",
             call=("POST", f"_m_new/{F.T_APP}", {"JSON": 1}, new_app(app.apps[0]["number"], "alpha", "Черновик", 100))),
        dict(id="V4", kind="write", category="validation", user="admin_f", expect="deny",
             what="_m_save номера заявки на занятый",
             call=("POST", f"_m_save/{a_draft['id']}", {"JSON": 1}, {t(F.T_APP): app.apps[1]["number"]})),
        # --- контроль: разрешённые действия обязаны пройти ---
        dict(id="C1", kind="write", category="control", user="alpha_user", expect="allow",
             what="заявитель меняет сумму своей заявки",
             call=("POST", f"_m_set/{a_draft['id']}", {"JSON": 1}, {t(F.R_APP_AMOUNT): "777000"})),
        dict(id="C2", kind="write", category="control", user="alpha_user", expect="allow",
             what="заявитель создаёт свою заявку-черновик",
             call=("POST", f"_m_new/{F.T_APP}", {"JSON": 1}, new_app("З-904", "alpha", "Черновик", 100))),
        dict(id="C3", kind="write", category="control", user="alpha_user", expect="allow",
             what="заявитель подаёт свою заявку (Черновик → Подана)",
             call=("POST", f"_m_set/{a_draft['id']}", {"JSON": 1}, {t(F.R_APP_STATUS): str(st["Подана"])})),
        dict(id="C4", kind="write", category="control", user="expert1", expect="allow",
             what="эксперт одобряет заявку на экспертизе",
             call=("POST", f"_m_set/{a_review['id']}", {"JSON": 1}, {t(F.R_APP_STATUS): str(st["Одобрена"])})),
        dict(id="C5", kind="write", category="control", user="alpha_user", expect="allow",
             what="заявитель удаляет свой черновик",
             call=("POST", f"_m_del/{a_draft['id']}", {"JSON": 1}, {})),
    ]


def verdict(expect: str, happened: bool) -> str:
    if expect == "deny":
        return "VIOLATION" if happened else "held"
    return "ok" if happened else "FALSE-DENY"


def run_probe(p: dict, n: int) -> dict:
    db = f"r1008p{n}"
    tokens = {login: secrets.token_hex(16) for login, _, _ in F.USERS}
    app = F.App(tokens)
    mysql(F.build_sql(db, app))
    spec = next(x for x in probes(app) if x["id"] == p["id"])  # id сущностей — из этой сборки
    method, path, query, form = spec["call"]
    s = Session(db, tokens[spec["user"]])
    if form is not None:
        s.call("GET", "xsrf", {"JSON": 1})  # вход до снимка: служебные поля пользователя вне диффа
    before = snapshot(db)
    status, body = s.call(method, path, query, form)
    after = snapshot(db)
    changes = diff(before, after)
    rec = {k: spec[k] for k in ("id", "kind", "category", "user", "expect", "what")}
    rec.update(request={"method": method, "path": path, "query": query, "form": form},
               http=status, body=body[:600], db=db)
    if spec["kind"] == "read":
        leaked = [x for x in spec["leak"] if x in body]
        missing = [x for x in spec.get("need", []) if x not in body]
        rec.update(leaked=leaked, missing=missing, changes=changes)
        happened = bool(leaked) if spec["expect"] == "deny" else not missing
        if spec["expect"] == "deny" and missing:
            rec["note"] = "в ответе нет и своих данных — проба чтения недостоверна"
    else:
        rec["changes"] = changes
        happened = bool(changes)
    rec["verdict"] = verdict(spec["expect"], happened)
    mysql(f"DROP TABLE {db};")
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    only = {x for x in args.only.split(",") if x}
    plan = [p for p in probes(F.App({u: "x" for u, _, _ in F.USERS})) if not only or p["id"] in only]
    commit = (STAND / "crm.commit").read_text().strip() if (STAND / "crm.commit").exists() else "?"
    results = []
    for n, p in enumerate(plan, 1):
        r = run_probe(p, n)
        results.append(r)
        print(f"{r['id']:4} {r['verdict']:10} http={r['http']} Δ={len(r['changes'])} {r['what']}", flush=True)
    out = {"issue": "ideav/python2node#1008", "step": "probes", "crm_commit": commit,
           "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "results": results}
    path = Path(args.out or HERE.parent / "results" / f"probes-{datetime.date.today():%Y%m%d}.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
    print(f"→ {path}")


if __name__ == "__main__":
    main()
