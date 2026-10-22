"""Среды замера python2node#1060: B — ядро ideav.ru, A′ — одна PostgreSQL + PostgREST, A″ — две системы.

Драйверы наследуют драйверы #1055 (effort/envs.py) и добавляют то, что нужно задачам T1 и T2:
  deploy("start")       — стартовый набор (integ/seed.py) с эталонной защитой #1055 своей среды;
  save(name)/clone(src) — снимок рабочей базы и восстановление из него (у A″ — обеих систем сразу);
  state()               — предметное состояние: заявки, компании (ИНН, лимит), договоры — по именам;
  force_contracts(...)  — договоры в обход защиты (предусловие проб T1);
  force_company(...)    — правка лимита или названия компании в источнике (пробы «данные не копируются»);
  contract_act(...)     — действие пользователя с договорами через API среды;
  report(login)         — строки отчёта «Остаток лимита» в одной записи для всех сред.
Договоры и отчёт агент строит сам: драйвер находит их по именам из ТЗ (TASK_T1.md).
"""
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
EFFORT = HERE.parent / "effort"
sys.path.insert(0, str(EFFORT))
sys.path.insert(0, str(HERE))
import envs as E  # noqa: E402
import seed as S  # noqa: E402

F, P = E.F, E.P
norm_num = E.norm_num
REPORT_NAME = "Остаток лимита"
REPORT_COLS = {"company": "Компания", "limit": "Лимит", "approved": "Одобрено",
               "contracted": "Законтрактовано", "remaining": "Остаток"}
PG_REPORT_COLS = {"company": "company", "limit": "funding_limit", "approved": "approved",
                  "contracted": "contracted", "remaining": "remaining"}


def probe_http(url: str, token: str) -> int:
    """Код ответа PostgREST; пока он переподключается к пересозданной базе — 0."""
    try:
        return E.http(urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}))[0]
    except OSError:
        return 0


def q(v) -> str:
    return "NULL" if v is None or v == "" else "'" + str(v).replace("'", "''") + "'"


def norm_date(v):
    """20261001, 01.10.2026, 2026-10-01 → 2026-10-01."""
    if not v:
        return None
    v = str(v)
    if re.fullmatch(r"\d{8}", v):
        return f"{v[:4]}-{v[4:6]}-{v[6:]}"
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", v)
    return f"{m[3]}-{m[2]}-{m[1]}" if m else v[:10]


def norm_report(rows, cols: dict):
    """Строки отчёта → [{company, limit, approved, contracted, remaining}]; пустое «одобрено/законтрактовано» = 0."""
    if not isinstance(rows, list):
        return None
    out = []
    for r in rows:
        if not isinstance(r, dict):
            return None
        rec = {k: r.get(c) for k, c in cols.items()}
        for k in ("limit", "approved", "contracted", "remaining"):
            v = rec[k]
            rec[k] = norm_num(v) if v not in (None, "") else ("0" if k in ("approved", "contracted") else None)
        out.append(rec)
    return out


def seed_sql(kind: str) -> str:
    """Данные PostgreSQL-сред из строк ядра стартового набора: id статусов и заявок совпадают с B.
    a1 — компании в api.company (id как в ядре); a2 — компаний в S1 нет, ссылка по ИНН."""
    core = E.parse_core(S.app({u: "-" for u in S.LOGINS}).rows)
    name = core["names"]
    inn = {c[0]: c[2] for c in core["companies"]}
    company_of = {}
    for _, login, _, role in core["users"]:
        key = role.removeprefix("Заявитель ") if role and role.startswith("Заявитель ") else None
        company_of[login] = next((c[0] for c in core["companies"] if key and S.COMPANY_NAME[key] == c[1]), None)
    pg_role = lambda r: "anon" if r is None else E.pg_role(r)  # noqa: E731
    ref = (lambda cid: q(cid)) if kind == "a1" else (lambda cid: q(inn.get(cid)))  # noqa: E731
    col = "company_id" if kind == "a1" else "company_inn"
    lines = []
    if kind == "a1":
        lines.append("INSERT INTO api.company (id, name, inn, funding_limit) VALUES " + ", ".join(
            f"({c[0]}, {q(c[1])}, {q(c[2])}, {q(c[3])})" for c in core["companies"]) + ";")
    lines += [
        "INSERT INTO api.status (id, name, ord) VALUES " + ", ".join(
            f"({s[0]}, {q(s[1])}, {s[2]})" for s in core["statuses"]) + ";",
        f"INSERT INTO api.app_user (login, fio, role, {col}) VALUES " + ", ".join(
            f"({q(u[1])}, {q(u[2])}, {q(pg_role(u[3]))}, {ref(company_of[u[1]])})" for u in core["users"]) + ";",
        f"INSERT INTO api.application (id, number, {col}, status_id, amount, revenue, description, expert, verdict)"
        " VALUES " + ", ".join(
            f"({a['id']}, {q(a['number'])}, {ref(a['company'])}, {a['status']}, {q(a['amount'])}, {q(a['revenue'])}, "
            f"{q(a['description'])}, {q(name.get(a['expert']))}, {q(a['verdict'])})" for a in core["apps"]) + ";",
        "SELECT setval(pg_get_serial_sequence('api.application', 'id'), (SELECT max(id) FROM api.application));"]
    return "\n".join(lines) + "\n"


