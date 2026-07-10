#!/usr/bin/env python3
"""E2E-тест issue #4140, часть 2: запись, встреченная в файле дважды.

Insert_batch копит реквизиты в памяти и пишет их в базу одним INSERT. Сам объект
при этом создаётся сразу, через Insert(). Поэтому на второй строке файла с тем же
ключом SELECT находит запись, но её реквизитов ещё не видит: $reqs пуст, UpdateTyp
не вызывается, и значение уходит в батч ВТОРОЙ строкой. У поля без мультивыбора
получаются два значения — тот же дефект, что в #4140, только другой дорогой.

Дефект «плавающий» и здесь: батч сбрасывается сам, когда перевалит за BATCH_LIMIT,
и тогда всё внезапно работает.

Правка делает $GLOBALS["SQLbatch"] массивом [up][вид строки][колонка][слот], так что
у одиночного поля в батче всегда ровно одна строка: повторное значение затирает
предыдущее. Побеждает последнее — ровно как на пути через UpdateTyp / Update_Val.
Составной ключ уникальности живёт в реквизитах, поэтому FindUniqueRecordDuplicate
тоже не видит их в батче и плодит вторую запись — для этого рядом с батчем ведётся
индекс $GLOBALS["SQLbatchKeys"], а сам батч сбрасывается только на границе записи.

Запуск против поднятого стенда (docs/LOCAL_DOCKER_INSTALL.md):

    BASE=https://localhost:18443 DB=my TOKEN=<token> \
        python3 experiments/test-issue-4140-import-batch-visibility.py

TOKEN — значение куки idb_{DB}. Тест создаёт свои таблицы со случайным суффиксом
и удаляет их в конце.
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
    boundary = "----i4140b" + uuid.uuid4().hex
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
    return urllib.request.urlopen(req, context=CTX, timeout=120).read()


def get(path):
    req = urllib.request.Request(BASE + "/" + DB + "/" + path)
    req.add_header("X-Authorization", TOKEN)
    req.add_header("Cookie", "idb_%s=%s" % (DB, TOKEN))
    return urllib.request.urlopen(req, context=CTX, timeout=120).read()


XSRF = json.loads(get("xsrf?JSON"))["_xsrf"]


def api(path, fields=None, files=None):
    base_fields = {"token": TOKEN, "_xsrf": XSRF}
    base_fields.update(fields or {})
    return post(path, base_fields, files)


def api_json(path, fields=None):
    return json.loads(api(path, fields))


def imp(table_id, lines):
    """plain-импорт ОДНИМ файлом: первая строка DATA, у каждой строки завершающая ';'."""
    content = "DATA\n" + "".join(line + "\n" for line in lines)
    api("object/%s?JSON&import=1" % table_id, files={"bki_file": ("batch.bki", content)})


def rows(table_id):
    # без LIMIT список отдаётся страницей в DEFAULT_LIMIT (20) записей
    return json.loads(get("object/%s?JSON_OBJ&LIMIT=0,5000" % table_id))


def cell(table_id, record_name, col):
    """Значение колонки col (1..N) у записи record_name; '' если записи нет."""
    for row in rows(table_id):
        if row["r"][0] == record_name:
            return row["r"][col] if col < len(row["r"]) else ""
    return ""


def refs(table_id, record_name, col=1):
    """Имена целей ссылки в колонке col (JSON_OBJ отдаёт 'id1,id2:val1,val2')."""
    raw = cell(table_id, record_name, col)
    if not raw:
        return []
    names = raw.split(":", 1)[1] if ":" in raw else raw
    return [n for n in names.split(",") if n]


# ── Схема ────────────────────────────────────────────────────────────────────
# artist — справочник; ref_type — ссылочный терм на него
artist = api_json("_d_new?JSON=1", {"t": "3", "val": "BA_" + SUFFIX, "unique": "1"})["obj"]
ref_type = api_json("_d_ref/%s?JSON=1" % artist)["obj"]
note_type = api_json("_d_new?JSON=1", {"t": "3", "val": "BN_" + SUFFIX})["obj"]

# track — одиночная ссылка; album — мультиссылка; note — скалярный текст
track = api_json("_d_new?JSON=1", {"t": "3", "val": "BT_" + SUFFIX, "unique": "1"})["obj"]
album = api_json("_d_new?JSON=1", {"t": "3", "val": "BL_" + SUFFIX, "unique": "1"})["obj"]
note = api_json("_d_new?JSON=1", {"t": "3", "val": "BS_" + SUFFIX, "unique": "1"})["obj"]
api("_d_req/%s?JSON=1" % track, {"t": ref_type})
multi_req = api_json("_d_req/%s?JSON=1" % album, {"t": ref_type})["id"]
api("_d_multi/%s?JSON=1" % multi_req, {"multi": "1"})
api("_d_req/%s?JSON=1" % note, {"t": note_type})

# comp — БЕЗ собственной уникальности: ключ составной, по реквизиту-колонке 1
comp = api_json("_d_new?JSON=1", {"t": "3", "val": "BC_" + SUFFIX})["obj"]  # unique не шлём => uniq=0
comp_key = api_json("_d_req/%s?JSON=1" % comp, {"t": note_type})["id"]
api("_d_key/%s?JSON=1" % comp_key, {"key": "1"})
api("_d_req/%s?JSON=1" % comp, {"t": ref_type})

# bulk — то же самое, но под длинный файл: свой тип, чтобы счёт записей был чистым
bulk = api_json("_d_new?JSON=1", {"t": "3", "val": "BB_" + SUFFIX})["obj"]
bulk_key = api_json("_d_req/%s?JSON=1" % bulk, {"t": note_type})["id"]
api("_d_key/%s?JSON=1" % bulk_key, {"key": "1"})
api("_d_req/%s?JSON=1" % bulk, {"t": ref_type})

try:
    # ── 1. Одиночная ссылка: та же запись дважды в ОДНОМ файле ──────────────
    imp(track, ["T1;Alpha;", "T1;Beta;"])
    got = refs(track, "T1")
    check("одиночная ссылка: запись дважды в одном файле → одно значение", got == ["Beta"], str(got))

    # ── 2. Мультиссылка накапливает значения через строки одного файла ──────
    imp(album, ["L1;Alpha;", "L1;Beta;"])
    got = sorted(refs(album, "L1"))
    check("мультиссылка: значения из разных строк файла копятся", got == ["Alpha", "Beta"], str(got))

    # ── 3. Точный дубль строки не плодит записей (регресс #2785) ────────────
    imp(album, ["L2;Gamma;", "L2;Gamma;"])
    got = refs(album, "L2")
    check("точный дубль строки схлопывается (#2785)", got == ["Gamma"], str(got))

    # ── 4. Скалярный реквизит: запись дважды → один реквизит, а не два.
    #      Два реквизита видно так: удаление пробелом снимает ровно ОДИН из них,
    #      и в ячейке остаётся выживший дубль.
    imp(note, ["S1;one;", "S1;two;"])
    check("скаляр: побеждает последнее значение", cell(note, "S1", 1) == "two", cell(note, "S1", 1))
    imp(note, ["S1; ;"])
    check("скаляр: запись дважды в одном файле → один реквизит", cell(note, "S1", 1) == "",
          "остался дубль: " + cell(note, "S1", 1))

    # ── 5. Пробел стирает значение, поставленное выше по ТОМУ ЖЕ файлу ──────
    imp(track, ["T5;Alpha;", "T5; ;"])
    got = refs(track, "T5")
    check("пробел стирает ссылку, поставленную выше по файлу", got == [], str(got))

    # ── 6. Составной ключ: обе строки — одна запись, а не две ───────────────
    #      uniq=0, ключ — колонка 1, поэтому первая колонка в поиске не участвует.
    imp(comp, ["R1;K1;Alpha;", "R2;K1;Beta;"])
    comp_rows = rows(comp)
    check("составной ключ: одна запись, а не две", len(comp_rows) == 1,
          "записей: %d (%s)" % (len(comp_rows), [r["r"][0] for r in comp_rows]))
    if len(comp_rows) == 1:
        check("составной ключ: победило последнее значение ссылки",
              refs(comp, comp_rows[0]["r"][0], 2) == ["Beta"], str(refs(comp, comp_rows[0]["r"][0], 2)))

    # ── 7. Файл заведомо длиннее BATCH_LIMIT (31000 символов SQL), дубль ключа в
    #      самом конце. Батч успевает слиться посреди файла: индекс SQLbatchKeys
    #      обнуляется, и запись должна находиться уже обычным запросом к базе.
    pad = "x" * 24  # чтобы 700 записей заведомо перевалили за BATCH_LIMIT
    big = ["B%03d;BK%03d_%s;Alpha;" % (i, i, pad) for i in range(700)]
    big.append("B000_again;BK000_%s;Beta;" % pad)  # тот же составной ключ, что у первой строки
    imp(bulk, big)
    bulk_rows = rows(bulk)
    check("сброс батча посреди файла не ломает составной ключ", len(bulk_rows) == 700,
          "записей: %d, ожидалось 700" % len(bulk_rows))
    check("дубль ключа в конце длинного файла перезаписал ссылку",
          refs(bulk, "B000_again", 2) == ["Beta"], str(refs(bulk, "B000_again", 2)))
finally:
    for type_id in (track, album, note, comp, bulk, artist, note_type):
        try:
            api("_d_del/%s?JSON=1" % type_id)
        except Exception as exc:  # чистка не должна прятать результат теста
            print("cleanup %s: %s" % (type_id, exc))

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
