"""S2 «Реестр контрагентов» среды A″ (a3) замера python2node#1060: HTTP-сервис в стиле OData 1С.

Инфраструктура стенда, не код агента. Только стандартная библиотека Python 3.
Справочник один — Catalog_Контрагенты. Хранилище — JSON-файл $R1060R_DATA/registry.json; файл читается
на каждый запрос и пишется атомарно (os.replace), поэтому раннер снимает и восстанавливает состояние
копированием файла, не останавливая сервис. Справочник API для агента — integ/a3/REGISTRY_API.md.

  R1060R_DATA=/root/crm1060r/data R1060R_PORT=18692 R1060R_USER=odata_admin R1060R_PASSWORD=… \
      python3 registry_odata.py
"""
import base64
import json
import os
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote_to_bytes

DATA = Path(os.getenv("R1060R_DATA", "/root/crm1060r/data"))
LIVE = DATA / "registry.json"
PORT = int(os.getenv("R1060R_PORT", "18692"))
USER = os.getenv("R1060R_USER", "odata_admin")
PASSWORD = os.environ.get("R1060R_PASSWORD", "")
ROOT = "/odata/standard.odata"
SET = "Catalog_Контрагенты"
FIELDS = {"Ref_Key": "Edm.Guid", "DataVersion": "Edm.String", "DeletionMark": "Edm.Boolean", "Code": "Edm.String",
          "Description": "Edm.String", "ИНН": "Edm.String", "ЛимитФинансирования": "Edm.Double"}
READ_ONLY = {"Ref_Key", "DataVersion", "Code"}
GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
LOCK = threading.Lock()


class ODataError(Exception):
    def __init__(self, status: int, message: str, code: str = "-1"):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


# --- хранилище ---------------------------------------------------------------------------------

def load() -> dict:
    try:
        return json.loads(LIVE.read_text("utf-8"))
    except FileNotFoundError:
        return {"seq": 0, SET: []}


def save(db: dict):
    tmp = LIVE.with_name(f".{LIVE.name}.{os.getpid()}.{threading.get_ident()}")
    tmp.write_text(json.dumps(db, ensure_ascii=False, indent=1), "utf-8")
    os.replace(tmp, LIVE)


def data_version(n: int) -> str:
    return base64.b64encode(n.to_bytes(8, "big")).decode()


