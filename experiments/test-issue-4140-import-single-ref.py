#!/usr/bin/env python3
"""E2E-тест issue #4140 (index.php, plain-импорт `object/{tableId}?JSON&import=1`).

Ссылочное поле БЕЗ мультивыбора при импорте должно ЗАМЕНЯТЬ уже записанную цель,
а не дописывать вторую. Дефект «плавал»: разрешённые имена целей кэшируются в
$GLOBALS["refs"][$refType][$ref] по ходу файла, и ветка кэш-попадания вставляла
ссылку, минуя проверку $GLOBALS["MULTI"] и перенацеливание (UpdateTyp).

Условие срабатывания — то, что делает шаг 2 ниже: строка выше по файлу ВСТАВИЛА
ссылку с этим именем (новая запись → имя попало в кэш), а следующая строка несёт
то же имя записи, у которой уже есть ссылка на ДРУГУЮ цель.

Запуск против поднятого стенда (docs/LOCAL_DOCKER_INSTALL.md):

    BASE=https://localhost:18443 DB=my TOKEN=<token> \
        python3 experiments/test-issue-4140-import-single-ref.py

TOKEN — значение куки idb_{DB} (см. docs/kb/00-start.md).
Тест создаёт свои таблицы со случайным суффиксом и удаляет их в конце.
"""

import json
import os
import ssl
import sys
import urllib.request
import uuid

BASE = os.environ.get("BASE", "https://localhost:18443").rstrip("/")
DB = os.environ.get("DB", "my")
TOKEN = os.environ.get("TOKEN")
if not TOKEN:
    sys.exit("Set TOKEN=<idb_%s cookie value>" % DB)

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE  # локальный самоподписанный сертификат

SUFFIX = uuid.uuid4().hex[:8]
passed = failed = 0


def check(name, ok, detail=""):
    global passed, failed
    print(("PASS" if ok else "FAIL") + " — " + name + (("  [%s]" % detail) if detail and not ok else ""))
    if ok:
        passed += 1
    else:
        failed += 1


def post(path, fields=None, files=None):
    """multipart/form-data POST; возвращает тело ответа (bytes)."""
    boundary = "----i4140" + uuid.uuid4().hex
    body = b""
    for key, value in (fields or {}).items():
        body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (boundary, key, value)).encode()
    for key, (filename, content) in (files or {}).items():
        body += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                 "Content-Type: text/plain\r\n\r\n" % (boundary, key, filename)).encode()
        body += content.encode() + b"\r\n"
    body += ("--%s--\r\n" % boundary).encode()
    req = urllib.request.Request(BASE + "/" + DB + "/" + path, data=body, method="POST")
    req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
    req.add_header("X-Authorization", TOKEN)
    req.add_header("Cookie", "idb_%s=%s" % (DB, TOKEN))
    return urllib.request.urlopen(req, context=CTX, timeout=30).read()


def get(path):
    req = urllib.request.Request(BASE + "/" + DB + "/" + path)
    req.add_header("X-Authorization", TOKEN)
    req.add_header("Cookie", "idb_%s=%s" % (DB, TOKEN))
    return urllib.request.urlopen(req, context=CTX, timeout=30).read()


XSRF = json.loads(get("xsrf?JSON"))["_xsrf"]


def api(path, fields=None, files=None):
    base_fields = {"token": TOKEN, "_xsrf": XSRF}
    base_fields.update(fields or {})
    return post(path, base_fields, files)


def api_json(path, fields=None):
    return json.loads(api(path, fields))


def imp(table_id, lines):
    """plain-импорт: первая строка DATA, у каждой строки завершающая ';'."""
    content = "DATA\n" + "".join(line + "\n" for line in lines)
    api("object/%s?JSON&import=1" % table_id, files={"bki_file": ("batch.bki", content)})


def refs_of(table_id, record_name, req_id):
    """Имена целей ссылки req_id у записи record_name (JSON_OBJ: 'id1,id2:val1,val2')."""
    rows = json.loads(get("object/%s?JSON_OBJ" % table_id))
    col = 1 + int(req_id["ord"]) - 1  # r[0] — имя записи, дальше реквизиты по порядку
    for row in rows:
        if row["r"][0] == record_name:
            cell = row["r"][col] if col < len(row["r"]) else ""
            if not cell:
                return []
            names = cell.split(":", 1)[1] if ":" in cell else cell
            return [n for n in names.split(",") if n]
    return []


