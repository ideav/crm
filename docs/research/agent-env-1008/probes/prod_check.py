"""Пробы масок на боевом ядре ideav.ru — в тестовой базе (python2node#1008).

То же, что probe.py, но без своей базы на пробу: приложение «Заявки» сеется в существующую тестовую
базу строками с id >= ID_FLOOR (свободный диапазон), снимается дифф только этих строк, после каждой
пробы и в конце строки удаляются. Уровни доступа берутся из базы (у шаблона ideav.ru они другие,
чем у docker-шаблона crm). База — только служебная тестовая, не клиентская.

  python probes/prod_check.py --db bt866test [--only W1,C1] [--out results/prod-<дата>.json]
Доступ к MySQL — через ssh root@<хост> mysql (переменная R1008_SSH).
"""
import argparse
import datetime
import json
import os
import secrets
import subprocess
from pathlib import Path

import probe as P
import funding as F

SSH = os.getenv("R1008_SSH", "root@92.242.60.37")
ID_FLOOR = 10000


def remote_mysql(sql: str) -> list:
    p = subprocess.run(["ssh", "-o", "BatchMode=yes", SSH, "mysql -N -B ideav"],
                       input=sql.encode("utf-8"), capture_output=True)
    if p.returncode:
        raise RuntimeError(f"mysql: {p.stderr.decode('utf-8', 'replace')[-500:]}")
    return [line.split("\t") for line in p.stdout.decode("utf-8").splitlines()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--base", default="https://ideav.ru")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    db = args.db
    P.mysql, P.BASE = remote_mysql, args.base

    if remote_mysql(f"SELECT COUNT(*) FROM {db} WHERE id>={ID_FLOOR} OR up>={ID_FLOOR}")[0][0] != "0":
        raise SystemExit(f"в {db} уже есть строки с id >= {ID_FLOOR} — диапазон занят, проба не запускается")
    levels = {v: int(i) for i, v in remote_mysql(f"SELECT id, val FROM {db} WHERE t=47 AND up=1")}
    F.WRITE, F.READ, F.BARRED = levels["WRITE"], levels["READ"], levels["BARRED"]
    cleanup = f"DELETE FROM {db} WHERE id>={ID_FLOOR} OR up>={ID_FLOOR};"

    def snapshot(_db):
        return {int(i): (int(u), int(o), int(t), bytes.fromhex(v).decode("utf-8")) for i, u, o, t, v in
                remote_mysql(f"SELECT id, up, ord, t, HEX(val) FROM {db} WHERE id>={ID_FLOOR} OR up>={ID_FLOOR}")}

    only = {x for x in args.only.split(",") if x}
    results = []
    try:
        for spec0 in P.probes(F.App({u: "x" for u, _, _ in F.USERS})):
            if only and spec0["id"] not in only:
                continue
            tokens = {login: secrets.token_hex(32) for login, _, _ in F.USERS}
            app = F.App(tokens)
            values = ",\n".join("(" + ",".join(F.sql_quote(x) for x in r) + ")" for r in app.rows)
            remote_mysql(f"SET NAMES utf8mb4;\n{cleanup}\nINSERT INTO {db} (id, up, ord, t, val) VALUES\n{values};")
            spec = next(x for x in P.probes(app) if x["id"] == spec0["id"])
            method, path, query, form = spec["call"]
            s = P.Session(db, tokens[spec["user"]])
            if form is not None:
                s.call("GET", "xsrf", {"JSON": 1})
            before = snapshot(db)
            status, body = s.call(method, path, query, form)
            after = snapshot(db)
            changes = P.diff(before, after)
            rec = {k: spec[k] for k in ("id", "kind", "category", "user", "expect", "what")}
            rec.update(http=status, body=body[:600], changes=changes)
            if spec["kind"] == "read":
                rec["leaked"] = [x for x in spec["leak"] if x in body]
                rec["missing"] = [x for x in spec.get("need", []) if x not in body]
                happened = bool(rec["leaked"]) if spec["expect"] == "deny" else not rec["missing"]
            else:
                happened = bool(changes)
            rec["verdict"] = P.verdict(spec["expect"], happened)
            results.append(rec)
            print(f"{rec['id']:4} {rec['verdict']:10} http={status} Δ={len(changes)} {rec['what']}", flush=True)
    finally:
        remote_mysql(cleanup)
    out = {"issue": "ideav/python2node#1008", "step": "prod-probes", "base": args.base, "db": db,
           "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "results": results}
    path = Path(args.out or P.HERE.parent / "results" / f"prod-{datetime.date.today():%Y%m%d}.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), "utf-8")
    print(f"→ {path}")


if __name__ == "__main__":
    main()
