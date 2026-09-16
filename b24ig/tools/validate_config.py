#!/usr/bin/env python3
"""Проверка конфига коннектора Битрикс24 -> Интеграм по живой схеме базы Интеграма.

Использование:
    INTEGRAM_TOKEN=... python3 validate_config.py ../config/sportzania-spz.json
    python3 validate_config.py ../config/sportzania-spz.json --schema metadata.json   # без сети

Код выхода: 0 — ошибок нет (предупреждения допустимы), 1 — есть ошибки.
"""
import json, os, re, sys, urllib.parse, urllib.request

TRANSFORMS = {"number", "money", "datetime", "yn", "join", "multifield", "template"}
SECRET_KEYS = {"webhook", "token", "password", "telegram_bot_token", "telegram_chat_id"}
SOURCE_TYPES = {"bitrix24", "odata1c", "mock"}
ENTITY_MODES = {"upsert", "insert_only", "replace_children"}
LOAD_MODES = {"full", "incremental"}
REF_BY = {"key", "name"}
REF_MISSING = {"skip", "create", "error"}

errors, warnings = [], []
err = lambda m: errors.append(m)
warn = lambda m: warnings.append(m)


def col_name(req):
    a = req.get("attrs") or ""
    if a.startswith("{"):
        try:
            return json.loads(a).get("alias") or req["val"]
        except ValueError:
            return req["val"]
    if "ALIAS=" in a:
        return a.split("ALIAS=")[1].split(":")[0]
    return req["val"]


