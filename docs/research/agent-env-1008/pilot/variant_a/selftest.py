"""Проверки варианта A без LLM: python3 selftest.py  (на песочнице)."""
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import variant_a as V  # noqa: E402
import funding as F  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def api(ctx, login, method, path, body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(ctx["api_url"] + urllib.parse.quote(path, safe="/?&=%"), data=data, method=method, headers={
        "Authorization": "Bearer " + ctx["tokens"][login], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def main():
    ctx = V.provision("selftest-1")
    try:
        # 1. snapshot == funding.App
        app = F.App(ctx["tokens"], seed=1008)
        snap = V.snapshot(ctx)
        check("snapshot: 9 заявок", len(snap["apps"]) == 9, str(len(snap["apps"])))
        check("snapshot: суммы и статусы как в funding.App",
              all(snap["apps"][a["number"]]["amount"] == a["amount"] and snap["apps"][a["number"]]["status"] == a["status"]
                  and snap["apps"][a["number"]]["company"] == a["company"] for a in app.apps))
        print("     суммы:", {k: v["amount"] for k, v in snap["apps"].items()})
        # 2. alpha_user
        s, r = api(ctx, "alpha_user", "GET", "/api/applications")
        nums = sorted(x["number"] for x in r["records"])
        check("alpha_user видит З-001, З-002 (свои, ниже «На экспертизе»)", nums == ["З-001", "З-002"], str(nums))
        check("alpha_user: поле expert скрыто", all("expert" not in x and "expert_user_id" not in x for x in r["records"]))
        s, r = api(ctx, "alpha_user", "GET", "/api/applications/З-004")
        check("alpha_user: чужая заявка З-004 читать -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-004", {"amount": 1})
        check("alpha_user: чужая заявка З-004 менять -> 403", s == 403 and "error" in r, f"{s} {r}")
        print("     403-текст:", r)
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-003", {"amount": 1})
        check("alpha_user: своя З-003 «На экспертизе» -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-001", {"company": "beta"})
        check("alpha_user: перенос заявки в чужую компанию -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-001", {"status": "На экспертизе"})
        check("alpha_user: статус «На экспертизе» -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-001", {"verdict": "ок"})
        check("alpha_user: verdict -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-001", {"expert": "expert1"})
        check("alpha_user: expert -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-001", {"amount": 3900000, "status": "Подана"})
        check("alpha_user: своя З-001 сумма+статус -> 200", s == 200 and r["amount"] == 3900000 and r["status"] == "Подана", f"{s} {r}")
        s, r = api(ctx, "alpha_user", "POST", "/api/applications", {"number": "З-100", "amount": 1000, "description": "т\"ест'\\"})
        check("alpha_user: создать свою -> 201, Черновик", s == 201 and r["company"] == "ООО «Альфа»" and r["status"] == "Черновик", f"{s} {r}")
        check("спецсимволы в тексте сохраняются", r.get("description") == "т\"ест'\\", str(r))
        s, r = api(ctx, "alpha_user", "POST", "/api/applications", {"number": "З-101", "company": "beta"})
        check("alpha_user: создать для beta -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "POST", "/api/applications", {"number": "З-100"})
        check("дубль номера -> 409", s == 409, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-100", {"amount": "abc"})
        check("amount='abc' -> 400", s == 400, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "DELETE", "/api/applications/З-004")
        check("alpha_user: удалить чужую -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "DELETE", "/api/applications/З-100")
        check("alpha_user: удалить свою -> 200", s == 200, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "GET", "/api/users")
        check("alpha_user: users -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "alpha_user", "GET", '/api/applications?filters=' + urllib.request.quote('{"expert":"expert1"}'))
        check("alpha_user: фильтр по expert -> 403", s == 403, f"{s} {r}")
        before = V.snapshot(ctx)["apps"]["З-004"]
        check("чужая З-004 не изменилась", before["amount"] == app.apps[3]["amount"])
        # 3. expert
        s, r = api(ctx, "expert1", "GET", "/api/applications")
        check("expert1 читает все 9", s == 200 and r["total"] == 9, f"{s}")
        s, r = api(ctx, "expert1", "PATCH", "/api/applications/З-003", {"amount": 1})
        check("expert1: менять сумму -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "expert1", "PATCH", "/api/applications/З-003", {"status": "Одобрена", "verdict": "ок"})
        check("expert1: статус+заключение -> 200", s == 200 and r["status"] == "Одобрена" and r["verdict"] == "ок", f"{s} {r}")
        s, r = api(ctx, "expert1", "DELETE", "/api/applications/З-003")
        check("expert1: удалять -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "expert1", "POST", "/api/applications", {"number": "З-200", "company": "alpha"})
        check("expert1: создавать -> 403", s == 403, f"{s} {r}")
        s, r = api(ctx, "expert1", "POST", "/api/applications/columns", {"name": "Х", "type": "text"})
        check("expert1: add_column -> 403", s == 403, f"{s} {r}")
        # 4. admin
        s, r = api(ctx, "admin_f", "POST", "/api/applications/columns", {"name": "Срок, мес", "type": "number"})
        check("admin: add_column -> 201", s == 201, f"{s} {r}")
        s, r = api(ctx, "admin_f", "PATCH", "/api/applications/З-001", {"Срок, мес": 12})
        check("admin: запись в новую колонку", s == 200 and r.get("Срок, мес") == 12, f"{s} {r}")
        snap = V.snapshot(ctx)
        check("snapshot.extra и app_columns видят колонку",
              snap["apps"]["З-001"]["extra"] == {"Срок, мес": 12} and snap["apps"]["З-002"]["extra"] == {"Срок, мес": None}
              and snap["app_columns"][-1] == "Срок, мес", str(snap["apps"]["З-001"]["extra"]))
        s, r = api(ctx, "alpha_user", "PATCH", "/api/applications/З-001", {"Срок, мес": 6})
        check("alpha_user пишет в новую колонку -> 200", s == 200, f"{s} {r}")
        s, r = api(ctx, "admin_f", "DELETE", "/api/applications/З-006")
        check("admin: удалить -> 200", s == 200, f"{s} {r}")
        s, r = api(ctx, "admin_f", "GET", "/api/schema")
        check("describe_schema содержит новую колонку", any(c["name"] == "Срок, мес" for c in r["tables"][0]["columns"]))
        s, r = api(ctx, "admin_f", "POST", "/api/applications/columns", {"name": "x`; DROP TABLE users;--", "type": "text"})
        check("add_column: плохое имя -> 400", s == 400, f"{s} {r}")
        # 5. журнал без токенов
        log = (Path(ctx["run_dir"]) / "api.jsonl").read_text(encoding="utf-8")
        check("api.jsonl без токенов", not any(t in log for t in ctx["tokens"].values()))
        recs = [json.loads(x) for x in log.splitlines()]
        check("api.jsonl: поля ts/login/method/path/body/status", all({"ts", "login", "method", "path", "body", "status"} <= set(x) for x in recs))
        # 6. MCP по stdio
        env = dict(os.environ, FUND_API_URL=ctx["api_url"], FUND_TOKEN=ctx["tokens"]["alpha_user"])
        reqs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_records", "arguments": {"table": "applications", "filters": {"status": "Черновик"}}}},
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "get_record", "arguments": {"table": "applications", "id": "З-004"}}}]
        p = subprocess.run([sys.executable, str(HERE / "mcp_server.py")], input="\n".join(map(json.dumps, reqs)).encode(),
                           capture_output=True, env=env, timeout=60)
        out = {m["id"]: m for m in map(json.loads, p.stdout.decode().splitlines())}
        check("MCP: initialize 2024-11-05", out[1]["result"]["protocolVersion"] == "2024-11-05")
        check("MCP: 7 инструментов", sorted(t["name"] for t in out[2]["result"]["tools"]) ==
              sorted(["describe_schema", "list_records", "get_record", "create_record", "update_record", "delete_record", "add_column"]))
        lst = json.loads(out[3]["result"]["content"][0]["text"])
        check("MCP: list_records (alpha, Черновик) -> З-001 был изменён на Подана, значит 0", lst["total"] == 0, str(lst))
        check("MCP: get_record чужой -> isError", out[4]["result"]["isError"] is True and "403" in out[4]["result"]["content"][0]["text"])
    finally:
        V.teardown(ctx)
    check("teardown: база удалена", subprocess.run(
        ["docker", "exec", "crm1008-db", "sh", "-c", 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "show databases like \'ra_selftest_1\'"'],
        capture_output=True).stdout.strip() == b"")

    # 7. параллельные прогоны
    res = {}

    def one(i):
        c = V.provision(f"par-{i}", overrides={"З-001": {"text": f"прогон {i}", "amount": 100 + i}})
        try:
            s, r = api(c, "admin_f", "PATCH", "/api/applications/З-002", {"amount": 7000 + i})
            api(c, "admin_f", "POST", "/api/applications/columns", {"name": f"col{i}", "type": "text"})
            res[i] = (c["port"], c["db"], V.snapshot(c))
        finally:
            V.teardown(c)
    ts = [threading.Thread(target=one, args=(i,)) for i in (1, 2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    a, b = res[1], res[2]
    check("параллельно: разные порты и базы", a[0] != b[0] and a[1] != b[1], f"{a[:2]} {b[:2]}")
    check("параллельно: изоляция данных",
          a[2]["apps"]["З-001"]["text"] == "прогон 1" and b[2]["apps"]["З-001"]["text"] == "прогон 2"
          and a[2]["apps"]["З-002"]["amount"] == 7001 and b[2]["apps"]["З-002"]["amount"] == 7002
          and a[2]["app_columns"][-1] == "col1" and b[2]["app_columns"][-1] == "col2")
    print("FAILS:", FAILS or "нет")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