def registry_sql() -> str:
    return "INSERT INTO api.counterparty (inn, legal_name, funding_limit) VALUES " + ", ".join(
        f"({q(S.COMPANY_INN[key])}, {q(name)}, {limit})" for name, key, limit in F.COMPANIES) + ";\n"


# --- B: ядро ideav.ru -----------------------------------------------------------------------

class IntegCoreEnv(E.CoreEnv):
    name = "B"

    def deploy(self, config: str = "start"):
        assert config == "start", config
        self.tokens = {login: secrets.token_hex(16) for login in S.LOGINS}
        app = S.app(self.tokens)
        app.rows = E.ideav_rows(app.rows)
        P.mysql(F.build_sql(self.db, app, E.TEMPLATE_B))
        self._tokens_file(self.db).write_text(json.dumps(self.tokens))
        self.xsrf = {}

    def ready(self):
        pass

    def clone(self, src: str):
        super().clone(src)
        self._tokens_file(self.db).write_text(json.dumps(self.tokens))  # токены читает MCP-сервер агента

    def drop_snapshot(self, name: str):
        IntegCoreEnv(name).drop()
        self._tokens_file(name).unlink(missing_ok=True)

    def save(self, name: str):
        dst = IntegCoreEnv(name)
        dst.clone(self.db)
        self._tokens_file(name).write_text(json.dumps(self.tokens))

    # схема договоров, которую строит агент: по именам из ТЗ
    def schema(self, rows=None) -> dict:
        rows = rows if rows is not None else self.rows()
        by = {r[0]: r for r in rows}
        tables = sorted(r[0] for r in rows if r[1] == 0 and r[4] == "Договор")
        if not tables:
            return {}
        sch = {"table": tables[0]}
        for i, u, _, t, v in rows:
            if u != sch["table"] or t not in by:
                continue
            ty = by[t]
            try:
                alias = (json.loads(v) or {}).get("alias", "") if v.startswith("{") else ""
            except ValueError:
                alias = ""
            if ty[4] == "" and ty[3] in by and by[ty[3]][1] == 0:  # ссылка: тип без имени, t = целевая таблица
                target = ty[3]
                label = (alias or by[target][4]).lower()
                if target == F.T_APP:
                    sch["app"] = i
                elif "статус" in label or "статус" in by[target][4].lower():
                    sch["status"], sch["status_ref"] = i, target
            else:
                label = (alias or ty[4]).lower()
                if label.startswith("сумма"):
                    sch["amount"] = i
                elif label.startswith("дата"):
                    sch["date"] = i
                elif label.startswith("статус"):
                    sch["status"] = i
        return sch

    def _contracts(self, rows, sch) -> dict:
        if not sch.get("table"):
            return {}
        by = {r[0]: r for r in rows}
        kids = {}
        for r in rows:
            kids.setdefault(r[1], []).append(r)
        out = {}
        for cid, _, _, t, num in rows:
            if t != sch["table"] or by[cid][1] != 1:
                continue
            rec = {"app": None, "amount": None, "status": None, "date": None}
            for _, _, _, kt, kv in kids.get(cid, []):
                if sch.get("app") and kv == str(sch["app"]) and kt in by:
                    rec["app"] = by[kt][4]
                elif sch.get("status_ref") and kv == str(sch["status"]) and kt in by:
                    rec["status"] = by[kt][4]
                elif kt == sch.get("amount"):
                    rec["amount"] = norm_num(kv)
                elif kt == sch.get("date"):
                    rec["date"] = norm_date(kv)
                elif kt == sch.get("status") and not sch.get("status_ref"):
                    rec["status"] = kv
            out[num] = rec
        return out

    def state(self) -> dict:
        rows = self.rows()
        core = E.parse_core(rows)
        d = E.domain(core)
        return {"apps": {n: {"company": a["company"], "status": a["status"], "amount": a["amount"]}
                         for n, a in d["apps"].items()},
                "companies": {c[1]: {"inn": c[2], "limit": norm_num(c[3])} for c in core["companies"]},
                "contracts": self._contracts(rows, self.schema(rows))}

    def _company_id(self, key: str):
        r = P.mysql(f"SELECT c.id FROM {self.db} c JOIN {self.db} i ON i.up = c.id AND i.t = {F.R_COMPANY_INN} "
                    f"WHERE c.up = 1 AND c.t = {F.T_COMPANY} AND i.val = {F.sql_quote(S.COMPANY_INN[key])}")
        return int(r[0][0]) if r else None

    def force_company(self, key: str, field: str, value):
        cid = self._company_id(key)
        if field == "name":
            P.mysql(f"SET NAMES utf8mb4;\nUPDATE {self.db} SET val = {F.sql_quote(value)} WHERE id = {cid};")
        else:
            P.mysql(f"UPDATE {self.db} SET val = '{value}' WHERE up = {cid} AND t = {F.R_COMPANY_LIMIT};")

    def _status_id(self, sch, status):
        r = P.mysql(f"SET NAMES utf8mb4;\nSELECT id FROM {self.db} WHERE up = 1 AND t = {sch['status_ref']} "
                    f"AND val = {F.sql_quote(status)}")
        if not r:
            raise KeyError(f"нет значения «{status}» в справочнике статусов договора")
        return int(r[0][0])

    def force_contracts(self, contracts):
        import changes as C  # effort/changes.py: вставка строк ядра
        sch = self.schema()
        if not all(k in sch for k in ("table", "app", "amount", "status")):
            raise KeyError(f"нет таблицы «Договор» или её колонок: {sch}")
        rows = []
        for n, (num, app, amount, status, date) in enumerate(contracts):
            k = f"c{n}"
            rows += [(k, 1, n + 1, sch["table"], num), (f"{k}a", k, 1, self._id(F.T_APP, app), str(sch["app"])),
                     (f"{k}s", k, 2, sch["amount"], str(amount))]
            if sch.get("status_ref"):
                rows.append((f"{k}t", k, 3, self._status_id(sch, status), str(sch["status"])))
            else:
                rows.append((f"{k}t", k, 3, sch["status"], status))
            if date and sch.get("date"):
                rows.append((f"{k}d", k, 4, sch["date"], date.replace("-", "")))
        C._core_insert(self, rows)

    def _contract_form(self, sch, fields: dict, number=None) -> dict:
        form = {} if number is None else {f"t{sch['table']}": number}
        for k, v in fields.items():
            if k == "number":
                form[f"t{sch['table']}"] = v
            elif k == "app":
                form[f"t{sch['app']}"] = str(self._id(F.T_APP, v))
            elif k == "amount":
                form[f"t{sch['amount']}"] = str(v)
            elif k == "date":
                d = norm_date(v)
                form[f"t{sch['date']}"] = f"{d[8:10]}.{d[5:7]}.{d[:4]}"
            elif k == "status":
                form[f"t{sch['status']}"] = str(self._status_id(sch, v)) if sch.get("status_ref") else v
        return form

    def contract_act(self, login: str, op: str, number: str = None, fields: dict = None, via: str = "human"):
        sch = self.schema()
        if not sch.get("table"):
            raise KeyError("нет таблицы «Договор»")
        if op == "list":
            return self._call(login, via, "GET", f"object/{sch['table']}/", {"JSON_OBJ": 1, "LIMIT": "0,100"})
        if op == "create":
            return self._call(login, via, "POST", f"_m_new/{sch['table']}", {"JSON": 1},
                              {"up": "1", **self._contract_form(sch, fields or {}, number)})
        cid = self._id(sch["table"], number)
        if op == "update":
            return self._call(login, via, "POST", f"_m_set/{cid}", {"JSON": 1}, self._contract_form(sch, fields or {}))
        if op == "delete":
            return self._call(login, via, "POST", f"_m_del/{cid}", {"JSON": 1}, {})
        raise ValueError(op)

    def report(self, login: str = "admin_f"):
        rid = self._id(22, REPORT_NAME)
        if rid is None:
            return 404, None
        self.login(login, "human")
        st, body = self._call(login, "human", "GET", f"report/{rid}", {"JSON_KV": 1})
        try:
            return st, norm_report(json.loads(body), REPORT_COLS)
        except ValueError:
            return st, None

    def api(self, login: str, method: str, path: str, form: dict = None):
        """Запрос к API ядра для эталонных решений (как инструмент api агента)."""
        p, qs = (path.split("?", 1) + [""])[:2]
        if login not in self.xsrf:
            self.login(login, "human")
        st, body = self._call(login, "human", method, p, dict(urllib.parse.parse_qsl(qs, keep_blank_values=True)),
                              {k: str(v) for k, v in (form or {}).items()} if method == "POST" else None)
        if st >= 400 or '"error"' in body[:200]:
            raise RuntimeError(f"{method} {path}: HTTP {st} {body[:300]}")
        try:
            return json.loads(body)
        except ValueError:
            return body