def num(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


# --- $filter: подмножество OData v3, как у 1С ----------------------------------------------------

TOKEN = re.compile(r"\s*(?:(guid'[^']*')|('(?:[^']|'')*')|(-?\d+(?:\.\d+)?)|([()，,])|([A-Za-z_А-Яа-яЁё][\wА-Яа-яЁё]*))")


def tokenize(s: str) -> list:
    out, pos = [], 0
    s = s.strip()
    while pos < len(s):
        m = TOKEN.match(s, pos)
        if not m or m.end() == pos:
            raise ODataError(400, f"Ошибка разбора $filter в позиции {pos}: «{s[pos:pos + 20]}»")
        g, st, n, p, w = m.groups()
        if g:
            out.append(("guid", g[5:-1].lower()))
        elif st:
            out.append(("str", st[1:-1].replace("''", "'")))
        elif n:
            out.append(("num", float(n)))
        elif p:
            out.append(("p", "," if p in ",，" else p))
        else:
            out.append(("w", w))
        pos = m.end()
    return out


class Filter:
    OPS = {"eq", "ne", "gt", "ge", "lt", "le"}

    def __init__(self, text: str):
        self.t = tokenize(text)
        self.i = 0
        self.fn = self.expr()
        if self.i != len(self.t):
            raise ODataError(400, f"Ошибка разбора $filter: лишнее «{self.t[self.i][1]}»")

    def peek(self, kind=None, val=None):
        if self.i >= len(self.t):
            return None
        k, v = self.t[self.i]
        if (kind and k != kind) or (val is not None and (v.lower() if isinstance(v, str) else v) != val):
            return None
        return self.t[self.i]

    def take(self, kind=None, val=None):
        tok = self.peek(kind, val)
        if tok is None:
            got = self.t[self.i][1] if self.i < len(self.t) else "конец строки"
            raise ODataError(400, f"Ошибка разбора $filter: ожидалось {val or kind}, получено «{got}»")
        self.i += 1
        return tok

    def expr(self):
        left = self.conj()
        while self.peek("w", "or"):
            self.i += 1
            right = self.conj()
            left = (lambda a, b: lambda r: a(r) or b(r))(left, right)
        return left

    def conj(self):
        left = self.unary()
        while self.peek("w", "and"):
            self.i += 1
            right = self.unary()
            left = (lambda a, b: lambda r: a(r) and b(r))(left, right)
        return left

    def unary(self):
        if self.peek("w", "not"):
            self.i += 1
            inner = self.unary()
            return lambda r: not inner(r)
        if self.peek("p", "("):
            self.i += 1
            inner = self.expr()
            self.take("p", ")")
            return inner
        tok = self.peek("w")
        if tok and tok[1].lower() in ("substringof", "startswith", "endswith"):
            return self.func(tok[1].lower())
        return self.cmp()

    def field(self):
        name = self.take("w")[1]
        if name not in FIELDS:
            raise ODataError(400, f"Поле «{name}» не найдено в {SET}")
        return name

    def literal(self):
        if self.i >= len(self.t):
            raise ODataError(400, "Ошибка разбора $filter: нет значения")
        k, v = self.t[self.i]
        self.i += 1
        if k in ("str", "num", "guid"):
            return v
        if k == "w" and v.lower() in ("true", "false"):
            return v.lower() == "true"
        if k == "w" and v.lower() == "null":
            return None
        raise ODataError(400, f"Ошибка разбора $filter: «{v}» — не значение")

    def cmp(self):
        f = self.field()
        op = self.take("w")[1].lower()
        if op not in self.OPS:
            raise ODataError(400, f"Ошибка разбора $filter: неизвестная операция «{op}»")
        v = self.literal()
        if f == "Ref_Key" and isinstance(v, str):
            v = v.lower()

        def check(r):
            x = r.get(f)
            if op == "eq":
                return x == v
            if op == "ne":
                return x != v
            if x is None or v is None:
                return False
            try:
                return {"gt": x > v, "ge": x >= v, "lt": x < v, "le": x <= v}[op]
            except TypeError:
                return False
        return check

    def func(self, name):
        self.i += 1
        self.take("p", "(")
        if name == "substringof":
            sub = self.literal()
            self.take("p", ",")
            f = self.field()
        else:
            f = self.field()
            self.take("p", ",")
            sub = self.literal()
        self.take("p", ")")
        sub = str(sub or "").lower()
        fn = {"substringof": lambda x: sub in x, "startswith": lambda x: x.startswith(sub),
              "endswith": lambda x: x.endswith(sub)}[name]
        return lambda r: fn(str(r.get(f) or "").lower())


# --- представление -----------------------------------------------------------------------------

def element(r: dict, select=None) -> dict:
    keys = select or list(FIELDS)
    return {k: num(r.get(k)) for k in keys}


def parse_select(q: dict):
    if "$select" not in q:
        return None
    keys = [k.strip() for k in q["$select"].split(",") if k.strip()]
    for k in keys:
        if k not in FIELDS:
            raise ODataError(400, f"Поле «{k}» не найдено в {SET}")
    return keys


def validate(body, partial: bool) -> dict:
    if not isinstance(body, dict):
        raise ODataError(400, "Тело запроса — JSON-объект")
    out = {}
    for k, v in body.items():
        if k.startswith("odata."):
            continue
        if k not in FIELDS:
            raise ODataError(400, f"Поле «{k}» не найдено в {SET}")
        if k in ("DataVersion", "Code"):
            raise ODataError(400, f"Поле «{k}» только для чтения")
        t = FIELDS[k]
        if t == "Edm.Double" and (isinstance(v, bool) or not isinstance(v, (int, float))):
            raise ODataError(400, f"Значение поля «{k}» должно быть числом (Edm.Double)")
        if t == "Edm.Boolean" and not isinstance(v, bool):
            raise ODataError(400, f"Значение поля «{k}» должно быть true или false")
        if t == "Edm.String" and not isinstance(v, str):
            raise ODataError(400, f"Значение поля «{k}» должно быть строкой")
        if t == "Edm.Guid" and not (isinstance(v, str) and GUID.match(v)):
            raise ODataError(400, f"Значение поля «{k}» — GUID вида 00000000-0000-0000-0000-000000000000")
        out[k] = v.lower() if t == "Edm.Guid" else v
    if "ИНН" in out and out["ИНН"] and not re.fullmatch(r"\d{10}|\d{12}", out["ИНН"]):
        raise ODataError(400, "ИНН — 10 или 12 цифр")
    if not partial and not str(out.get("Description") or "").strip():
        raise ODataError(400, "Не заполнено поле «Description» (Наименование)")
    return out


def metadata() -> str:
    props = "".join(f'<Property Name="{k}" Type="{t}" Nullable="{"false" if k == "Ref_Key" else "true"}"/>'
                    for k, t in FIELDS.items())
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">'
            '<edmx:DataServices xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" '
            'm:DataServiceVersion="3.0"><Schema Namespace="StandardODATA" '
            'xmlns="http://schemas.microsoft.com/ado/2009/11/edm">'
            f'<EntityType Name="{SET}"><Key><PropertyRef Name="Ref_Key"/></Key>{props}</EntityType>'
            f'<EntityContainer Name="EnterpriseV8" m:IsDefaultEntityContainer="true">'
            f'<EntitySet Name="{SET}" EntityType="StandardODATA.{SET}"/></EntityContainer>'
            '</Schema></edmx:DataServices></edmx:Edmx>')