# ── Схема: справочник Artist, Track с ОДИНОЧНОЙ ссылкой, Album с МУЛЬТИ-ссылкой ──
artist = api_json("_d_new?JSON=1", {"t": "3", "val": "A4140_" + SUFFIX, "unique": "1"})["obj"]
track = api_json("_d_new?JSON=1", {"t": "3", "val": "T4140_" + SUFFIX, "unique": "1"})["obj"]
album = api_json("_d_new?JSON=1", {"t": "3", "val": "L4140_" + SUFFIX, "unique": "1"})["obj"]
ref_type = api_json("_d_ref/%s?JSON=1" % artist)["obj"]
single = api_json("_d_req/%s?JSON=1" % track, {"t": ref_type})["id"]
multi = api_json("_d_req/%s?JSON=1" % album, {"t": ref_type})["id"]
api("_d_multi/%s?JSON=1" % multi, {"multi": "1"})

single_col = {"ord": "1"}
multi_col = {"ord": "1"}

try:
    # ── 1. Базовая линия: новая запись получает ровно одну ссылку ────────────
    imp(track, ["T1;Alpha;"])
    check("новая запись: одна ссылка", refs_of(track, "T1", single_col) == ["Alpha"],
          str(refs_of(track, "T1", single_col)))

    # ── 2. Регресс #4140: строка выше вставляет ссылку 'Beta' (новая запись T2)
    #      и кладёт имя в кэш; T1 уже ссылается на Alpha и тоже получает 'Beta'.
    #      Ожидание: Alpha ЗАМЕНЁН на Beta, а не Alpha+Beta.
    imp(track, ["T2;Beta;", "T1;Beta;"])
    got = refs_of(track, "T1", single_col)
    check("кэш-попадание: одиночная ссылка заменяется, а не дублируется", got == ["Beta"], str(got))
    check("соседняя новая запись не пострадала", refs_of(track, "T2", single_col) == ["Beta"])

    # ── 3. Замена без кэша (имя встречается впервые, отдельная запись) ───────
    imp(track, ["T4;Alpha;"])
    imp(track, ["T4;Gamma;"])
    check("одиночная ссылка заменяется и без кэша", refs_of(track, "T4", single_col) == ["Gamma"],
          str(refs_of(track, "T4", single_col)))

    # ── 4. Мультивыбор не сломан: несколько целей, повтор не плодит дубли ────
    imp(album, ["L1;Alpha,Beta;"])
    check("мульти-ссылка: обе цели", sorted(refs_of(album, "L1", multi_col)) == ["Alpha", "Beta"],
          str(refs_of(album, "L1", multi_col)))
    imp(album, ["L1;Alpha,Beta;"])
    check("мульти-ссылка: повторный импорт не дублирует",
          sorted(refs_of(album, "L1", multi_col)) == ["Alpha", "Beta"],
          str(refs_of(album, "L1", multi_col)))
    imp(album, ["L1;Alpha,Beta,Gamma;"])
    check("мульти-ссылка: третья цель добавляется",
          sorted(refs_of(album, "L1", multi_col)) == ["Alpha", "Beta", "Gamma"],
          str(refs_of(album, "L1", multi_col)))

    # ── 5. Отсутствующая цель создаётся; удаление ссылки пробелом ────────────
    imp(track, ["T3;Newbie;"])
    check("отсутствующая цель создаётся", refs_of(track, "T3", single_col) == ["Newbie"])
    imp(track, ["T1; ;"])
    check("значение-пробел удаляет ссылку", refs_of(track, "T1", single_col) == [],
          str(refs_of(track, "T1", single_col)))
finally:
    for type_id in (track, album, artist):
        try:
            api("_d_del/%s?JSON=1" % type_id)
        except Exception as exc:  # чистка не должна прятать результат теста
            print("cleanup %s: %s" % (type_id, exc))

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
