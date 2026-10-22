"""Среды замера python2node#1055: B — ядро ideav.ru, A′ — PostgreSQL + PostgREST.

Обе среды несут одно приложение «Заявки на финансирование» из app/funding.py с одинаковыми
данными: данные A′ разбираются из строк ядра B. Драйвер среды умеет:
  deploy(config) — развернуть базу «base» (данные без защиты) или «reference» (эталонная защита);
  clone(src)     — скопировать собранную базу в рабочую (каждая проба идёт на своей копии);
  state()        — предметное состояние: заявки и лимиты компаний по именам, без id среды;
  force(...)     — предусловие пробы в обход защиты (сразу в таблицы, без API);
  act(...)       — действие пользователя через API среды, как это делает MCP-обёртка агента;
  journal(num)   — записи журнала об изменениях заявки: кто и каким каналом (R12).

Защита, которой нет в «base», в обеих средах одна и та же: админ фонда — владелец приложения
(в B — его гранты, в A′ — GRANT ALL на таблицы), эксперт и заявители не имеют прав ни на что.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "app"))
sys.path.insert(0, str(HERE.parent / "probes"))
import funding as F  # noqa: E402
import probe as P  # noqa: E402  mysql, snapshot (стенд ядра #1008)

COMPANY_NAME = {key: name for name, key, _ in F.COMPANIES}
# Поля и сущности, которые появляются правками цены изменения (CHANGES.md): имя в ТЗ → имя в среде.
COMPANY_NAME["delta"] = "ООО «Дельта»"
EXTRA_FIELDS = {"score": ("Внутренняя оценка", "internal_score")}
PG_ROLE = {"Админ фонда": "fund_admin", "Эксперт": "expert"}  # остальные — «Заявитель <компания>»


def pg_role(role_name: str) -> str:
    return PG_ROLE.get(role_name, "applicant")


def norm_num(v):
    """Число из любой среды — в одну запись: 1500000.00 и «1500000» равны."""
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return str(v)
    return str(d.quantize(Decimal(1))) if d == d.to_integral_value() else str(d.normalize())


def parse_core(rows) -> dict:
    """Строки ядра (id, up, ord, t, val) → сущности приложения с id ядра."""
    by_id = {r[0]: r for r in rows}
    kids = defaultdict(list)
    for r in rows:
        kids[r[1]].append(r)
    top = lambda t: [r for r in rows if r[1] == 1 and r[3] == t]  # noqa: E731
    roles = {r[0]: r[4] for r in top(F.ROLE)}
    out = {"statuses": [(r[0], r[4], r[2]) for r in top(F.T_STATUS)], "companies": [], "users": [], "apps": []}
    for cid, _, _, _, name in top(F.T_COMPANY):
        f = {k[3]: k[4] for k in kids[cid]}
        out["companies"].append((cid, name, f.get(F.R_COMPANY_INN), f.get(F.R_COMPANY_LIMIT)))
    for uid, _, _, _, login in top(F.USER):
        f = {k[3]: k[4] for k in kids[uid]}
        role = next((roles[k[3]] for k in kids[uid] if k[3] in roles), None)
        out["users"].append((uid, login, f.get(F.NAME_REQ), role))
    for aid, _, _, _, number in top(F.T_APP):
        rec = {"id": aid, "number": number, "company": None, "status": None, "expert": None,
               "amount": None, "revenue": None, "description": None, "verdict": None}
        for _, _, _, t, v in kids[aid]:
            if v == str(F.R_APP_COMPANY):
                rec["company"] = t
            elif v == str(F.R_APP_STATUS):
                rec["status"] = t
            elif v == str(F.R_APP_EXPERT):
                rec["expert"] = t
            elif t == F.R_APP_AMOUNT:
                rec["amount"] = v
            elif t == F.R_APP_REVENUE:
                rec["revenue"] = v
            elif t == F.R_APP_TEXT:
                rec["description"] = v
            elif t == F.R_APP_VERDICT:
                rec["verdict"] = v
        out["apps"].append(rec)
    out["names"] = {i: r[4] for i, r in by_id.items()}
    return out


def domain(core: dict) -> dict:
    """Предметное состояние из разбора ядра: по именам, числа нормализованы."""
    name = core["names"]
    apps = {a["number"]: {"company": name.get(a["company"]), "status": name.get(a["status"]),
                          "expert": name.get(a["expert"]), "amount": norm_num(a["amount"]),
                          "revenue": norm_num(a["revenue"]), "description": a["description"] or None,
                          "verdict": a["verdict"] or None} for a in core["apps"]}
    return {"apps": apps, "companies": {c[1]: norm_num(c[3]) for c in core["companies"]}}


def seed_app(tokens: dict) -> F.App:
    return F.App(tokens)


def base_rows(app: F.App) -> list:
    """Строки ядра без защиты: гранты эксперта и заявителей сняты, обязательность суммы снята."""
    owner = app.role["Админ фонда"]
    grants = {r[0] for r in app.rows if r[3] == F.ROLE_OBJECT and r[1] != owner}
    out = []
    for r in app.rows:
        if r[0] in grants or r[1] in grants:
            continue
        if r[0] == F.R_APP_AMOUNT:
            r = (*r[:4], "")
        out.append(r)
    return out


# --- B: ядро ideav.ru -----------------------------------------------------------------------

class CoreEnv:
    """Ядро ideav.ru на стенде #1008 (stand/stand.sh). База ядра — таблица MariaDB с именем базы."""
    name = "B"
    base_url = f"http://127.0.0.1:{os.getenv('R1008_PORT', '18681')}"
    logs = Path(os.getenv("R1008_STAND", "/root/crm1008-stand")) / "logs"

    def __init__(self, db: str):
        self.db, self.xsrf = db, {}
        self.tokens = json.loads(self._tokens_file(db).read_text()) if self._tokens_file(db).exists() else {}

    @classmethod
    def _tokens_file(cls, db: str) -> Path:
        return cls.logs.parent / f"{db}.tokens.json"

    # развёртывание
    def deploy(self, config: str):
        self.tokens = {login: secrets.token_hex(16) for login, _, _ in F.USERS}
        app = seed_app(self.tokens)
        if config == "base":
            app.rows = base_rows(app)
        P.mysql(F.build_sql(self.db, app))
        self._tokens_file(self.db).write_text(json.dumps(self.tokens))

    def clone(self, src: str):
        P.mysql(f"DROP TABLE IF EXISTS {self.db};\nCREATE TABLE {self.db} LIKE {src};\n"
                f"INSERT INTO {self.db} SELECT * FROM {src};\n")
        self.tokens = json.loads(self._tokens_file(src).read_text())
        self.xsrf = {}
        for kind in ("log", "sql"):
            (self.logs / f"{self.db}_{kind}.jsonl").unlink(missing_ok=True)

    def drop(self):
        P.mysql(f"DROP TABLE IF EXISTS {self.db};")

    def rows(self):
        return [(i, u, o, t, v) for i, (u, o, t, v) in P.snapshot(self.db).items()]

    def state(self) -> dict:
        return domain(parse_core(self.rows()))

    def _id(self, t: int, val: str):
        r = P.mysql(f"SELECT id FROM {self.db} WHERE up=1 AND t={t} AND val={F.sql_quote(val)}")
        return int(r[0][0]) if r else None

    def _ref(self, field: str, value):
        if field == "company":
            return self._id(F.T_COMPANY, COMPANY_NAME[value])
        if field == "status":
            return self._id(F.T_STATUS, value)
        if field == "expert":
            return self._id(F.USER, value)
        return None

    REQ = {"company": F.R_APP_COMPANY, "status": F.R_APP_STATUS, "expert": F.R_APP_EXPERT,
           "amount": F.R_APP_AMOUNT, "revenue": F.R_APP_REVENUE, "description": F.R_APP_TEXT,
           "verdict": F.R_APP_VERDICT}

    def _req(self, field: str):
        """Реквизит заявки: штатный — по id, добавленный правкой — по имени его типа."""
        if field in self.REQ:
            return self.REQ[field]
        r = P.mysql(f"SELECT r.id FROM {self.db} r JOIN {self.db} ty ON ty.id = r.t "
                    f"WHERE r.up = {F.T_APP} AND ty.val = {F.sql_quote(EXTRA_FIELDS[field][0])}")
        return int(r[0][0]) if r else None

    def _form(self, fields: dict) -> dict:
        form = {}
        for k, v in fields.items():
            if k == "number":
                form[f"t{F.T_APP}"] = v
            elif k in ("company", "status", "expert"):
                form[f"t{self.REQ[k]}"] = str(self._ref(k, v))
            else:
                form[f"t{self._req(k)}"] = "" if v is None else str(v)
        return form

    def field_value(self, number: str, field: str):
        aid, req = self._id(F.T_APP, number), self._req(field)
        r = P.mysql(f"SELECT val FROM {self.db} WHERE up={aid} AND t={req}") if aid and req else []
        return r[0][0] if r else None

    # предусловие в обход API
    def force(self, number: str, field: str, value):
        aid = self._id(F.T_APP, number)
        req = self._req(field)
        if field in ("company", "status", "expert"):
            P.mysql(f"DELETE FROM {self.db} WHERE up={aid} AND val='{req}';\n"
                    f"INSERT INTO {self.db} (id, up, ord, t, val) SELECT MAX(id)+1, {aid}, 0, "
                    f"{self._ref(field, value)}, '{req}' FROM {self.db};")
        else:
            P.mysql(f"DELETE FROM {self.db} WHERE up={aid} AND t={req};\n"
                    f"INSERT INTO {self.db} (id, up, ord, t, val) SELECT MAX(id)+1, {aid}, 0, {req}, "
                    f"{F.sql_quote(str(value))} FROM {self.db};")

    # API ядра
    def _call(self, login: str, via: str, method: str, path: str, query: dict = None, form: dict = None):
        q = dict(query or {})
        if via == "ai":
            q.update({"client": "ai", "ai_job": "probe-1055"})
        token = self.tokens[login]
        headers = {"X-Authorization": token, "Cookie": f"idb_{self.db}={token}"}
        data = None
        if form is not None:
            if login not in self.xsrf:
                self.xsrf[login] = json.loads(self._call(login, via, "GET", "xsrf", {"JSON": 1})[1]).get("_xsrf")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = urllib.parse.urlencode({**form, "_xsrf": self.xsrf[login]}).encode()
        url = f"{self.base_url}/{self.db}/{path}?{urllib.parse.urlencode(q)}"
        return http(urllib.request.Request(url, data=data, method=method, headers=headers))

    def login(self, login: str, via: str):
        """Вход до снимка: служебные поля пользователя ядро пишет при первом запросе.
        Пользователю, созданному правкой, токен выдаётся здесь — строкой ядра, как при входе."""
        if login not in self.tokens:
            uid = self._id(F.USER, login)
            self.tokens[login] = secrets.token_hex(16)
            P.mysql(f"DELETE FROM {self.db} WHERE up={uid} AND t={F.TOKEN_REQ};\n"
                    f"INSERT INTO {self.db} (id, up, ord, t, val) SELECT MAX(id)+1, {uid}, 0, {F.TOKEN_REQ}, "
                    f"'{self.tokens[login]}' FROM {self.db};")
        self.xsrf[login] = json.loads(self._call(login, via, "GET", "xsrf", {"JSON": 1})[1]).get("_xsrf")

    def act(self, login: str, via: str, op: str, number: str = None, fields: dict = None, select=None):
        fields = fields or {}
        if op == "list":
            return self._call(login, via, "GET", f"object/{F.T_APP}/", {"JSON": 1, "LIMIT": "0,100"})
        if op == "create":
            return self._call(login, via, "POST", f"_m_new/{F.T_APP}", {"JSON": 1}, {"up": "1", **self._form(fields)})
        aid = self._id(F.T_APP, number)
        if op == "get":
            return self._call(login, via, "GET", f"edit_obj/{aid}", {"JSON": 1})
        if op == "update":
            return self._call(login, via, "POST", f"_m_set/{aid}", {"JSON": 1}, self._form(fields))
        if op == "delete":
            return self._call(login, via, "POST", f"_m_del/{aid}", {"JSON": 1}, {})
        raise ValueError(op)

    def journal(self, number: str, before_rows=None) -> list:
        """Записи журнала изменений данных (logs/<db>_sql.jsonl), касающиеся заявки и её полей."""
        rows = before_rows or self.rows()
        aid = next((i for i, u, _, t, v in rows if u == 1 and t == F.T_APP and v == number), None)
        ids = {aid} | {i for i, u, *_ in rows if u == aid}
        out = []
        path = self.logs / f"{self.db}_sql.jsonl"
        for line in path.read_text("utf-8").splitlines() if path.exists() else []:
            rec = json.loads(line)
            if rec.get("id") in ids or rec.get("up") == aid:
                user = rec.get("user") or ""
                out.append({"actor": user.removesuffix("~ai"), "via": "ai" if user.endswith("~ai") else "human",
                            "op": rec.get("op")})
        return out