def load_schema(cfg, schema_file):
    if schema_file:
        return json.load(open(schema_file, encoding="utf-8"))
    tgt = cfg["target"]
    token = os.environ.get(tgt["token"].strip("${}"), "")
    if not token:
        sys.exit(f"нет токена в переменной окружения {tgt['token']} (или используйте --schema)")
    url = f"{tgt['base_url']}/{tgt['db']}/metadata?JSON=1"
    req = urllib.request.Request(url, headers={"X-Authorization": token})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def check_secrets(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if k in SECRET_KEYS and isinstance(v, str) and v and not re.fullmatch(r"\$\{[A-Z0-9_]+\}", v):
                err(f"{path}{k}: секрет записан значением, нужна ссылка на окружение вида ${{VAR}}")
            check_secrets(v, f"{path}{k}.")


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    cfg_path = args[0]
    schema_file = args[args.index("--schema") + 1] if "--schema" in args else None
    cfg = json.load(open(cfg_path, encoding="utf-8"))

    if "source" in cfg and "sources" not in cfg:   # формат v1: один источник
        cfg["sources"] = {"default": cfg.pop("source")}
    for k in ("version", "project", "sources", "target", "order", "entities"):
        if k not in cfg:
            err(f"нет обязательного ключа верхнего уровня: {k}")
    if errors:
        return report()
    check_secrets(cfg)

    tables = {t["id"]: t for t in load_schema(cfg, schema_file)}
    by_name = {}
    for t in tables.values():
        by_name.setdefault(t["val"], []).append(t)

    sources = cfg["sources"]
    for sname, s in sources.items():
        if s.get("type") not in SOURCE_TYPES:
            err(f"sources.{sname}.type: {s.get('type')} — допустимо {sorted(SOURCE_TYPES)}")

    def conn_of(explicit, where):
        if explicit:
            if explicit not in sources:
                err(f"{where}: подключение «{explicit}» не описано в sources")
            return explicit
        if len(sources) == 1:
            return next(iter(sources))
        err(f"{where}: подключений несколько — укажите connection")

    dicts = cfg.get("dictionaries", {})
    for name, d in dicts.items():
        if d.get("source") == "static":
            if not d.get("map"):
                err(f"dictionaries.{name}: static без map")
        else:
            conn_of(d.get("connection"), f"dictionaries.{name}")

    ents = cfg["entities"]
    order = cfg["order"]
    for e in order:
        if e not in ents:
            err(f"order: сущности {e} нет в entities")
    for e in ents:
        if e not in order and ents[e].get("enabled", True):
            warn(f"entities.{e} включена, но не указана в order — не будет загружаться")
    pos = {e: i for i, e in enumerate(order)}

    ent_table = {}
    for ename, ent in ents.items():
        p = f"entities.{ename}"
        tgt = ent.get("target", {})
        tid = str(tgt.get("table_id", ""))
        t = tables.get(tid)
        if not t:
            err(f"{p}.target.table_id={tid}: таблица не найдена в базе")
            continue
        if t["val"] != tgt.get("table"):
            err(f"{p}.target: table_id {tid} — это «{t['val']}», а в конфиге «{tgt.get('table')}»")
        if len(by_name.get(t["val"], [])) > 1:
            warn(f"{p}: в базе несколько таблиц с именем «{t['val']}», опирайтесь на table_id")
        ent_table[ename] = t
        cols = {}
        for r in t.get("reqs", []):
            cols.setdefault(col_name(r), []).append(r)
        for n, rs in cols.items():
            if len(rs) > 1:
                warn(f"{p}: в таблице несколько колонок «{n}» — сопоставление по имени неоднозначно")

        if tgt.get("mode") not in ENTITY_MODES:
            err(f"{p}.target.mode: {tgt.get('mode')} — допустимо {sorted(ENTITY_MODES)}")
        load = ent.get("load", {})
        if load.get("mode") not in LOAD_MODES:
            err(f"{p}.load.mode: {load.get('mode')} — допустимо {sorted(LOAD_MODES)}")
        # Битрикс: pagination=start (user.get/department.get) не умеет период и инкремент
        if src.get("method") and src.get("pagination", "start") != "id_cursor":
            if load.get("mode") == "incremental":
                err(f"{p}: load.mode=incremental требует source.pagination=id_cursor")
            if load.get("period"):
                err(f"{p}: load.period требует source.pagination=id_cursor (pagination=start период игнорирует)")
        key = tgt.get("key")
        if tgt.get("parent"):
            pname = tgt["parent"].get("entity")
            pent = ents.get(pname)
            if not pent:
                err(f"{p}.target.parent.entity: нет сущности {pname}")
            else:
                pt = tables.get(str(pent.get("target", {}).get("table_id")))
                if pt and not any(str(r.get("arr_id")) == tid for r in pt.get("reqs", [])):
                    err(f"{p}.target: «{t['val']}» не подчинённая таблица «{pt['val']}»")
                if pos.get(pname, 1e9) > pos.get(ename, -1):
                    err(f"{p}.target.parent: родитель {pname} загружается позже — поменяйте order")
            if tgt.get("mode") != "replace_children":
                err(f"{p}.target.mode: для табличной части нужен replace_children")
            if not ent.get("source", {}).get("collection"):
                err(f"{p}.source.collection: не задана табличная часть родителя")
        elif key == "@name":
            if str(t.get("unique")) != "1":
                err(f"{p}.target.key=@name, но первая колонка «{t['val']}» не уникальна — нужен ключевой реквизит")
        else:
            kr = cols.get(key)
            if not kr:
                err(f"{p}.target.key: колонки «{key}» нет в таблице")
            elif '"key"' not in (kr[0].get("attrs") or "") and ":KEY:" not in (kr[0].get("attrs") or "").upper():
                err(f"{p}.target.key: у колонки «{key}» не стоит флаг ключа уникальности (_d_key/{kr[0]['id']})")
            if str(t.get("unique")) == "1":
                err(f"{p}.target.key: «{key}» — колонка, но первая колонка «{t['val']}» уникальна: импорт ищет по ключу и названию, "
                    "переименование в источнике создаст дубль (снимите уникальность или используйте key=@name)")

        src = ent.get("source", {})
        if "from_entity" in src:
            fe = src["from_entity"]
            if fe not in ents:
                err(f"{p}.source.from_entity: нет сущности {fe}")
        else:
            conn_of(src.get("connection"), f"{p}.source")
            if not src.get("method") and not src.get("entity"):
                err(f"{p}.source: не задан method (Битрикс) или entity (1С)")

        used_cols = {}
        fields = ent.get("fields", {})
        if not any(f.get("column") == "@name" for f in fields.values()):
            err(f"{p}.fields: ни одно поле не пишется в первую колонку (@name)")
        if key not in ("@name", None) and not any(f.get("column") == key for f in fields.values()):
            err(f"{p}.fields: внешний ключ «{key}» не заполняется ни одним полем")
        for fname, f in fields.items():
            fp = f"{p}.fields.{fname}"
            col = f.get("column")
            if not col:
                err(f"{fp}: нет column"); continue
            if col in used_cols:
                err(f"{fp}: колонка «{col}» уже занята полем {used_cols[col]}")
            used_cols[col] = fname
            if "@" in fname and "from" not in f:
                err(f"{fp}: ключ с суффиксом @ требует from")
            tr = f.get("transform")
            if tr:
                if tr.startswith("dict:"):
                    if tr[5:] not in dicts:
                        err(f"{fp}: справочник {tr[5:]} не описан в dictionaries")
                elif tr not in TRANSFORMS:
                    err(f"{fp}: неизвестное преобразование {tr}")
                if tr == "template" and not f.get("template"):
                    err(f"{fp}: transform=template без template")
            if col == "@name":
                continue
            rq = cols.get(col)
            if not rq:
                err(f"{fp}: колонки «{col}» нет в таблице «{t['val']}»"); continue
            rq = rq[0]
            ref = f.get("ref")
            if ref:
                if not rq.get("ref"):
                    err(f"{fp}: в конфиге ссылка, а колонка «{col}» — не ссылочная")
                if ref.get("by") not in REF_BY:
                    err(f"{fp}.ref.by: {ref.get('by')} — допустимо {sorted(REF_BY)}")
                if ref.get("missing", "skip") not in REF_MISSING:
                    err(f"{fp}.ref.missing: допустимо {sorted(REF_MISSING)}")
                multi_col = "multi" in (rq.get("attrs") or "").lower()
                if bool(ref.get("multi")) != multi_col:
                    err(f"{fp}.ref.multi={bool(ref.get('multi'))}, а колонка multi={multi_col}")
                te = ref.get("entity")
                if ref.get("by") == "key":
                    if not te or te not in ents:
                        err(f"{fp}.ref: by=key требует entity из этого конфига")
                    else:
                        tt = str(ents[te].get("target", {}).get("table_id"))
                        if rq.get("ref") and str(rq["ref"]) != tt:
                            err(f"{fp}.ref: колонка ссылается на таблицу {rq['ref']}, а сущность {te} пишет в {tt}")
                        if te != ename and pos.get(te, 1e9) > pos.get(ename, -1):
                            err(f"{fp}.ref: сущность {te} загружается позже {ename} — поменяйте order")
                        if ents[te].get("target", {}).get("key") != "@name" and ref.get("missing") == "create":
                            err(f"{fp}.ref: missing=create для цели с ключевой колонкой создаст запись без ключа (будущий дубль)")
            elif rq.get("ref"):
                warn(f"{fp}: колонка «{col}» ссылочная, а ref не задан — значение будет искаться по имени с созданием заглушек")

        unmapped = [n for n in cols if n not in used_cols]
        if unmapped and tgt.get("mode") == "upsert":
            warn(f"{p}: колонки без источника (не будут меняться): {', '.join(unmapped)}")
        if ent.get("hierarchy") and ent["hierarchy"].get("parent_field") not in fields:
            err(f"{p}.hierarchy.parent_field не описан в fields")
    return report()


def report():
    for w in warnings:
        print("⚠️ ", w)
    for e in errors:
        print("❌", e)
    print(f"\nИтог: ошибок {len(errors)}, предупреждений {len(warnings)}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