# --- A′: одна PostgreSQL + PostgREST ----------------------------------------------------------

class IntegPgEnv(E.PgrstEnv):
    """A′: база app на стенде crm1055a. Снимки — базы того же кластера (CREATE DATABASE … TEMPLATE)."""
    name = "A1"
    KIND = "a1"
    SCHEMA = EFFORT / "a1" / "schema.sql"
    REFERENCE = EFFORT / "a1" / "reference.sql"
    T1_REFERENCE = HERE / "a1" / "t1_reference.sql"
    COMPANY_COL = "company_id"

    def cluster_roles(self):
        """Роль lawyer (без прав) заводится в кластере заранее, как роли #1055: роль кластера переживает
        пересоздание базы, и созданная агентом в одном прогоне попала бы в старт следующего."""
        self.psql("""DO $$ BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lawyer') THEN CREATE ROLE lawyer NOLOGIN; END IF;
            GRANT lawyer TO authenticator;
        END $$;""", "postgres")

    def start_sql(self) -> str:
        return (self.SCHEMA.read_text("utf-8") + seed_sql(self.KIND) + self.REFERENCE.read_text("utf-8"))

    def deploy(self, config: str = "start"):
        assert config == "start", config
        self.cluster_roles()
        self._recreate()
        self.psql(self.start_sql())
        self.users = {}

    def save(self, name: str):
        for _ in range(20):
            try:
                self.psql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE);", "postgres")
                self.psql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{self.db}' "
                          f"AND pid <> pg_backend_pid();\nCREATE DATABASE {name} TEMPLATE {self.db};", "postgres")
                return
            except RuntimeError:
                time.sleep(0.5)  # PostgREST успел переподключиться — ещё раз
        raise RuntimeError(f"снимок {self.db} → {name} не снят")

    def clone(self, src: str):
        for _ in range(20):
            try:
                self.psql(f"DROP DATABASE IF EXISTS {self.db} WITH (FORCE);", "postgres")
                self.psql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{src}';\n"
                          f"CREATE DATABASE {self.db} TEMPLATE {src};", "postgres")
                break
            except RuntimeError:
                time.sleep(0.5)
        else:
            raise RuntimeError(f"копия {src} → {self.db} не снята")
        self.users = {}
        self.ready()

    def drop_snapshot(self, name: str):
        self.psql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE);", "postgres")

    def ready(self, timeout: float = 30):
        self.psql("NOTIFY pgrst, 'reload schema';")
        tok = self.token("admin_f")
        t0 = time.time()
        while time.time() - t0 < timeout:
            if probe_http(f"{self.base_url}/application?limit=1", tok) == 200:
                return
            time.sleep(0.3)
        raise RuntimeError("PostgREST не поднялся после пересоздания базы")

    def login(self, login: str, via: str):
        self.users = {}  # роль пользователя могли поменять правкой

    # состояние
    def _companies(self) -> dict:
        out = json.loads(self.psql("SELECT coalesce(json_object_agg(name, json_build_object('inn', inn, "
                                   "'limit', funding_limit::text)), '{}') FROM api.company;"))
        return {k: {"inn": v["inn"], "limit": norm_num(v["limit"])} for k, v in out.items()}

    def _apps(self) -> dict:
        """number → {company: id компании или ИНН, status, amount}; компания по имени — в state()."""
        out = json.loads(self.psql(f"""SELECT coalesce(json_object_agg(a.number, json_build_object(
              'company', a.{self.COMPANY_COL}::text, 'status', s.name, 'amount', a.amount::text)), '{{}}')
            FROM api.application a LEFT JOIN api.status s ON s.id = a.status_id;"""))
        return out

    def _contracts(self) -> dict:
        if not self.psql("SELECT to_regclass('api.contract');").strip():
            return {}
        try:
            out = json.loads(self.psql("""SELECT coalesce(json_object_agg(k.number, json_build_object(
                  'app', a.number, 'amount', k.amount::text, 'status', k.status::text, 'date', k.signed_on::text)), '{}')
                FROM api.contract k LEFT JOIN api.application a ON a.id = k.application_id;"""))
        except RuntimeError:
            return {}
        for v in out.values():
            v["amount"], v["date"] = norm_num(v["amount"]), norm_date(v["date"])
        return out

    def state(self) -> dict:
        companies = self._companies()
        by_id = {}
        if self.COMPANY_COL == "company_id":
            by_id = dict(line.split("|", 1) for line in self.psql("SELECT id, name FROM api.company;").splitlines())
        else:
            by_id = {c["inn"]: name for name, c in companies.items()}
        apps = {n: {"company": by_id.get(a["company"]), "status": a["status"], "amount": norm_num(a["amount"])}
                for n, a in self._apps().items()}
        return {"apps": apps, "companies": companies, "contracts": self._contracts()}

    # предусловия в обход защиты
    def force_contracts(self, contracts):
        if not self.psql("SELECT to_regclass('api.contract');").strip():
            raise KeyError("нет таблицы api.contract")
        self.psql("SET session_replication_role = replica;\n" + "".join(
            f"INSERT INTO api.contract (number, application_id, amount, signed_on, status) "
            f"SELECT {q(num)}, id, {amount}, {q(date)}, {q(status)} FROM api.application WHERE number = {q(app)};\n"
            for num, app, amount, status, date in contracts))

    def force_company(self, key: str, field: str, value):
        col = "name" if field == "name" else "funding_limit"
        self.psql(f"UPDATE api.company SET {col} = {q(value)} WHERE inn = {q(S.COMPANY_INN[key])};")

    # API
    def _app_id(self, number: str):
        out = self.psql(f"SELECT id FROM api.application WHERE number = {q(number)};").strip()
        return int(out) if out else None

    def _contract_body(self, fields: dict, number=None) -> dict:
        body = {} if number is None else {"number": number}
        for k, v in fields.items():
            if k == "app":
                body["application_id"] = self._app_id(v)
            elif k == "date":
                body["signed_on"] = norm_date(v)
            else:
                body[k] = v
        return body

    def contract_act(self, login: str, op: str, number: str = None, fields: dict = None, via: str = "human"):
        num = urllib.parse.quote(f"eq.{number}") if number else ""
        if op == "list":
            return self._call(login, via, "GET", "contract?select=number,application_id,amount,status")
        if op == "create":
            return self._call(login, via, "POST", "contract", self._contract_body(fields or {}, number))
        if op == "update":
            return self._call(login, via, "PATCH", f"contract?number={num}", self._contract_body(fields or {}))
        if op == "delete":
            return self._call(login, via, "DELETE", f"contract?number={num}")
        raise ValueError(op)

    def report(self, login: str = "admin_f"):
        st, body = self._call(login, "human", "GET",
                              "limit_balance?select=" + ",".join(PG_REPORT_COLS.values()))
        try:
            return st, norm_report(json.loads(body), PG_REPORT_COLS) if st == 200 else None
        except ValueError:
            return st, None

    def apply_sql(self, sql: str):
        self.psql(sql)


