"""MCP-сервер сборщика (python2node#1055): инструменты агента, который закрывает риски в среде.

stdio, JSON-RPC, MCP 2024-11-05, как variant_a/mcp_server.py пилота #1008. Токены и пароли держит
сервер, агенту они не видны. Каждый вызов пишется в журнал R1055_CALLS (jsonl): по нему считаются
ходы и итерации «проверка → правка».

Окружение: R1055_ENV (b | a1 | a2 | a3), R1055_DB (база ядра в B), R1055_CALLS (журнал вызовов),
R1055_KB (каталог docs/kb для B), R1060_REG_* (реестр контрагентов A″, python2node#1060).
  A″-fdw (a2) — как A′ (S1 «Заявки») плюс crm_api: PostgREST реестра контрагентов (S2) от имени его админа.
  A″ (a3) — как A′ (S1) плюс reg_api: OData-API реестра контрагентов (S2, integ/a3/registry_odata.py),
       reg_doc: его справочник; sync_write / sync_run: программа синхронизации sync.py (integ/a3/a3lib.py).
  B  — api: HTTP API ядра от имени админа фонда или любого пользователя базы; kb_list/kb_read/kb_search.
  A′ — sql: SQL суперпользователем в базу app; api: PostgREST от имени любого пользователя.
       Документация — WebFetch по docs.postgrest.org и www.postgresql.org (встроенный инструмент Claude).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import envs as E  # noqa: E402

KIND = os.environ["R1055_ENV"]
CALLS = Path(os.environ["R1055_CALLS"]).resolve()
KB = Path(os.getenv("R1055_KB", "/nonexistent"))
ENV = E.CoreEnv(os.environ["R1055_DB"]) if KIND == "b" else E.PgrstEnv()
# A″ (python2node#1060): вторая система — реестр контрагентов, свой PostgreSQL + PostgREST.
REG = E.PgrstEnv(os.getenv("R1060_REG_DB", "registry"), stand=Path(os.getenv("R1060_REG_STAND", "/root/crm1055c")),
                 base_url=os.getenv("R1060_REG_URL", "http://127.0.0.1:18691"),
                 container=os.getenv("R1060_REG_CONTAINER", "crm1055c-db")) if KIND == "a2" else None
REG_ROLE = os.getenv("R1060_REG_ROLE", "registry_admin")
A3 = None
if KIND == "a3":
    sys.path.insert(0, str(HERE.parent / "integ" / "a3"))
    import a3lib as A3  # noqa: E402
LIMIT = 20000  # символов ответа: длиннее — обрезается с пометкой

AS = {"type": "string", "description": "Логин пользователя, от имени которого запрос (по умолчанию admin_f). "
                                       "Логины — из базы (например admin_f, expert1, alpha_user)."}
if KIND == "b":
    TOOLS = [
        {"name": "api", "description": "HTTP-запрос к API ядра ideav.ru для базы приложения. path — путь после имени "
         "базы, например «object/18/?JSON» или «_m_new/42»; query-параметры можно писать в path. Для POST поля формы "
         "передаются в form; _xsrf подставляется сам. Возвращает код HTTP и тело.",
         "inputSchema": {"type": "object", "required": ["method", "path"], "properties": {
             "method": {"type": "string", "enum": ["GET", "POST"]}, "path": {"type": "string"},
             "form": {"type": "object", "description": "поля формы для POST: {имя: значение}"},
             "as_user": AS, "ai": {"type": "boolean", "description": "запрос от ИИ (client=ai), по умолчанию да"}}}},
        {"name": "kb_list", "description": "Список документов базы знаний ядра (docs/kb).",
         "inputSchema": {"type": "object", "properties": {}}},
        {"name": "kb_read", "description": "Текст документа базы знаний, например «roles.md».",
         "inputSchema": {"type": "object", "required": ["name"], "properties": {"name": {"type": "string"}}}},
        {"name": "kb_search", "description": "Поиск подстроки (без учёта регистра) по базе знаний: строки с совпадениями.",
         "inputSchema": {"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}}},
    ]
else:
    TOOLS = [
        {"name": "sql", "description": "SQL в базу app (PostgreSQL 16) от суперпользователя postgres, через psql "
         "(-At, ON_ERROR_STOP). Возвращает вывод или ошибку.",
         "inputSchema": {"type": "object", "required": ["query"], "properties": {"query": {"type": "string"}}}},
        {"name": "api", "description": "HTTP-запрос к PostgREST (схема api) от имени пользователя: JWT "
         "{role, login} подставляется сам. path — например «application?select=number,amount». body — JSON для "
         "POST/PATCH. headers — дополнительные заголовки (Prefer и т.п.).",
         "inputSchema": {"type": "object", "required": ["method", "path"], "properties": {
             "method": {"type": "string", "enum": ["GET", "POST", "PATCH", "DELETE"]}, "path": {"type": "string"},
             "body": {}, "headers": {"type": "object"}, "as_user": AS,
             "ai": {"type": "boolean", "description": "запрос от ИИ (заголовок X-Client: ai), по умолчанию да"}}}},
    ]
if KIND == "a2":
    TOOLS.append(
        {"name": "crm_api", "description": "HTTP-запрос к PostgREST реестра контрагентов (вторая система, схема api) "
         "от имени администратора реестра. path — например «counterparty?select=inn,legal_name». body — JSON для "
         "POST/PATCH. headers — дополнительные заголовки (Prefer и т.п.).",
         "inputSchema": {"type": "object", "required": ["method", "path"], "properties": {
             "method": {"type": "string", "enum": ["GET", "POST", "PATCH", "DELETE"]}, "path": {"type": "string"},
             "body": {}, "headers": {"type": "object"}}}})
if KIND == "a3":
    TOOLS += [
        {"name": "reg_api", "description": "HTTP-запрос к API реестра контрагентов S2 (OData в стиле 1С) от имени "
         "его администратора, Basic-аутентификация подставляется сама. path — путь от корня "
         "/odata/standard.odata, например «Catalog_Контрагенты?$format=json&$select=Ref_Key,Description». "
         "body — JSON для POST/PATCH. Справочник API — инструмент reg_doc.",
         "inputSchema": {"type": "object", "required": ["method", "path"], "properties": {
             "method": {"type": "string", "enum": ["GET", "POST", "PATCH", "DELETE"]}, "path": {"type": "string"},
             "body": {}}}},
        {"name": "reg_doc", "description": "Справочник API реестра контрагентов S2 (REGISTRY_API.md).",
         "inputSchema": {"type": "object", "properties": {}}},
        {"name": "sync_write", "description": "Записать программу синхронизации sync.py (Python 3.12: стандартная "
         "библиотека и psycopg2). Файл заменяется целиком. Её запускает sync_run и раннер перед проверкой "
         "приложения. Переменные окружения: S1_DSN (строка подключения libpq к базе app S1 от суперпользователя), "
         "REG_URL (корень OData S2), REG_USER, REG_PASSWORD.",
         "inputSchema": {"type": "object", "required": ["code"], "properties": {"code": {"type": "string"}}}},
        {"name": "sync_read", "description": "Текст текущей программы синхронизации sync.py.",
         "inputSchema": {"type": "object", "properties": {}}},
        {"name": "sync_run", "description": f"Запустить sync.py (лимит {A3.SYNC_TIMEOUT} с). Возвращает код "
         "возврата, stdout и stderr.",
         "inputSchema": {"type": "object", "properties": {}}},
    ]


def _cut(text: str) -> str:
    return text if len(text) <= LIMIT else text[:LIMIT] + f"\n…[обрезано, всего {len(text)} символов]"


def call(name: str, a: dict) -> tuple:
    login, via = a.get("as_user") or "admin_f", "ai" if a.get("ai", True) else "human"
    if name == "api" and KIND == "b":
        path, q = (a["path"].split("?", 1) + [""])[:2]
        query = dict(urllib.parse.parse_qsl(q, keep_blank_values=True))
        ENV.login(login, via) if login not in ENV.xsrf else None
        form = {k: str(v) for k, v in (a.get("form") or {}).items()} if a["method"] == "POST" else None
        st, body = ENV._call(login, via, a["method"], path.lstrip("/"), query, form)
        return f"HTTP {st}\n{body}", st >= 400
    if name == "api":
        ENV.users = {}  # роли в api.app_user агент мог поменять
        headers = {"Authorization": f"Bearer {ENV.token(login)}", "Content-Type": "application/json",
                   **(a.get("headers") or {})}
        if via == "ai":
            headers["X-Client"] = "ai"
        data = json.dumps(a["body"], ensure_ascii=False).encode() if a.get("body") is not None else None
        req = urllib.request.Request(f"{ENV.base_url}/{a['path'].lstrip('/')}", data=data, method=a["method"],
                                     headers=headers)
        st, body = E.http(req)
        return f"HTTP {st}\n{body}", st >= 400
    if name == "crm_api" and REG is not None:
        tok = E.jwt(REG.secret, {"role": REG_ROLE, "exp": int(time.time()) + 3600})
        headers = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json", **(a.get("headers") or {})}
        data = json.dumps(a["body"], ensure_ascii=False).encode() if a.get("body") is not None else None
        req = urllib.request.Request(f"{REG.base_url}/{a['path'].lstrip('/')}", data=data, method=a["method"],
                                     headers=headers)
        st, body = E.http(req)
        return f"HTTP {st}\n{body}", st >= 400
    if name == "reg_api" and A3 is not None:
        st, body = A3.reg_call(a["method"], a["path"], a.get("body"))
        return f"HTTP {st}\n{body}", st >= 400
    if name == "reg_doc" and A3 is not None:
        return A3.DOC.read_text("utf-8"), False
    if name == "sync_write" and A3 is not None:
        p = A3.write_sync(ENV.db, a["code"])
        return f"записано {p.name}: {len(a['code'].splitlines())} строк", False
    if name == "sync_read" and A3 is not None:
        p = A3.sync_dir(ENV.db) / "sync.py"
        return (p.read_text("utf-8"), False) if p.exists() else ("sync.py не написан", True)
    if name == "sync_run" and A3 is not None:
        r = A3.run_sync(ENV.db, ENV.db)
        if r.get("missing"):
            return "sync.py не написан: сначала sync_write", True
        head = "превышен лимит времени" if r["timeout"] else f"код возврата {r['rc']}"
        return f"{head}\n--- stdout\n{r['stdout']}\n--- stderr\n{r['stderr']}", bool(r["timeout"] or r["rc"])
    if name == "sql":
        try:
            return ENV.psql(a["query"]) or "(пусто)", False
        except RuntimeError as e:
            return str(e), True
    if name == "kb_list":
        return "\n".join(sorted(p.name for p in KB.glob("*.md"))), False
    if name == "kb_read":
        p = KB / Path(a["name"]).name
        return (p.read_text("utf-8"), False) if p.is_file() else (f"нет документа {p.name}", True)
    if name == "kb_search":
        t = a["text"].lower()
        hits = [f"{p.name}:{i}: {line.strip()}" for p in sorted(KB.glob("*.md"))
                for i, line in enumerate(p.read_text("utf-8").splitlines(), 1) if t in line.lower()]
        return "\n".join(hits[:200]) or "совпадений нет", False
    return f"нет инструмента {name}", True


def main():
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        if method == "initialize":
            res = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                   "serverInfo": {"name": "env", "version": "1055"}}
        elif method == "tools/list":
            res = {"tools": TOOLS}
        elif method == "tools/call":
            p = msg.get("params") or {}
            t0 = time.time()
            try:
                text, err = call(p.get("name"), p.get("arguments") or {})
            except Exception as e:  # noqa: BLE001 — ошибка инструмента уходит агенту, сервер живёт
                text, err = f"{type(e).__name__}: {e}", True
            with CALLS.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"ts": round(t0, 3), "ms": int((time.time() - t0) * 1000), "tool": p.get("name"),
                                    "args": p.get("arguments"), "error": err, "out": text[:2000]},
                                   ensure_ascii=False) + "\n")
            res = {"content": [{"type": "text", "text": _cut(text)}], "isError": err}
        elif mid is None:
            continue
        else:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid,
                                         "error": {"code": -32601, "message": method}}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": res}, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
