"""REST-сервис варианта A («таблицы + REST + инструкция») для пилота python2node#1008.

Python 3.12, только stdlib. Один процесс — одна база прогона (ra_<run_id> в crm1008-db).
Токен в заголовке `Authorization: Bearer <token>` (или `X-Authorization: <token>`).

Защиты те же, что у ядра ideav.ru с фиксом масок на запись, не больше:
  Админ фонда — всё, включая удаление и add_column.
  Эксперт     — читает всё; пишет только «статус» и «заключение»; не создаёт и не удаляет.
  Заявитель   — видит и правит только заявки СВОЕЙ компании в статусах ниже «На экспертизе»;
                поле «эксперт» скрыто, «заключение» только чтение; создаёт и удаляет только свои.
                Компании и статусы читает (как грант READ ядра), пользователей — нет.
Отказ — 403 с текстом. Правил процесса (граф переходов, сумма <= лимита, обязательное заключение)
сервис не проверяет: они живут только в инструкции агента.

Каждый запрос пишется в журнал (--log): ts, login, method, path, body, status (+ error при отказе).
Токены в журнал не попадают.
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db as D  # noqa: E402

REVIEW = "На экспертизе"
LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status, self.msg = status, msg


def norm(v):
    if isinstance(v, float) and v == v and abs(v) < 1e15 and v == int(v):
        return int(v)
    return v


def kind_of(role: str) -> str:
    if role == "Админ фонда":
        return "admin"
    if role == "Эксперт":
        return "expert"
    if role.startswith("Заявитель"):
        return "applicant"
    return "none"


# --- описание таблиц ---------------------------------------------------------------------------
# (имя в API, тип, SQL-выражение в SELECT)
COMPANIES = [("id", "id", "t.id"), ("code", "text", "t.code"), ("name", "text", "t.name"),
             ("inn", "text", "t.inn"), ("limit_amount", "number", "t.limit_amount")]
STATUSES = [("id", "id", "t.id"), ("name", "text", "t.name"), ("ord", "number", "t.ord")]
USERS = [("id", "id", "t.id"), ("login", "text", "t.login"), ("fio", "text", "t.fio"),
         ("role", "text", "r.name"), ("company", "text", "c.code")]
SIMPLE = {
    "companies": dict(fields=COMPANIES, joins="FROM companies t", writable=["code", "name", "inn", "limit_amount"]),
    "statuses": dict(fields=STATUSES, joins="FROM statuses t", writable=["name", "ord"]),
    "users": dict(fields=USERS, joins="FROM users t JOIN roles r ON r.id=t.role_id "
                  "LEFT JOIN companies c ON c.id=t.company_id", writable=[]),
}
APP_JOINS = ("FROM applications a LEFT JOIN companies c ON c.id=a.company_id "
             "LEFT JOIN statuses s ON s.id=a.status_id LEFT JOIN users u ON u.id=a.expert_user_id")
APP_BASE = [  # имя, тип, SQL
    ("id", "id", "a.id"), ("number", "text", "a.number"), ("company_id", "id", "a.company_id"),
    ("company", "text", "c.name"), ("status_id", "id", "a.status_id"), ("status", "text", "s.name"),
    ("amount", "number", "a.amount"), ("revenue", "number", "a.revenue"), ("description", "text", "a.description"),
    ("expert_user_id", "id", "a.expert_user_id"), ("expert", "text", "u.login"), ("verdict", "text", "a.verdict"),
]
APP_ALIAS = {"company": "company_id", "status": "status_id", "expert": "expert_user_id"}
APP_CANON = ["number", "company_id", "status_id", "amount", "revenue", "description", "expert_user_id", "verdict"]
APP_TYPES = {"number": "text", "company_id": "id", "status_id": "id", "amount": "number", "revenue": "number",
             "description": "text", "expert_user_id": "id", "verdict": "text"}
APP_DBCOL = {k: k for k in APP_CANON}
EXPERT_FIELDS = {"expert_user_id", "expert"}
RESERVED = {c for c in APP_CANON} | set(APP_ALIAS) | {"id"}


class Service:
    def __init__(self, dbname: str, log_path: str):
        self.db, self.log_path = dbname, log_path
        self.extras = [(r["name"], r["type"]) for r in D.rows(
            "SELECT JSON_OBJECT('name',name,'type',type) FROM app_columns ORDER BY ord", dbname)]
        self.log_lock = threading.Lock()

    # -- журнал
    def log(self, rec: dict):
        with self.log_lock, open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # -- общие помощники
    def rows(self, sql):
        return D.rows(sql, self.db)

    def run(self, sql):
        try:
            return D.run(sql, self.db)
        except D.DbError as e:
            raise self.map_db(e)

    @staticmethod
    def map_db(e: D.DbError) -> ApiError:
        if e.code == 1062:
            return ApiError(409, "нарушена уникальность: " + e.msg)
        if e.code in (1451, 1452):
            return ApiError(409, "нарушена связь между таблицами: " + e.msg)
        if e.code in (1264, 1265, 1292, 1366, 1406, 1048):
            return ApiError(400, "недопустимое значение: " + e.msg)
        return ApiError(500, "ошибка БД: " + e.msg)

    def authenticate(self, token: str):
        if not token:
            raise ApiError(401, "нужен токен: заголовок Authorization: Bearer <token>")
        res = self.rows(
            "SELECT JSON_OBJECT('id',u.id,'login',u.login,'role',r.name,'company_id',u.company_id) "
            "FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id "
            f"WHERE s.token={D.q(token)};"
            f"SELECT JSON_OBJECT('ord',ord) FROM statuses WHERE name={D.q(REVIEW)};")
        if not res or "login" not in res[0]:
            raise ApiError(401, "токен не опознан")
        user = res[0]
        user["kind"] = kind_of(user["role"])
        user["review_ord"] = res[1]["ord"] if len(res) > 1 else 10**9
        return user

    # -- схема
    def describe(self, user):
        k = user["kind"]
        app_cols = []

        def col(name, typ, ref=None, note="", unique=False, required=False):
            canon = APP_ALIAS.get(name, name)
            hidden = k == "applicant" and canon in EXPERT_FIELDS
            if hidden:
                return
            if canon == "id" or name in APP_ALIAS or (name in ("company", "status", "expert")):
                writable = False
            elif k == "admin":
                writable = True
            elif k == "expert":
                writable = canon in ("status_id", "verdict")
            else:
                writable = canon not in ("verdict", "expert_user_id")
            app_cols.append({"name": name, "type": typ, "references": ref, "readable": True, "writable": writable,
                             "unique": unique, "required": required, "note": note})

        col("id", "integer", note="внутренний id записи, задаёт сервер")
        col("number", "text", unique=True, required=True, note="номер заявки, например З-001; уникален")
        col("company_id", "integer", ref="companies.id", required=True, note="компания заявки")
        col("company", "text", note="название компании (только чтение); при записи можно передать company = код или название")
        col("status_id", "integer", ref="statuses.id", required=True, note="статус заявки")
        col("status", "text", note="название статуса (только чтение); при записи можно передать status = название")
        col("amount", "number", note="запрашиваемая сумма")
        col("revenue", "number", note="выручка")
        col("description", "text", note="описание проекта")
        col("expert_user_id", "integer", ref="users.id", note="назначенный эксперт")
        col("expert", "text", note="логин эксперта (только чтение); при записи можно передать expert = логин")
        col("verdict", "text", note="заключение эксперта")
        for n, t in self.extras:
            col(n, t, note="добавленная колонка")
        tables = [{"name": "applications", "columns": app_cols,
                   "operations": {"list": True, "get": True, "create": k in ("admin", "applicant"),
                                  "update": True, "delete": k in ("admin", "applicant"), "add_column": k == "admin"}}]
        for tname, spec in (("companies", SIMPLE["companies"]), ("statuses", SIMPLE["statuses"]),
                            ("users", SIMPLE["users"])):
            if tname == "users" and k == "applicant":
                continue
            w = k == "admin" and bool(spec["writable"])
            tables.append({"name": tname, "columns": [
                {"name": n, "type": t, "readable": True, "writable": w and n in spec["writable"]}
                for n, t, _ in spec["fields"]],
                "operations": {"list": True, "get": True, "create": w, "update": w, "delete": w}})
        return {"user": {"login": user["login"], "role": user["role"]}, "tables": tables,
                "notes": ["Записи таблицы applications адресуются числовым id или номером заявки.",
                          "Фильтры list_records: {поле: значение} (равенство) или {поле: {op, value}}, "
                          "op из eq, ne, gt, gte, lt, lte, like; value-список = IN.",
                          "Сервис проверяет доступ, типы и уникальность номера; бизнес-правила процесса не проверяет."]}

    # -- чтение
    def select_expr(self, fields, hide=()):
        return "JSON_OBJECT(" + ",".join(f"{D.q(n)},{e}" for n, _, e in fields if n not in hide) + ")"

    def app_fields(self, user):
        f = list(APP_BASE) + [(n, t, "a." + D.ident(n)) for n, t in self.extras]
        return f

    def hidden(self, user):
        return EXPERT_FIELDS if user["kind"] == "applicant" else ()

    def app_restrict(self, user):
        if user["kind"] == "applicant":
            return f"a.company_id={int(user['company_id'] or 0)} AND s.ord<{int(user['review_ord'])}"
        return "1=1"

    def clean(self, rec):
        return {k: norm(v) for k, v in rec.items()}

    def resolve_ref(self, table, key_cols, value):
        """Значение ссылки: id (int) или имя/код."""
        if isinstance(value, int) and not isinstance(value, bool):
            r = self.rows(f"SELECT JSON_OBJECT('id',id) FROM {table} WHERE id={value};")
        else:
            cond = " OR ".join(f"{c}={D.q(str(value))}" for c in key_cols)
            r = self.rows(f"SELECT JSON_OBJECT('id',id) FROM {table} WHERE {cond};")
        if not r:
            raise ApiError(400, f"{table}: не найдено значение {value!r}")
        return r[0]["id"]

    def build_where(self, table, filters, user):
        if not isinstance(filters, dict):
            raise ApiError(400, "filters должен быть объектом {поле: значение}")
        conds = []
        if table == "applications":
            fmap = {n: (t, e) for n, t, e in self.app_fields(user)}
            hide = self.hidden(user)
        else:
            fmap = {n: (t, e) for n, t, e in SIMPLE[table]["fields"]}
            hide = ()
        for name, spec in filters.items():
            if name in hide:
                raise ApiError(403, f"поле «{name}» вам недоступно")
            if name not in fmap:
                raise ApiError(400, f"неизвестное поле фильтра «{name}»; доступны: {', '.join(n for n in fmap if n not in hide)}")
            typ, expr = fmap[name]
            if isinstance(spec, dict):
                op, val = spec.get("op", "eq"), spec.get("value")
            else:
                op, val = "eq", spec
            ops = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}
            if name == "company" and table == "applications" and op in ("eq", "ne") and isinstance(val, str):
                conds.append(f"({'NOT ' if op == 'ne' else ''}(c.code={D.q(val)} OR c.name={D.q(val)}))")
                continue
            if isinstance(val, list):
                if op not in ("eq", "ne"):
                    raise ApiError(400, "список значений допустим только для eq/ne")
                vals = ",".join(D.q(self.filter_value(typ, x, name)) for x in val) or "NULL"
                conds.append(f"{expr} {'NOT ' if op == 'ne' else ''}IN ({vals})")
            elif op == "like":
                conds.append(f"{expr} LIKE {D.q('%' + str(val) + '%')}")
            elif op in ops:
                if val is None:
                    if op not in ("eq", "ne"):
                        raise ApiError(400, "сравнение с null только eq/ne")
                    conds.append(f"{expr} IS {'NOT ' if op == 'ne' else ''}NULL")
                else:
                    conds.append(f"{expr} {ops[op]} {D.q(self.filter_value(typ, val, name))}")
            else:
                raise ApiError(400, f"неизвестный оператор {op!r}")
        return conds

    @staticmethod
    def filter_value(typ, v, name):
        if typ in ("number", "id") and not isinstance(v, (int, float)):
            try:
                return float(v)
            except (TypeError, ValueError):
                raise ApiError(400, f"поле «{name}» числовое, получено {v!r}")
        return v

    def list_(self, table, params, user):
        if table == "users" and user["kind"] == "applicant":
            raise ApiError(403, "заявителю таблица users недоступна")
        try:
            filters = json.loads(params["filters"][0] or "{}") if params.get("filters") else {}
            limit = max(1, min(int(params.get("limit", ["100"])[0]), 500))
            offset = max(0, int(params.get("offset", ["0"])[0]))
        except ValueError:
            raise ApiError(400, "filters — JSON-объект, limit и offset — целые числа")
        conds = self.build_where(table, filters, user)
        if table == "applications":
            fields, joins, alias = self.app_fields(user), APP_JOINS, "a"
            conds.append(self.app_restrict(user))
        else:
            spec = SIMPLE[table]
            fields, joins, alias = spec["fields"], spec["joins"], "t"
        where = " AND ".join(conds) or "1=1"
        sql = (f"SELECT JSON_OBJECT('total',COUNT(*)) {joins} WHERE {where};"
               f"SELECT {self.select_expr(fields, self.hidden(user))} {joins} WHERE {where} "
               f"ORDER BY {alias}.id LIMIT {limit} OFFSET {offset};")
        res = self.rows(sql)
        return {"total": res[0]["total"], "count": len(res) - 1, "records": [self.clean(r) for r in res[1:]]}

    def find_app_id(self, ref: str) -> int:
        if str(ref).isdigit():
            r = self.rows(f"SELECT JSON_OBJECT('id',id) FROM applications WHERE id={int(ref)};")
        else:
            r = self.rows(f"SELECT JSON_OBJECT('id',id) FROM applications WHERE number={D.q(ref)};")
            if not r:
                raise ApiError(404, f"заявка {ref!r} не найдена")
        if not r:
            raise ApiError(404, f"заявка id={ref} не найдена")
        return r[0]["id"]

    def app_state(self, aid):
        r = self.rows("SELECT JSON_OBJECT('id',a.id,'company_id',a.company_id,'status_id',a.status_id,'ord',s.ord,"
                      f"'number',a.number) {APP_JOINS} WHERE a.id={aid};")
        return r[0]

    def can_touch(self, user, state) -> bool:
        if user["kind"] != "applicant":
            return True
        return state["company_id"] == user["company_id"] and state["ord"] < user["review_ord"]

    def get_app(self, aid, user):
        r = self.rows(f"SELECT {self.select_expr(self.app_fields(user), self.hidden(user))} {APP_JOINS} WHERE a.id={aid};")
        return self.clean(r[0])

    def get(self, table, ref, user):
        if table == "applications":
            aid = self.find_app_id(ref)
            if not self.can_touch(user, self.app_state(aid)):
                raise ApiError(403, "нет доступа к этой заявке: заявитель видит только заявки своей компании "
                                    f"в статусах ниже «{REVIEW}»")
            return self.get_app(aid, user)
        if table == "users" and user["kind"] == "applicant":
            raise ApiError(403, "заявителю таблица users недоступна")
        spec = SIMPLE[table]
        if not str(ref).isdigit():
            raise ApiError(400, "id должен быть числом")
        r = self.rows(f"SELECT {self.select_expr(spec['fields'])} {spec['joins']} WHERE t.id={int(ref)};")
        if not r:
            raise ApiError(404, f"{table}: запись id={ref} не найдена")
        return self.clean(r[0])

    # -- запись
    def normalize_app_values(self, body: dict, user, creating: bool) -> dict:
        """Имена -> канонические колонки, значения -> типизированные; проверка прав на поля."""
        if not isinstance(body, dict):
            raise ApiError(400, "тело запроса должно быть JSON-объектом {поле: значение}")
        extra_types = dict(self.extras)
        vals, seen = {}, {}
        for name, v in body.items():
            if name == "id":
                raise ApiError(400, "поле id задаёт сервер")
            canon = APP_ALIAS.get(name, name)
            if canon not in APP_TYPES and name not in extra_types:
                raise ApiError(400, f"неизвестное поле «{name}»")
            if canon in seen and canon in APP_TYPES:
                raise ApiError(400, f"поля «{seen[canon]}» и «{name}» задают одно и то же")
            seen[canon] = name
            k = user["kind"]
            if k == "applicant" and canon in EXPERT_FIELDS:
                raise ApiError(403, f"поле «{name}» заявителю недоступно")
            if k == "applicant" and canon == "verdict":
                raise ApiError(403, "поле «verdict» (заключение эксперта) заявителю доступно только на чтение")
            if k == "expert" and canon not in ("status_id", "verdict"):
                raise ApiError(403, f"эксперт может менять только статус и заключение, поле «{name}» запрещено")
            if canon in APP_TYPES:
                vals[canon] = self.coerce_app(canon, name, v)
            else:
                vals[name] = self.coerce(extra_types[name], name, v)
        return vals

    def coerce(self, typ, name, v):
        if v is None:
            return None
        if typ == "number":
            if isinstance(v, bool) or not isinstance(v, (int, float, str)):
                raise ApiError(400, f"поле «{name}» числовое, получено {v!r}")
            try:
                f = float(str(v).replace(" ", "").replace(",", ".")) if isinstance(v, str) else float(v)
            except ValueError:
                raise ApiError(400, f"поле «{name}» числовое, получено {v!r}")
            if f != f or f in (float("inf"), float("-inf")):
                raise ApiError(400, f"поле «{name}»: недопустимое число")
            return int(f) if f == int(f) and abs(f) < 1e15 else f
        if isinstance(v, (dict, list)):
            raise ApiError(400, f"поле «{name}» текстовое, получен {type(v).__name__}")
        return str(v)

    def coerce_app(self, canon, name, v):
        t = APP_TYPES[canon]
        if canon == "company_id":
            if v is None:
                raise ApiError(400, "company обязательна")
            return self.resolve_ref("companies", ("code", "name"), v) if name == "company" or isinstance(v, str) \
                else self.resolve_ref("companies", (), v)
        if canon == "status_id":
            if v is None:
                raise ApiError(400, "status обязателен")
            return self.resolve_ref("statuses", ("name",), v)
        if canon == "expert_user_id":
            if v is None:
                return None
            return self.resolve_ref("users", ("login",), v)
        if canon == "number":
            if v is None or str(v).strip() == "":
                raise ApiError(400, "number (номер заявки) не может быть пустым")
            return str(v)
        return self.coerce(t, name, v)

    def status_ord(self, sid):
        return self.rows(f"SELECT JSON_OBJECT('ord',ord) FROM statuses WHERE id={int(sid)};")[0]["ord"]

    def check_applicant_target(self, user, company_id, status_id):
        if company_id != user["company_id"]:
            raise ApiError(403, "заявитель может работать только с заявками своей компании")
        if self.status_ord(status_id) >= user["review_ord"]:
            raise ApiError(403, f"заявитель может работать только со статусами ниже «{REVIEW}»")

    def create(self, table, body, user):
        k = user["kind"]
        if table != "applications":
            return self.create_simple(table, body, user)
        if k not in ("admin", "applicant"):
            raise ApiError(403, "создавать заявки могут только администратор фонда и заявитель")
        vals = self.normalize_app_values(body, user, True)
        if "number" not in vals:
            raise ApiError(400, "number (номер заявки) обязателен")
        if "company_id" not in vals:
            if k == "applicant":
                vals["company_id"] = user["company_id"]
            else:
                raise ApiError(400, "company обязательна")
        if "status_id" not in vals:
            vals["status_id"] = self.rows("SELECT JSON_OBJECT('id',id) FROM statuses ORDER BY ord LIMIT 1;")[0]["id"]
        if k == "applicant":
            self.check_applicant_target(user, vals["company_id"], vals["status_id"])
        cols = ",".join(D.ident(c) for c in vals)
        res = self.run(f"INSERT INTO applications ({cols}) VALUES ({','.join(D.q(v) for v in vals.values())});"
                       "SELECT JSON_OBJECT('id',LAST_INSERT_ID());")
        return self.get_app(json.loads(res[-1])["id"], user)

    def update(self, table, ref, body, user):
        k = user["kind"]
        if table != "applications":
            return self.update_simple(table, ref, body, user)
        aid = self.find_app_id(ref)
        st = self.app_state(aid)
        if not self.can_touch(user, st):
            raise ApiError(403, "нет доступа к этой заявке: заявитель правит только заявки своей компании "
                                f"в статусах ниже «{REVIEW}»")
        vals = self.normalize_app_values(body, user, False)
        if not vals:
            raise ApiError(400, "нет полей для изменения")
        if k == "applicant":
            self.check_applicant_target(user, vals.get("company_id", st["company_id"]),
                                        vals.get("status_id", st["status_id"]))
        sets = ",".join(f"{D.ident(c)}={D.q(v)}" for c, v in vals.items())
        self.run(f"UPDATE applications SET {sets} WHERE id={aid};")
        return self.get_app(aid, user)

    def delete(self, table, ref, user):
        if table != "applications":
            return self.delete_simple(table, ref, user)
        if user["kind"] == "expert":
            raise ApiError(403, "эксперт не может удалять заявки")
        aid = self.find_app_id(ref)
        if not self.can_touch(user, self.app_state(aid)):
            raise ApiError(403, "нет доступа к этой заявке: заявитель удаляет только заявки своей компании "
                                f"в статусах ниже «{REVIEW}»")
        self.run(f"DELETE FROM applications WHERE id={aid};")
        return {"deleted": aid}

    def simple_vals(self, table, body, user):
        if user["kind"] != "admin":
            raise ApiError(403, f"менять таблицу {table} может только администратор фонда")
        if not isinstance(body, dict):
            raise ApiError(400, "тело запроса должно быть JSON-объектом")
        spec = SIMPLE[table]
        if not spec["writable"]:
            raise ApiError(403, f"таблица {table} доступна только для чтения")
        types = {n: t for n, t, _ in spec["fields"]}
        vals = {}
        for n, v in body.items():
            if n not in spec["writable"]:
                raise ApiError(400, f"поле «{n}» таблицы {table} не записываемое; можно: {', '.join(spec['writable'])}")
            vals[n] = self.coerce(types[n], n, v)
        return vals

    def create_simple(self, table, body, user):
        vals = self.simple_vals(table, body, user)
        res = self.run(f"INSERT INTO {table} ({','.join(map(D.ident, vals))}) VALUES "
                       f"({','.join(D.q(v) for v in vals.values())});SELECT JSON_OBJECT('id',LAST_INSERT_ID());")
        return self.get(table, json.loads(res[-1])["id"], user)

    def update_simple(self, table, ref, body, user):
        vals = self.simple_vals(table, body, user)
        self.get(table, ref, user)
        if not vals:
            raise ApiError(400, "нет полей для изменения")
        self.run(f"UPDATE {table} SET {','.join(f'{D.ident(c)}={D.q(v)}' for c, v in vals.items())} WHERE id={int(ref)};")
        return self.get(table, ref, user)

    def delete_simple(self, table, ref, user):
        self.simple_vals(table, {}, user)
        self.get(table, ref, user)
        self.run(f"DELETE FROM {table} WHERE id={int(ref)};")
        return {"deleted": int(ref)}

    def add_column(self, table, body, user):
        if user["kind"] != "admin":
            raise ApiError(403, "менять схему может только администратор фонда")
        if table != "applications":
            raise ApiError(400, "колонки можно добавлять только в applications")
        if not isinstance(body, dict):
            raise ApiError(400, "тело: {\"name\": ..., \"type\": \"number\"|\"text\"}")
        name, typ = body.get("name"), body.get("type", "text")
        if not isinstance(name, str) or not re.fullmatch(r"[^\W\d][\w .,()/\-]{0,62}", name.strip()):
            raise ApiError(400, "имя колонки: буквы, цифры, пробел, _ . , ( ) / -; начинается с буквы; до 63 символов")
        name = name.strip()
        if typ not in ("number", "text"):
            raise ApiError(400, "type: number или text")
        low = name.lower()
        if low in RESERVED or any(low == n.lower() for n, _ in self.extras):
            raise ApiError(409, f"колонка «{name}» уже существует")
        sqltype = "DOUBLE NULL" if typ == "number" else "TEXT NULL"
        self.run(f"ALTER TABLE applications ADD COLUMN {D.ident(name)} {sqltype};"
                 f"INSERT INTO app_columns (name,type,ord) VALUES ({D.q(name)},{D.q(typ)},{len(self.extras) + 1});")
        self.extras.append((name, typ))
        return {"table": "applications", "added": {"name": name, "type": typ}}


class Handler(BaseHTTPRequestHandler):
    server_version = "fund-rest/1"
    svc: Service = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def reply(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self):
        t0 = time.time()
        raw = b""
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            raw = self.rfile.read(n)
        body_log, login, status, err = None, None, 500, None
        parsed = urllib.parse.urlsplit(self.path)
        try:
            if raw:
                try:
                    body_log = json.loads(raw.decode("utf-8"))
                except Exception:
                    body_log = raw.decode("utf-8", "replace")
            with LOCK:
                status, result = self.route(parsed, raw, body_log)
            login = getattr(self, "_login", None)
        except ApiError as e:
            status, result, err = e.status, {"error": e.msg}, e.msg
            login = getattr(self, "_login", None)
        except Exception as e:  # noqa: BLE001
            status, result, err = 500, {"error": f"внутренняя ошибка: {e}"}, str(e)
            login = getattr(self, "_login", None)
        try:
            self.reply(status, result)
        finally:
            rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t0)) + f".{int(t0 * 1000) % 1000:03d}Z",
                   "login": login, "method": self.command, "path": self.path, "body": body_log, "status": status}
            if status >= 400:
                rec["error"] = err
            self.svc.log(rec)

    def route(self, parsed, raw, body):
        parts = [urllib.parse.unquote(p) for p in parsed.path.split("/") if p]
        if parts == ["health"]:
            return 200, {"ok": True}
        token = ""
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        token = token or self.headers.get("X-Authorization", "").strip()
        self._login = None
        user = self.svc.authenticate(token)
        self._login = user["login"]
        if not parts or parts[0] != "api":
            raise ApiError(404, "путь не найден; API начинается с /api/")
        parts = parts[1:]
        m = self.command
        params = urllib.parse.parse_qs(parsed.query)
        if parts == ["schema"] and m == "GET":
            return 200, self.svc.describe(user)
        if not parts or parts[0] not in ("applications", "companies", "statuses", "users"):
            raise ApiError(404, "таблицы: applications, companies, statuses, users")
        table = parts[0]
        if len(parts) == 1 and m == "GET":
            return 200, self.svc.list_(table, params, user)
        if len(parts) == 1 and m == "POST":
            return 201, self.svc.create(table, body, user)
        if len(parts) == 2 and parts[1] == "columns" and m == "POST":
            return 201, self.svc.add_column(table, body, user)
        if len(parts) == 2:
            if m == "GET":
                return 200, self.svc.get(table, parts[1], user)
            if m in ("PATCH", "PUT"):
                return 200, self.svc.update(table, parts[1], body, user)
            if m == "DELETE":
                return 200, self.svc.delete(table, parts[1], user)
        raise ApiError(405, "метод не поддерживается")

    do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = handle_any


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--port", type=int, default=0)
    ap.add_argument("--log", required=True)
    ap.add_argument("--ready", required=True, help="файл, куда записать {port}")
    a = ap.parse_args()
    Handler.svc = Service(a.db, a.log)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    srv.daemon_threads = True
    tmp = a.ready + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"port": srv.server_address[1], "pid": os.getpid()}, f)
    os.replace(tmp, a.ready)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