# --- A″: две системы --------------------------------------------------------------------------

REG_STAND = Path(os.getenv("R1060_REG_STAND", "/root/crm1055c"))
REG_URL = os.getenv("R1060_REG_URL", "http://127.0.0.1:18691")
REG_CONTAINER = os.getenv("R1060_REG_CONTAINER", "crm1055c-db")


class RegistryEnv(IntegPgEnv):
    """S2 «Реестр контрагентов»: своя PostgreSQL + PostgREST (integ/a2/stand.sh), база registry."""
    WORK = "registry"

    def __init__(self, db: str = WORK):
        super().__init__(db, stand=REG_STAND, base_url=REG_URL, container=REG_CONTAINER)

    def deploy(self, config: str = "start"):
        self._recreate()
        self.psql((HERE / "a2" / "s2_schema.sql").read_text("utf-8") + registry_sql())

    def token(self, login: str = "registry_admin") -> str:
        return E.jwt(self.secret, {"role": "registry_admin", "exp": int(time.time()) + 3600})

    def ready(self, timeout: float = 30):
        self.psql("NOTIFY pgrst, 'reload schema';")
        t0 = time.time()
        while time.time() - t0 < timeout:
            if probe_http(f"{self.base_url}/counterparty?limit=1", self.token()) == 200:
                return
            time.sleep(0.3)
        raise RuntimeError("PostgREST реестра не поднялся после пересоздания базы")

    def companies(self) -> dict:
        out = json.loads(self.psql("SELECT coalesce(json_object_agg(legal_name, json_build_object('inn', inn, "
                                   "'limit', funding_limit::text)), '{}') FROM api.counterparty;"))
        return {k: {"inn": v["inn"], "limit": norm_num(v["limit"])} for k, v in out.items()}

    def force_company(self, key: str, field: str, value):
        col = "legal_name" if field == "name" else "funding_limit"
        self.psql(f"UPDATE api.counterparty SET {col} = {q(value)} WHERE inn = {q(S.COMPANY_INN[key])};")

    def call(self, method: str, path: str, body=None):
        headers = {"Authorization": f"Bearer {self.token()}", "Content-Type": "application/json",
                   "Prefer": "return=minimal"}
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        return E.http(urllib.request.Request(f"{self.base_url}/{path}", data=data, method=method, headers=headers))


