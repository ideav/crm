#!/usr/bin/env python3
"""issue #3623 — выдать роли «Оператор» право READ на справочник «Лидер».

Симптом: в пульте слиттера метрика «Лидер» всегда пустая. Причина: «Лидер» —
ссылочный реквизит резки (82519 → справочник «Лидер», 1132). Роль «Оператор»
читает резку напрямую (`object/Задание в производство`), но справочник «Лидер»
(1132) ей не выдан, поэтому сервер не резолвит метку ссылки и колонка приходит
пустой (см. docs/integram-app-workflow.md §5.9.1: «Новый объект по умолчанию
недоступен ролям… ссылочное значение в таблицах не отобразится»).

Фикс — одна запись прав: роль «Оператор» получает READ на справочник «Лидер»,
как уже выдано для «Слиттер», «Партия сырья», «Вид сырья» и др.

Скрипт идемпотентный: если право уже есть — ничего не пишет.

Запуск:
    INTEGRAM_TOKEN=<token> python3 experiments/seed-issue-3623-operator-leader-grant.py
    python3 experiments/seed-issue-3623-operator-leader-grant.py --token-file tok.txt --dry-run
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE_URL = "https://ideav.ru"
DB = "ateh"

ROLE_NAME = "Оператор"      # таблица «Роль» (42)
LEADER_NAME = "Лидер"       # справочник «Лидер» (1132)
ACCESS_READ = "53"          # справочник «Доступ» (47): 52=BARRED, 53=READ, 54=WRITE
GRANT_TABLE = "116"         # таблица «Объекты» (гранты роли)


class ApiError(RuntimeError):
    pass


class IntegramApi:
    def __init__(self, token: str, *, dry_run: bool) -> None:
        self.token = token
        self.dry_run = dry_run
        self._xsrf: str | None = None

    @property
    def root(self) -> str:
        return f"{BASE_URL}/{DB}"

    def _headers(self) -> dict[str, str]:
        return {
            "X-Authorization": self.token,
            "Cookie": f"idb_{DB}={self.token}",
            "Accept-Encoding": "gzip",
        }

    def _request(self, req: urllib.request.Request) -> Any:
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
        except urllib.error.HTTPError as exc:
            raise ApiError(f"{exc.code} {req.full_url}: {exc.read()[:400]!r}") from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"{req.full_url}: {exc}") from exc
        text = raw.decode("utf-8", errors="replace")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ApiError(f"non-JSON from {req.full_url}: {text[:300]}") from exc

    def get(self, endpoint: str) -> Any:
        return self._request(urllib.request.Request(f"{self.root}/{endpoint}", headers=self._headers()))

    def xsrf(self) -> str:
        if self._xsrf is None:
            self._xsrf = str(self.get("xsrf?JSON")["_xsrf"])
        return self._xsrf

    def post(self, endpoint: str, form: dict[str, str]) -> Any:
        if self.dry_run:
            return {"dry_run": True, "form": form}
        payload = dict(form, token=self.token, _xsrf=self.xsrf())
        headers = self._headers()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = urllib.parse.urlencode(payload).encode("utf-8")
        return self._request(urllib.request.Request(f"{self.root}/{endpoint}", data=body, headers=headers, method="POST"))


def first_id_by_name(rows: list[dict[str, Any]], name: str) -> str | None:
    for rec in rows:
        if (rec.get("r") or [""])[0] == name:
            return str(rec["i"])
    return None


def resolve_table_id(api: IntegramApi, table_name: str) -> str:
    for item in api.get("metadata?JSON"):
        if str(item.get("val")) == table_name and str(item.get("up")) == "0":
            return str(item["id"])
    raise ApiError(f"Таблица/справочник {table_name!r} не найдена в metadata")


def ref_id(value: Any) -> str:
    """'1132:Лидер' -> '1132'; '1132' -> '1132'."""
    return str(value).split(":", 1)[0]


def run(token: str, dry_run: bool) -> int:
    api = IntegramApi(token, dry_run=dry_run)

    role_id = first_id_by_name(api.get(f"object/42/?JSON_OBJ&LIMIT=0,200"), ROLE_NAME)
    if not role_id:
        raise ApiError(f"Роль {ROLE_NAME!r} не найдена")
    leader_id = resolve_table_id(api, LEADER_NAME)
    print(f"Роль {ROLE_NAME} = {role_id}; справочник {LEADER_NAME} = {leader_id}")

    grants = api.get(f"object/{GRANT_TABLE}/?JSON_OBJ&F_U={role_id}&LIMIT=0,500")
    existing = next((g for g in grants if ref_id((g.get("r") or [""])[0]) == leader_id), None)
    if existing:
        acc = (existing.get("r") or ["", ""])[1]
        print(f"✓ Право уже есть: грант i={existing['i']} {LEADER_NAME} → {acc}. Ничего не делаю.")
        return 0

    print(f"→ Выдаю роли {ROLE_NAME} READ на {LEADER_NAME} (up={role_id}, t116={leader_id}, t136={ACCESS_READ})")
    res = api.post(
        f"_m_new/{GRANT_TABLE}?JSON=1",
        {"up": role_id, "t116": leader_id, "t136": ACCESS_READ},
    )
    print("Результат:", json.dumps(res, ensure_ascii=False))
    if not dry_run and not res.get("obj"):
        raise ApiError(f"Грант не создан: {res}")
    return 0


def read_token(args: argparse.Namespace) -> str:
    if args.token_file:
        return open(args.token_file, encoding="utf-8").read().strip()
    token = os.environ.get("INTEGRAM_TOKEN", "").strip()
    if not token:
        raise SystemExit("Передайте --token-file или задайте INTEGRAM_TOKEN")
    return token


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    return run(read_token(args), args.dry_run)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
