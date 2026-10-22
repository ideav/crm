"""Эталонная синхронизация среды A″ (a3) замера python2node#1060: S2 «Реестр контрагентов» → S1 «Заявки».

Источник истины по компаниям — S2. Копия в S1 — api.company(id, name, inn, funding_limit, ext_id),
ext_id — Ref_Key элемента S2. Сопоставление по Ref_Key; компания S1 без ext_id привязывается один раз
по ИНН. Новые контрагенты S2 добавляются в S1. Помеченные на удаление в S2 не трогаются.
Окружение: S1_DSN (libpq), REG_URL, REG_USER, REG_PASSWORD.
"""
import base64
import json
import os
import urllib.parse
import urllib.request

import psycopg2

SET = "Catalog_Контрагенты"


def registry() -> list:
    q = urllib.parse.urlencode({"$format": "json", "$filter": "DeletionMark eq false",
                                "$select": "Ref_Key,Description,ИНН,ЛимитФинансирования"},
                               quote_via=urllib.parse.quote)
    req = urllib.request.Request(f"{os.environ['REG_URL']}/{urllib.parse.quote(SET)}?{q}", headers={
        "Authorization": "Basic " + base64.b64encode(
            f"{os.environ['REG_USER']}:{os.environ['REG_PASSWORD']}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))["value"]


def main():
    rows = registry()
    conn = psycopg2.connect(os.environ["S1_DSN"])
    changed = 0
    with conn, conn.cursor() as cur:
        for r in rows:
            ref, name, inn, limit = r["Ref_Key"], r["Description"], r["ИНН"], r["ЛимитФинансирования"]
            cur.execute("UPDATE api.company SET name = %s, inn = %s, funding_limit = %s WHERE ext_id = %s "
                        "AND (name, inn, funding_limit) IS DISTINCT FROM (%s, %s, %s)",
                        (name, inn, limit, ref, name, inn, limit))
            changed += cur.rowcount
            cur.execute("SELECT 1 FROM api.company WHERE ext_id = %s", (ref,))
            if cur.fetchone():
                continue
            cur.execute("UPDATE api.company SET ext_id = %s, name = %s, funding_limit = %s "
                        "WHERE ext_id IS NULL AND inn = %s", (ref, name, limit, inn))
            if cur.rowcount == 0:
                cur.execute("INSERT INTO api.company (id, name, inn, funding_limit, ext_id) "
                            "SELECT coalesce(max(id), 0) + 1, %s, %s, %s, %s FROM api.company",
                            (name, inn, limit, ref))
            changed += 1
    print(f"контрагентов в S2: {len(rows)}, изменено в S1: {changed}")


if __name__ == "__main__":
    main()