class S1Env(IntegPgEnv):
    """S1 «Заявки» среды A″: база app стенда crm1055a без таблицы компаний, ссылка на компанию — ИНН."""
    name = "A2"
    KIND = "a2"
    SCHEMA = HERE / "a2" / "s1_schema.sql"
    REFERENCE = HERE / "a2" / "s1_reference.sql"
    T1_REFERENCE = HERE / "a2" / "t1_reference.sql"
    COMPANY_COL = "company_inn"

    def __init__(self, db: str = E.PgrstEnv.WORK, registry: RegistryEnv = None):
        super().__init__(db)
        self.registry = registry or RegistryEnv()

    def start_sql(self) -> str:
        pw = self.registry.env_file["READER_PASSWORD"]
        return (self.SCHEMA.read_text("utf-8") + seed_sql(self.KIND)
                + self.REFERENCE.read_text("utf-8").replace("{READER_PASSWORD}", pw))

    def _companies(self) -> dict:
        return self.registry.companies()

    def act(self, login, via, op, number=None, fields=None, select=None):
        return super().act(login, via, op, number, fields,
                           select or "number,company_inn,status_id,amount,revenue,description,verdict")

    def _body(self, fields: dict) -> dict:
        body = {}
        for k, v in fields.items():
            if k == "company":
                c = self.registry.companies().get(S.COMPANY_NAME[v])
                body["company_inn"] = c["inn"] if c else S.COMPANY_INN.get(v)
            elif k == "status":
                body["status_id"] = self._ref(k, v)
            else:
                body[k] = v
        return body


