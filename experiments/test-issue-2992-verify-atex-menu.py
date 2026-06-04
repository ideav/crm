#!/usr/bin/env python3
# Проверка #2992: пункты меню atex созданы для тестовых ролей корректно и без дублей.
#
# Сверяет записи системной таблицы 151 (Меню) с docs/atex_menu.json:
#   * каждая роль из JSON существует в таблице 42;
#   * у каждой роли есть ожидаемые пункты меню;
#   * href (t153), icon (t391) и params (t158) совпадают;
#   * повторный прогон скрипта не создаёт дубли.
#
# Использование:
#   test-issue-2992-verify-atex-menu.py <atex_menu.json> <object_42.json> <object_151.json>
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def fail(msg):
    print(f"\n✗ {msg}")
    sys.exit(1)


def req_value(reqs, record_id, field_id):
    rec = reqs.get(str(record_id), {})
    value = rec.get(str(field_id), {}).get("value", "")
    return "" if value is None else str(value)


data_path, roles_path, menus_path = sys.argv[1], sys.argv[2], sys.argv[3]

data = load(data_path)
roles_resp = load(roles_path)
menus_resp = load(menus_path)

roles = roles_resp.get("object", [])
menus = menus_resp.get("object", [])
menu_reqs = menus_resp.get("reqs", {})

role_id_by_name = {r["val"]: str(r["id"]) for r in roles}

expected = []
for role_block in data.get("roles", []):
    role_name = role_block["role"]
    role_id = role_id_by_name.get(role_name)
    if not role_id:
        fail(f"Роль '{role_name}' не найдена в object/42")
    for menu in role_block.get("menus", []):
        expected.append({
            "role": role_name,
            "parent_id": role_id,
            "name": menu["name"],
            "href": menu.get("href", ""),
            "icon": menu.get("icon", ""),
            "params": menu.get("params", ""),
        })

records_by_parent_name = {}
for menu in menus:
    key = (str(menu["up"]), menu["val"])
    records_by_parent_name.setdefault(key, []).append(menu)

matched_ids = set()
for item in expected:
    key = (item["parent_id"], item["name"])
    matches = records_by_parent_name.get(key, [])
    if not matches:
        fail(
            "Нет пункта меню "
            f"'{item['name']}' для роли '{item['role']}' (up={item['parent_id']})"
        )
    if len(matches) > 1:
        ids = [m["id"] for m in matches]
        fail(f"Дубли пункта меню '{item['name']}' для роли '{item['role']}': {ids}")

    record = matches[0]
    record_id = str(record["id"])
    actual_href = req_value(menu_reqs, record_id, "153")
    actual_icon = req_value(menu_reqs, record_id, "391")
    actual_params = req_value(menu_reqs, record_id, "158")
    if actual_href != item["href"]:
        fail(
            f"Пункт '{item['name']}' роли '{item['role']}': href '{actual_href}', "
            f"ожидался '{item['href']}'"
        )
    if actual_icon != item["icon"]:
        fail(
            f"Пункт '{item['name']}' роли '{item['role']}': icon '{actual_icon}', "
            f"ожидался '{item['icon']}'"
        )
    if actual_params != item["params"]:
        fail(
            f"Пункт '{item['name']}' роли '{item['role']}': params '{actual_params}', "
            f"ожидался '{item['params']}'"
        )
    matched_ids.add(record_id)

if len(menus) != len(expected):
    extra = [
        {
            "id": m["id"],
            "up": m["up"],
            "name": m["val"],
            "href": req_value(menu_reqs, str(m["id"]), "153"),
        }
        for m in menus
        if str(m["id"]) not in matched_ids
    ]
    fail(
        f"Количество пунктов меню не совпадает: ожидалось {len(expected)}, "
        f"получено {len(menus)}. Лишние: {extra}"
    )

print(f"✓ Пункты меню atex: {len(expected)} шт, href/icon/params совпадают, дублей нет")