# --- A′: PostgreSQL + PostgREST -------------------------------------------------------------

def jwt(secret: str, claims: dict) -> str:
    enc = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    head = enc(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = enc(json.dumps(claims, ensure_ascii=False).encode())
    sig = hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest()
    return f"{head}.{body}.{enc(sig)}"


def http(req):
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def seed_sql_a1() -> str:
    """Данные A′ — те же сущности, что в ядре: id компаний, статусов и заявок совпадают с B."""
    core = parse_core(seed_app({u: "-" for u, _, _ in F.USERS}).rows)
    name = core["names"]
    q = lambda v: "NULL" if v is None or v == "" else "'" + str(v).replace("'", "''") + "'"  # noqa: E731
    company_of = {}
    for uid, login, fio, role in core["users"]:
        key = role.removeprefix("Заявитель ") if role.startswith("Заявитель ") else None
        company_of[login] = next((c[0] for c in core["companies"] if key and COMPANY_NAME[key] == c[1]), None)
    lines = ["INSERT INTO api.company (id, name, inn, funding_limit) VALUES " + ", ".join(
        f"({c[0]}, {q(c[1])}, {q(c[2])}, {q(c[3])})" for c in core["companies"]) + ";",
        "INSERT INTO api.status (id, name, ord) VALUES " + ", ".join(
            f"({s[0]}, {q(s[1])}, {s[2]})" for s in core["statuses"]) + ";",
        "INSERT INTO api.app_user (login, fio, role, company_id) VALUES " + ", ".join(
            f"({q(u[1])}, {q(u[2])}, {q(pg_role(u[3]))}, {q(company_of[u[1]])})" for u in core["users"]) + ";",
        "INSERT INTO api.application (id, number, company_id, status_id, amount, revenue, description, expert, verdict)"
        " VALUES " + ", ".join(
            f"({a['id']}, {q(a['number'])}, {a['company']}, {a['status']}, {q(a['amount'])}, {q(a['revenue'])}, "
            f"{q(a['description'])}, {q(name.get(a['expert']))}, {q(a['verdict'])})" for a in core["apps"]) + ";",
        "SELECT setval(pg_get_serial_sequence('api.application', 'id'), (SELECT max(id) FROM api.application));"]
    return "\n".join(lines) + "\n"


class PgrstEnv:
    """PostgreSQL + PostgREST (a1/stand.sh). PostgREST смотрит в базу «app»; пробы копируют
    собранную базу в «app» шаблоном (CREATE DATABASE … TEMPLATE)."""
    name = "A1"
    stand = Path(os.getenv("R1055_A1_STAND", "/root/crm1055a"))
    base_url = f"http://127.0.0.1:{os.getenv('R1055_A1_PORT', '18690')}"
    container = os.getenv("R1055_A1_DB", "crm1055a-db")
    WORK = "app"

    def __init__(self, db: str = WORK):
        self.db = db
        env = dict(line.split("=", 1) for line in (self.stand / ".env").read_text().split() if "=" in line)
        self.secret = env["JWT_SECRET"]
        self.users = {}

    def psql(self, sql: str, db: str = None) -> str:
        p = subprocess.run(["docker", "exec", "-i", self.container, "psql", "-U", "postgres", "-d", db or self.db,
                            "-v", "ON_ERROR_STOP=1", "-At", "-q"], input=sql.encode(), capture_output=True)
        if p.returncode:
            raise RuntimeError(f"psql: {p.stderr.decode('utf-8', 'replace')[-800:]}")
        return p.stdout.decode("utf-8")

    def _recreate(self, template: str = None):
        tpl = f" TEMPLATE {template}" if template else ""
        self.psql(f"DROP DATABASE IF EXISTS {self.db} WITH (FORCE);", "postgres")  # PostgREST держит пул
        self.psql(f"CREATE DATABASE {self.db}{tpl};", "postgres")

    def deploy(self, config: str):
        self._recreate()
        sql = (HERE / "a1" / "schema.sql").read_text("utf-8") + seed_sql_a1()
        if config == "reference":
            sql += (HERE / "a1" / "reference.sql").read_text("utf-8")
        self.psql(sql)

    def clone(self, src: str):
        self._recreate(src)
        self.users = {}
        self.ready()

    def drop(self):
        pass

    def ready(self, timeout: float = 30):
        """После пересоздания базы PostgREST переподключается и перечитывает схему."""
        self.psql("NOTIFY pgrst, 'reload schema';")
        tok = self.token("admin_f")
        t0 = time.time()
        while time.time() - t0 < timeout:
            st, _ = http(urllib.request.Request(f"{self.base_url}/company?limit=1",
                                                headers={"Authorization": f"Bearer {tok}"}))
            if st == 200:
                return
            time.sleep(0.3)
        raise RuntimeError("PostgREST не поднялся после пересоздания базы")

    def token(self, login: str) -> str:
        if login not in self.users:
            self.users = dict(line.split("|") for line in self.psql(
                "SELECT login, role FROM api.app_user;").splitlines())
        return jwt(self.secret, {"role": self.users[login], "login": login, "exp": int(time.time()) + 3600})

    def state(self) -> dict:
        out = json.loads(self.psql("""
            SELECT json_build_object(
              'apps', coalesce((SELECT json_object_agg(a.number, json_build_object(
                  'company', c.name, 'status', s.name, 'expert', a.expert, 'amount', a.amount::text,
                  'revenue', a.revenue::text, 'description', a.description, 'verdict', a.verdict))
                FROM api.application a LEFT JOIN api.company c ON c.id = a.company_id
                LEFT JOIN api.status s ON s.id = a.status_id), '{}'),
              'companies', (SELECT json_object_agg(name, funding_limit::text) FROM api.company));"""))
        for a in out["apps"].values():
            for k in ("amount", "revenue"):
                a[k] = norm_num(a[k])
            for k in ("description", "verdict"):
                a[k] = a[k] or None
        out["companies"] = {k: norm_num(v) for k, v in out["companies"].items()}
        return out

    def _ref(self, field: str, value):
        table, col = {"company": ("company", "name"), "status": ("status", "name")}[field]
        name = COMPANY_NAME[value] if field == "company" else value
        return int(self.psql(f"SELECT id FROM api.{table} WHERE {col} = '{name}';").strip())

    def _body(self, fields: dict) -> dict:
        body = {}
        for k, v in fields.items():
            if k in ("company", "status"):
                body[f"{k}_id"] = self._ref(k, v)
            else:
                body[EXTRA_FIELDS[k][1] if k in EXTRA_FIELDS else k] = v
        return body

    def field_value(self, number: str, field: str):
        col = EXTRA_FIELDS[field][1] if field in EXTRA_FIELDS else field
        try:
            out = self.psql(f"SELECT {col} FROM api.application WHERE number = '{number}';").strip()
        except RuntimeError:
            return None
        return out or None

    def force(self, number: str, field: str, value):
        col = f"{field}_id" if field in ("company", "status") else EXTRA_FIELDS.get(field, (0, field))[1]
        val = self._ref(field, value) if field in ("company", "status") else (
            "NULL" if value is None else "'" + str(value).replace("'", "''") + "'")
        self.psql(f"SET session_replication_role = replica;\n"
                  f"UPDATE api.application SET {col} = {val} WHERE number = '{number}';")

    def _call(self, login: str, via: str, method: str, path: str, body=None):
        headers = {"Authorization": f"Bearer {self.token(login)}", "Content-Type": "application/json",
                   "Prefer": "return=minimal"}
        if via == "ai":
            headers["X-Client"] = "ai"
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        return http(urllib.request.Request(f"{self.base_url}/{path}", data=data, method=method, headers=headers))

    def login(self, login: str, via: str):
        pass

    def act(self, login: str, via: str, op: str, number: str = None, fields: dict = None, select=None):
        sel = select or "number,company_id,status_id,amount,revenue,description,verdict"
        num = urllib.parse.quote(f"eq.{number}") if number else ""
        if op == "list":
            return self._call(login, via, "GET", f"application?select={sel}")
        if op == "get":
            return self._call(login, via, "GET", f"application?number={num}&select={sel}")
        if op == "create":
            return self._call(login, via, "POST", "application", self._body(fields or {}))
        if op == "update":
            return self._call(login, via, "PATCH", f"application?number={num}", self._body(fields or {}))
        if op == "delete":
            return self._call(login, via, "DELETE", f"application?number={num}")
        raise ValueError(op)

    def journal(self, number: str, before_rows=None) -> list:
        """Журнал по контракту ТЗ: api.audit (actor, via, op, app_id). Нет журнала — пусто."""
        try:
            out = self.psql(f"""SELECT coalesce(json_agg(json_build_object('actor', actor, 'via', via, 'op', op)), '[]')
                FROM api.audit WHERE app_id = (SELECT id FROM api.application WHERE number = '{number}');""")
        except RuntimeError:
            return []
        return json.loads(out)

    def rows(self):
        return None


def env(kind: str, db: str = None):
    if kind == "b":
        return CoreEnv(db or "e1055b")
    if kind == "a1":
        return PgrstEnv(db or PgrstEnv.WORK)
    raise ValueError(kind)
