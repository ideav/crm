#!/usr/bin/env python3
# Проверка #2904: роли и пользователи atex созданы корректно и без дублей.
#
# Сверяет восстановленные из мока записи таблиц 42 (Роль) и 18 (Пользователь) с
# исходным файлом docs/atex_roles_users.json:
#   * множество имён ролей совпадает, дублей нет;
#   * множество логинов пользователей совпадает, дублей нет;
#   * у каждого пользователя поле t115 ссылается на роль с правильным именем.
#
# Использование:
#   test-issue-2904-verify-roles-users.py <atex_roles_users.json> \
#       <object_42.json> <object_18.json> [user_role_field]
import json, sys

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def fail(msg):
    print(f"\n✗ {msg}")
    sys.exit(1)

data_path, roles_path, users_path = sys.argv[1], sys.argv[2], sys.argv[3]
role_field = sys.argv[4] if len(sys.argv) > 4 else "115"

data = load(data_path)
roles_resp = load(roles_path)
users_resp = load(users_path)

expected_roles = [r["name"] for r in data["roles"]]
expected_users = {u["login"]: u["role"] for u in data["users"]}

role_records = roles_resp.get("object", [])
user_records = users_resp.get("object", [])
user_reqs = users_resp.get("reqs", {})

# --- Роли ---
role_names = [r["val"] for r in role_records]
if sorted(role_names) != sorted(expected_roles):
    fail(f"Роли не совпадают.\n  ожидалось: {sorted(expected_roles)}\n  получено:  {sorted(role_names)}")
if len(role_names) != len(set(role_names)):
    fail(f"Дубли ролей: {role_names}")
print(f"✓ Роли: {len(role_names)} шт, без дублей — {sorted(role_names)}")

# id роли -> имя (для проверки ссылок пользователей)
role_name_by_id = {str(r["id"]): r["val"] for r in role_records}

# --- Пользователи ---
logins = [u["val"] for u in user_records]
if sorted(logins) != sorted(expected_users.keys()):
    fail(f"Логины не совпадают.\n  ожидалось: {sorted(expected_users)}\n  получено:  {sorted(logins)}")
if len(logins) != len(set(logins)):
    fail(f"Дубли пользователей: {logins}")
print(f"✓ Пользователи: {len(logins)} шт, без дублей — {sorted(logins)}")

# --- Ссылка пользователь -> роль ---
for u in user_records:
    login = u["val"]
    reqs = user_reqs.get(str(u["id"]), {})
    if role_field not in reqs:
        fail(f"У пользователя '{login}' нет поля роли t{role_field}")
    role_id = str(reqs[role_field]["value"])
    actual_role = role_name_by_id.get(role_id)
    expected_role = expected_users[login]
    if actual_role != expected_role:
        fail(f"Пользователь '{login}': роль '{actual_role}' (id {role_id}), ожидалась '{expected_role}'")
print(f"✓ Связи пользователь→роль (t{role_field}) корректны для всех {len(user_records)} пользователей")

print("\n✓ Роли и пользователи atex созданы согласно спецификации.")