# --- HTTP --------------------------------------------------------------------------------------

def split_url(raw: str):
    """Путь и параметры. Принимает и %-кодированную кириллицу, и сырой UTF-8 в строке запроса."""
    b = raw.encode("latin-1", "replace")
    path, _, qs = b.partition(b"?")
    dec = lambda x: unquote_to_bytes(x).decode("utf-8", "replace")  # noqa: E731
    q = {}
    for part in qs.split(b"&"):
        if part:
            k, _, v = part.partition(b"=")
            q[dec(k.replace(b"+", b" "))] = dec(v.replace(b"+", b" "))
    return dec(path).rstrip("/") or "/", q


class Handler(BaseHTTPRequestHandler):
    server_version = "1C:Enterprise-OData-imitation/1060"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send(self, status: int, body=None, ctype="application/json;odata=minimalmetadata;charset=utf-8",
             headers=None):
        data = b"" if body is None else (body if isinstance(body, bytes) else
                                         (body.encode() if isinstance(body, str) else
                                          json.dumps(body, ensure_ascii=False, indent=1).encode()))
        self.send_response(status)
        if data:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def error(self, e: ODataError):
        self.send(e.status, {"odata.error": {"code": e.code, "message": {"lang": "ru", "value": e.message}}})

    def authorized(self) -> bool:
        h = self.headers.get("Authorization", "")
        if not h.startswith("Basic "):
            return False
        try:
            login, _, pw = base64.b64decode(h[6:]).decode("utf-8").partition(":")
        except ValueError:
            return False
        return bool(PASSWORD) and login == USER and pw == PASSWORD

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            raise ODataError(400, "Тело запроса — не JSON")

    def handle_any(self, method: str):
        try:
            if not self.authorized():
                self.send(401, {"odata.error": {"code": "-1", "message": {"lang": "ru",
                                                                           "value": "Не прошла аутентификация"}}},
                          headers={"WWW-Authenticate": 'Basic realm="1C:Enterprise"'})
                return
            path, q = split_url(self.path)
            if not path.startswith(ROOT):
                raise ODataError(404, f"Не найден ресурс {path}")
            res = path[len(ROOT):].lstrip("/")
            base = f"http://{self.headers.get('Host', f'127.0.0.1:{PORT}')}{ROOT}"
            if res == "" and method == "GET":
                self.send(200, {"odata.metadata": f"{base}/$metadata", "value": [{"name": SET, "url": SET}]})
                return
            if res == "$metadata" and method == "GET":
                self.send(200, metadata(), "application/xml;charset=utf-8")
                return
            m = re.fullmatch(re.escape(SET) + r"(?:\(guid'([^']*)'\))?", res)
            if not m:
                raise ODataError(404, f"Не найден ресурс «{res}». Доступно: {SET}")
            key = (m.group(1) or "").lower() or None
            if key is not None and not GUID.match(key):
                raise ODataError(400, f"Неверный ключ guid'{key}'")
            with LOCK:
                self.dispatch(method, key, q, base)
        except ODataError as e:
            self.error(e)
        except Exception as e:  # noqa: BLE001 — сервис стенда отвечает ошибкой, а не падает
            self.error(ODataError(500, f"Внутренняя ошибка: {type(e).__name__}: {e}"))

    def dispatch(self, method, key, q, base):
        db = load()
        rows = db[SET]
        meta = f"{base}/$metadata#{SET}"
        if key is None and method == "GET":
            sel = parse_select(q)
            out = rows
            if q.get("$filter"):
                fn = Filter(q["$filter"]).fn
                out = [r for r in out if fn(r)]
            if q.get("$orderby"):
                for part in reversed(q["$orderby"].split(",")):
                    f, _, d = part.strip().partition(" ")
                    if f not in FIELDS:
                        raise ODataError(400, f"Поле «{f}» не найдено в {SET}")
                    out = sorted(out, key=lambda r: (r.get(f) is None, r.get(f) if r.get(f) is not None else ""),
                                 reverse=d.strip().lower() == "desc")
            skip, top = int(q.get("$skip") or 0), q.get("$top")
            out = out[skip:] if top is None else out[skip:skip + int(top)]
            self.send(200, {"odata.metadata": meta, "value": [element(r, sel) for r in out]})
            return
        if key is None and method == "POST":
            body = validate(self.body(), partial=False)
            ref = body.pop("Ref_Key", None) or str(uuid.uuid4())
            if any(r["Ref_Key"] == ref for r in rows):
                raise ODataError(400, f"Элемент с Ref_Key {ref} уже существует")
            db["seq"] += 1
            rec = {"Ref_Key": ref, "DataVersion": data_version(db["seq"]), "DeletionMark": False,
                   "Code": f"00-{len(rows) + 1:09d}", "Description": "", "ИНН": "", "ЛимитФинансирования": 0}
            rec.update(body)
            rows.append(rec)
            save(db)
            self.send(201, {"odata.metadata": f"{meta}/@Element", **element(rec)},
                      headers={"Location": f"{base}/{quote(SET)}(guid'{ref}')"})
            return
        if key is None:
            raise ODataError(405, f"Метод {method} не поддерживается для набора {SET}")
        rec = next((r for r in rows if r["Ref_Key"] == key), None)
        if rec is None:
            raise ODataError(404, f"Не найден элемент {SET}(guid'{key}')")
        if method == "GET":
            self.send(200, {"odata.metadata": f"{meta}/@Element", **element(rec, parse_select(q))})
        elif method in ("PATCH", "MERGE"):
            body = validate(self.body(), partial=True)
            if body.get("Ref_Key", key) != key:
                raise ODataError(400, "Поле «Ref_Key» только для чтения")
            body.pop("Ref_Key", None)
            rec.update(body)
            db["seq"] += 1
            rec["DataVersion"] = data_version(db["seq"])
            save(db)
            self.send(200, {"odata.metadata": f"{meta}/@Element", **element(rec)})
        elif method == "DELETE":
            rows.remove(rec)
            save(db)
            self.send(204)
        else:
            raise ODataError(405, f"Метод {method} не поддерживается")

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PATCH(self):
        self.handle_any("PATCH")

    def do_MERGE(self):
        self.handle_any("MERGE")

    def do_DELETE(self):
        self.handle_any("DELETE")

    def do_PUT(self):
        self.handle_any("PUT")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    if not PASSWORD:
        raise SystemExit("R1060R_PASSWORD не задан")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