class TwoSysEnv:
    """A″: S1 «Заявки» (crm1055a, база app) + S2 «Реестр контрагентов» (crm1055c, база registry).
    Снимок называется одинаково в обоих кластерах."""
    name = "A2"

    def __init__(self, db: str = None):
        self.s2 = RegistryEnv(RegistryEnv.WORK)
        self.s1 = S1Env(db or E.PgrstEnv.WORK, self.s2)
        self.db = self.s1.db

    def deploy(self, config: str = "start"):
        self.s1.cluster_roles()
        self.s2.deploy()
        self.s2.ready()
        self.s1.deploy()

    def save(self, name: str):
        self.s2.save(name)
        self.s1.save(name)

    def clone(self, src: str):
        self.s2.clone(src)
        self.s1.clone(src)

    def drop_snapshot(self, name: str):
        self.s1.drop_snapshot(name)
        self.s2.drop_snapshot(name)

    def ready(self):
        self.s2.ready()
        self.s1.ready()

    def drop(self):
        pass

    def rows(self):
        return None

    def state(self):
        return self.s1.state()

    def force_company(self, key, field, value):
        self.s2.force_company(key, field, value)

    def __getattr__(self, item):  # act, contract_act, report, force_contracts, login, psql, token … — S1
        return getattr(self.s1, item)


def env(kind: str, db: str = None):
    if kind == "b":
        return IntegCoreEnv(db or "i60bw")
    if kind == "a1":
        return IntegPgEnv(db or E.PgrstEnv.WORK)
    if kind == "a2":
        return TwoSysEnv(db)
    raise ValueError(kind)
