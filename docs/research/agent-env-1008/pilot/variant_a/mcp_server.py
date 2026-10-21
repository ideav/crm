"""MCP-сервер (stdio, JSON-RPC, MCP 2024-11-05) варианта A: тонкая обёртка над REST-сервисом.

Окружение: FUND_API_URL (http://127.0.0.1:<port>), FUND_TOKEN (токен пользователя).
Набор инструментов — того же уровня, что у ideav-mcp: схема, список/чтение/создание/правка/удаление
записей, добавление колонки. Права проверяет REST-сервис; отказ приходит как isError с кодом HTTP.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("FUND_API_URL", "").rstrip("/")
TOKEN = os.environ.get("FUND_TOKEN", "")
TABLE = {"type": "string", "enum": ["applications", "companies", "statuses", "users"],
         "description": "Таблица: applications (заявки на финансирование), companies, statuses, users."}
ID = {"type": ["integer", "string"],
      "description": "Числовой id записи; для applications можно передать и номер заявки, например З-001."}

TOOLS = [
    {"name": "describe_schema",
     "description": "Схема приложения «Заявки на финансирование»: таблицы, колонки, типы, ссылки между таблицами и то, "
                    "какие колонки и операции доступны ИМЕННО вам (с учётом вашей роли). Вызывайте первым.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "list_records",
     "description": "Список записей таблицы. Показываются только записи, доступные вашей роли. filters — объект "
                    "{поле: значение} (равенство) или {поле: {\"op\": \"gt\", \"value\": 100}}; op: eq, ne, gt, gte, "
                    "lt, lte, like; значение-список означает IN. Пример: {\"status\": \"Черновик\"}. "
                    "Для applications доступны и company/status/expert (названия), и company_id/status_id/expert_user_id.",
     "inputSchema": {"type": "object", "required": ["table"], "properties": {
         "table": TABLE, "filters": {"type": "object", "description": "Условия отбора, необязательно."},
         "limit": {"type": "integer", "description": "Сколько записей вернуть, по умолчанию 100, максимум 500."},
         "offset": {"type": "integer", "description": "Сколько записей пропустить."}}}},
    {"name": "get_record", "description": "Одна запись по id (для applications — по id или номеру заявки).",
     "inputSchema": {"type": "object", "required": ["table", "id"], "properties": {"table": TABLE, "id": ID}}},
    {"name": "create_record",
     "description": "Создать запись. values — {поле: значение}. Для applications обязателен number (номер заявки, "
                    "уникальный) и компания (company — код или название, либо company_id); статус можно задать "
                    "полем status (название) или status_id. Возвращает созданную запись. Недоступное вам действие "
                    "вернёт отказ 403 с пояснением.",
     "inputSchema": {"type": "object", "required": ["table", "values"], "properties": {
         "table": TABLE, "values": {"type": "object", "description": "Значения полей новой записи."}}}},
    {"name": "update_record",
     "description": "Изменить поля записи: values — только меняемые поля. Для статуса: status (название) или status_id. "
                    "Возвращает запись после изменения. Недоступные вам поля или записи дают отказ 403 с пояснением.",
     "inputSchema": {"type": "object", "required": ["table", "id", "values"], "properties": {
         "table": TABLE, "id": ID, "values": {"type": "object", "description": "Поля и новые значения."}}}},
    {"name": "delete_record", "description": "Удалить запись (если роль это разрешает; иначе 403).",
     "inputSchema": {"type": "object", "required": ["table", "id"], "properties": {"table": TABLE, "id": ID}}},
    {"name": "add_column",
     "description": "Изменение модели: добавить колонку в таблицу applications (только администратор фонда). "
                    "type: number или text. Новая колонка появляется в describe_schema и в записях.",
     "inputSchema": {"type": "object", "required": ["table", "name", "type"], "properties": {
         "table": {"type": "string", "enum": ["applications"], "description": "Пока только applications."},
         "name": {"type": "string", "description": "Имя колонки (буквы, цифры, пробел, _ . , ( ) / -)."},
         "type": {"type": "string", "enum": ["number", "text"], "description": "Тип колонки."}}}},
]


def http(method, path, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001
        return 0, json.dumps({"error": f"REST недоступен: {e}"}, ensure_ascii=False)


def seg(v):
    return urllib.parse.quote(str(v), safe="")


def call(name, a):
    if name == "describe_schema":
        return http("GET", "/api/schema")
    t = a.get("table")
    if name == "list_records":
        qs = {}
        if a.get("filters"):
            qs["filters"] = json.dumps(a["filters"], ensure_ascii=False)
        for k in ("limit", "offset"):
            if a.get(k) is not None:
                qs[k] = a[k]
        return http("GET", f"/api/{seg(t)}" + ("?" + urllib.parse.urlencode(qs) if qs else ""))
    if name == "get_record":
        return http("GET", f"/api/{seg(t)}/{seg(a.get('id'))}")
    if name == "create_record":
        return http("POST", f"/api/{seg(t)}", a.get("values"))
    if name == "update_record":
        return http("PATCH", f"/api/{seg(t)}/{seg(a.get('id'))}", a.get("values"))
    if name == "delete_record":
        return http("DELETE", f"/api/{seg(t)}/{seg(a.get('id'))}")
    if name == "add_column":
        return http("POST", f"/api/{seg(t)}/columns", {"name": a.get("name"), "type": a.get("type")})
    return 0, json.dumps({"error": f"неизвестный инструмент {name}"})


def handle(msg):
    m, mid = msg.get("method"), msg.get("id")
    if m == "initialize":
        return {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                "serverInfo": {"name": "fund", "version": "1.0"}}
    if m == "ping":
        return {}
    if m == "tools/list":
        return {"tools": TOOLS}
    if m == "tools/call":
        p = msg.get("params") or {}
        status, text = call(p.get("name"), p.get("arguments") or {})
        ok = 200 <= status < 300
        return {"content": [{"type": "text", "text": text if ok else f"HTTP {status}: {text}"}], "isError": not ok}
    if mid is None:
        return None  # уведомление
    raise KeyError(m)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        try:
            res = handle(msg)
            if msg.get("id") is None or res is None:
                continue
            out = {"jsonrpc": "2.0", "id": msg["id"], "result": res}
        except KeyError:
            if msg.get("id") is None:
                continue
            out = {"jsonrpc": "2.0", "id": msg["id"], "error": {"code": -32601, "message": "method not found"}}
        except Exception as e:  # noqa: BLE001
            out = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32603, "message": str(e)}}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
