"""MCP-сервер сборщика (python2node#1055): инструменты агента, который закрывает риски в среде.

stdio, JSON-RPC, MCP 2024-11-05, как variant_a/mcp_server.py пилота #1008. Токены и пароли держит
сервер, агенту они не видны. Каждый вызов пишется в журнал R1055_CALLS (jsonl): по нему считаются
ходы и итерации «проверка → правка».

Окружение: R1055_ENV (b | a1), R1055_DB (база ядра в B), R1055_CALLS (журнал вызовов),
R1055_KB (каталог docs/kb для B).
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
