#!/usr/bin/env python3
"""Seed the ateh Atex lookup dictionaries from docs/atex_upload_csv.

The script is intentionally idempotent: it reads current live records, creates
missing rows, and updates differing requisites without deleting existing data.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CSV_DIR = ROOT / "docs" / "atex_upload_csv"

EXPECTED_HEADERS = {
    "100-vid-syrya.csv": ["Вид сырья", "Полное название", "Ширина, мм", "Длина рулона, м", "Примечания"],
    "101-slitter.csv": ["Слиттер", "Статус", "Примечания"],
    "102-vtulkorez.csv": ["Втулкорез", "Диаметр, мм", "Статус"],
    "104-tip-rezki.csv": [
        "Тип резки",
        "Вид сырья",
        "Ширина входа, мм",
        "Допуск, мм",
        "Итого ножей",
        "Остаток, мм",
        "Примечания",
    ],
    "105-polosa.csv": ["Тип резки", "Полоса", "Ширина, мм", "Количество", "Назначение"],
    "106-partiya-syrya.csv": ["Партия сырья", "Вид сырья", "Дата прихода", "Получено, м²", "Остаток, м²"],
}

NUMERIC_FIELDS = {
    "Ширина, мм",
    "Длина рулона, м",
    "Диаметр, мм",
    "Ширина входа, мм",
    "Допуск, мм",
    "Итого ножей",
    "Остаток, мм",
    "Полоса",
    "Количество",
    "Получено, м²",
    "Остаток, м²",
}


@dataclass(frozen=True)
class Table:
    id: str
    name: str
    req_ids: dict[str, str]


@dataclass
class Stats:
    created: int = 0
    updated: int = 0
    unchanged: int = 0


class ApiError(RuntimeError):
    pass


class IntegramApi:
    def __init__(self, base_url: str, db: str, token: str, *, dry_run: bool) -> None:
        self.base_url = base_url.rstrip("/")
        self.db = db.strip("/")
        self.token = token
        self.dry_run = dry_run
        self._xsrf: str | None = None
        self._dry_seq = 900000

    @property
    def root(self) -> str:
        return f"{self.base_url}/{self.db}"

    def xsrf(self) -> str:
        if self._xsrf is None:
            data = self.get_json("xsrf?JSON=1")
            self._xsrf = str(data["_xsrf"])
        return self._xsrf

    def get_json(self, endpoint: str) -> Any:
        url = self._url(endpoint)
        req = urllib.request.Request(url, headers=self._headers(), method="GET")
        return self._request_json(req)

    def post_json(self, endpoint: str, form: dict[str, str]) -> dict[str, Any]:
        if self.dry_run:
            self._dry_seq += 1
            return {"obj": str(self._dry_seq), "dry_run": True}

        payload = dict(form)
        payload["token"] = self.token
        payload["_xsrf"] = self.xsrf()
        body = urllib.parse.urlencode(payload).encode("utf-8")
        headers = self._headers()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(self._url(endpoint), data=body, headers=headers, method="POST")
        return self._request_json(req)

    def _url(self, endpoint: str) -> str:
        sep = "&" if "?" in endpoint else "?"
        if "JSON" not in endpoint:
            endpoint = f"{endpoint}{sep}JSON=1"
        return f"{self.root}/{endpoint.lstrip('/')}"

    def _headers(self) -> dict[str, str]:
        return {
            "X-Authorization": self.token,
            "Cookie": f"idb_{self.db}={self.token}",
        }

    def _request_json(self, req: urllib.request.Request) -> Any:
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ApiError(f"{exc.code} {req.full_url}: {body[:500]}") from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"{req.full_url}: {exc}") from exc

        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            text = raw.decode("utf-8", errors="replace")
            raise ApiError(f"non-JSON response from {req.full_url}: {text[:500]}") from exc


def read_csv_file(name: str) -> list[dict[str, str]]:
    path = CSV_DIR / name
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        expected = EXPECTED_HEADERS[name]
        if reader.fieldnames != expected:
            raise RuntimeError(f"{path}: header {reader.fieldnames!r} != {expected!r}")
        return [{key: (value or "").strip() for key, value in row.items()} for row in reader]


def read_all_csv() -> dict[str, list[dict[str, str]]]:
    return {name: read_csv_file(name) for name in EXPECTED_HEADERS}


def discover_tables(api: IntegramApi) -> dict[str, Table]:
    metadata = api.get_json("metadata?JSON=1")
    wanted = {"Вид сырья", "Слиттер", "Втулкорез", "Тип резки", "Полоса", "Партия сырья"}
    tables: dict[str, Table] = {}
    for item in metadata:
        if str(item.get("up")) != "0":
            continue
        name = str(item.get("val", ""))
        if name not in wanted:
            continue
        req_ids = {str(req["val"]): str(req["id"]) for req in item.get("reqs", [])}
        tables[name] = Table(id=str(item["id"]), name=name, req_ids=req_ids)

    missing = wanted.difference(tables)
    if missing:
        raise RuntimeError(f"Live metadata is missing expected tables: {sorted(missing)}")
    return tables


def row_key(value: str) -> str:
    return " ".join(value.strip().split()).casefold()


def normalize_number(value: str) -> str:
    if value == "":
        return ""
    try:
        normalized = Decimal(value.replace(",", ".")).normalize()
    except InvalidOperation:
        return value
    return format(normalized, "f")


def values_equal(field_name: str, current: str, desired: str, *, ref_id: str | None = None) -> bool:
    current = current.strip()
    desired = desired.strip()
    if ref_id is not None:
        return current.split(":", 1)[0] == ref_id
    if field_name in NUMERIC_FIELDS:
        return normalize_number(current) == normalize_number(desired)
    return current == desired


def load_records(api: IntegramApi, table: Table, *, parent_id: str | None = None) -> list[dict[str, Any]]:
    endpoint = f"object/{table.id}?JSON_DATA&LIMIT=10000"
    if parent_id is not None:
        endpoint += f"&F_U={urllib.parse.quote(parent_id)}"
    rows = api.get_json(endpoint)
    if not isinstance(rows, list):
        raise RuntimeError(f"Expected list from {endpoint}, got {type(rows).__name__}")
    return rows


def count_records(api: IntegramApi, table: Table) -> int:
    data = api.get_json(f"object/{table.id}?_count=&JSON=1")
    return int(data["count"])


def records_by_key(api: IntegramApi, table: Table) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for row in load_records(api, table):
        values = row.get("r", [])
        if not values:
            continue
        records.setdefault(row_key(str(values[0])), row)
    return records


def find_record_by_key(api: IntegramApi, table: Table, key_value: str) -> dict[str, Any] | None:
    params = urllib.parse.urlencode(
        {
            "JSON_DATA": "1",
            "LIMIT": "2",
            f"F_{table.id}": key_value,
        }
    )
    rows = api.get_json(f"object/{table.id}?{params}")
    for row in rows:
        values = row.get("r", [])
        if values and row_key(str(values[0])) == row_key(key_value):
            return row
    return None


def child_records_for_parent(api: IntegramApi, table: Table, parent_id: str) -> dict[tuple[str, str], dict[str, Any]]:
    records: dict[tuple[str, str], dict[str, Any]] = {}
    for row in load_records(api, table, parent_id=parent_id):
        values = row.get("r", [])
        if not values:
            continue
        records.setdefault((str(row["u"]), row_key(str(values[0]))), row)
    return records


def count_child_records_for_parents(api: IntegramApi, table: Table, parent_ids: set[str]) -> int:
    total = 0
    for parent_id in sorted(parent_ids, key=int):
        total += len(load_records(api, table, parent_id=parent_id))
    return total


def field_form(table: Table, values: dict[str, str], refs: dict[str, str] | None = None) -> dict[str, str]:
    form: dict[str, str] = {}
    refs = refs or {}
    for field_name, value in values.items():
        req_id = table.req_ids[field_name]
        form[f"t{req_id}"] = refs.get(field_name, value)
    return form


def diff_form(table: Table, row: dict[str, Any], values: dict[str, str], refs: dict[str, str] | None = None) -> dict[str, str]:
    refs = refs or {}
    current_values = [str(value) for value in row.get("r", [])]
    changed: dict[str, str] = {}
    field_names = list(values)
    for index, field_name in enumerate(field_names, start=1):
        current = current_values[index] if index < len(current_values) else ""
        desired = values[field_name]
        ref_id = refs.get(field_name)
        if not values_equal(field_name, current, desired, ref_id=ref_id):
            changed[f"t{table.req_ids[field_name]}"] = ref_id if ref_id is not None else desired
    return changed


def upsert_top_level(
    api: IntegramApi,
    table: Table,
    records: dict[str, dict[str, Any]],
    key_field: str,
    rows: list[dict[str, str]],
    value_fields: list[str],
    *,
    ref_resolver: Any = None,
    progress_label: str | None = None,
    progress_every: int = 100,
    lookup_by_filter: bool = False,
) -> tuple[Stats, dict[str, dict[str, Any]]]:
    stats = Stats()
    processed = 0
    for csv_row in rows:
        processed += 1
        key_value = csv_row[key_field]
        key = row_key(key_value)
        refs = ref_resolver(csv_row) if ref_resolver else {}
        values = {field: csv_row[field] for field in value_fields}
        existing = records.get(key)
        if existing is None and lookup_by_filter:
            existing = find_record_by_key(api, table, key_value)
            if existing is not None:
                records[key] = existing
        if existing is None:
            form = {f"t{table.id}": key_value, **field_form(table, values, refs)}
            resp = api.post_json(f"_m_new/{table.id}?JSON=1", {"up": "1", **form})
            obj_id = str(resp.get("obj") or resp.get("id") or "")
            if not obj_id:
                raise RuntimeError(f"Create {table.name}/{key_value} returned no object id: {resp}")
            records[key] = {"i": obj_id, "u": "1", "r": [key_value]}
            stats.created += 1
            if progress_label and processed % progress_every == 0:
                print(
                    f"{progress_label}: processed={processed}/{len(rows)} "
                    f"created={stats.created} updated={stats.updated} unchanged={stats.unchanged}",
                    flush=True,
                )
            continue

        changed = diff_form(table, existing, values, refs)
        if changed:
            api.post_json(f"_m_set/{existing['i']}?JSON=1", changed)
            stats.updated += 1
        else:
            stats.unchanged += 1
        if progress_label and processed % progress_every == 0:
            print(
                f"{progress_label}: processed={processed}/{len(rows)} "
                f"created={stats.created} updated={stats.updated} unchanged={stats.unchanged}",
                flush=True,
            )
    return stats, records


def upsert_strips(
    api: IntegramApi,
    strip_table: Table,
    cut_type_records: dict[str, dict[str, Any]],
    rows: list[dict[str, str]],
) -> Stats:
    stats = Stats()
    records: dict[tuple[str, str], dict[str, Any]] = {}
    loaded_parents: set[str] = set()
    value_fields = ["Ширина, мм", "Количество", "Назначение"]
    for processed, csv_row in enumerate(rows, start=1):
        parent = cut_type_records.get(row_key(csv_row["Тип резки"]))
        if parent is None:
            raise RuntimeError(f"Strip references missing cut type: {csv_row['Тип резки']}")
        parent_id = str(parent["i"])
        if parent_id not in loaded_parents:
            records.update(child_records_for_parent(api, strip_table, parent_id))
            loaded_parents.add(parent_id)
        key_value = csv_row["Полоса"]
        key = (parent_id, row_key(key_value))
        values = {field: csv_row[field] for field in value_fields}
        existing = records.get(key)
        if existing is None:
            form = {f"t{strip_table.id}": key_value, **field_form(strip_table, values)}
            resp = api.post_json(f"_m_new/{strip_table.id}?JSON=1", {"up": parent_id, **form})
            obj_id = str(resp.get("obj") or resp.get("id") or "")
            if not obj_id:
                raise RuntimeError(f"Create Полоса/{parent_id}/{key_value} returned no object id: {resp}")
            records[key] = {"i": obj_id, "u": parent_id, "r": [key_value]}
            stats.created += 1
            if processed % 100 == 0:
                print(
                    f"Полоса: processed={processed}/{len(rows)} "
                    f"created={stats.created} updated={stats.updated} unchanged={stats.unchanged}",
                    flush=True,
                )
            continue

        changed = diff_form(strip_table, existing, values)
        if changed:
            api.post_json(f"_m_set/{existing['i']}?JSON=1", changed)
            stats.updated += 1
        else:
            stats.unchanged += 1
        if processed % 100 == 0:
            print(
                f"Полоса: processed={processed}/{len(rows)} "
                f"created={stats.created} updated={stats.updated} unchanged={stats.unchanged}",
                flush=True,
            )
    return stats


def print_stats(title: str, stats: Stats) -> None:
    print(f"{title}: created={stats.created}, updated={stats.updated}, unchanged={stats.unchanged}", flush=True)


def run(args: argparse.Namespace) -> None:
    token = read_token(args)
    api = IntegramApi(args.base_url, args.db, token, dry_run=args.dry_run)
    csv_rows = read_all_csv()
    tables = discover_tables(api)

    material_table = tables["Вид сырья"]
    slitter_table = tables["Слиттер"]
    cutter_table = tables["Втулкорез"]
    cut_type_table = tables["Тип резки"]
    strip_table = tables["Полоса"]
    batch_table = tables["Партия сырья"]

    material_stats, material_records = upsert_top_level(
        api,
        material_table,
        records_by_key(api, material_table),
        "Вид сырья",
        csv_rows["100-vid-syrya.csv"],
        ["Полное название", "Ширина, мм", "Длина рулона, м", "Примечания"],
    )
    print_stats("Вид сырья", material_stats)

    slitter_stats, _ = upsert_top_level(
        api,
        slitter_table,
        records_by_key(api, slitter_table),
        "Слиттер",
        csv_rows["101-slitter.csv"],
        ["Статус", "Примечания"],
    )
    print_stats("Слиттер", slitter_stats)

    cutter_stats, _ = upsert_top_level(
        api,
        cutter_table,
        records_by_key(api, cutter_table),
        "Втулкорез",
        csv_rows["102-vtulkorez.csv"],
        ["Диаметр, мм", "Статус"],
    )
    print_stats("Втулкорез", cutter_stats)

    def material_ref(row: dict[str, str]) -> dict[str, str]:
        material = material_records.get(row_key(row["Вид сырья"]))
        if material is None:
            raise RuntimeError(f"Missing material: {row['Вид сырья']}")
        return {"Вид сырья": str(material["i"])}

    cut_type_stats, cut_type_records = upsert_top_level(
        api,
        cut_type_table,
        {},
        "Тип резки",
        csv_rows["104-tip-rezki.csv"],
        ["Вид сырья", "Ширина входа, мм", "Допуск, мм", "Итого ножей", "Остаток, мм", "Примечания"],
        ref_resolver=material_ref,
        progress_label="Тип резки",
        progress_every=25,
        lookup_by_filter=True,
    )
    print_stats("Тип резки", cut_type_stats)

    strip_stats = upsert_strips(api, strip_table, cut_type_records, csv_rows["105-polosa.csv"])
    print_stats("Полоса", strip_stats)

    batch_stats, _ = upsert_top_level(
        api,
        batch_table,
        records_by_key(api, batch_table),
        "Партия сырья",
        csv_rows["106-partiya-syrya.csv"],
        ["Вид сырья", "Дата прихода", "Получено, м²", "Остаток, м²"],
        ref_resolver=material_ref,
    )
    print_stats("Партия сырья", batch_stats)

    counts = {
        name: count_records(api, table)
        for name, table in (
            ("Вид сырья", material_table),
            ("Слиттер", slitter_table),
            ("Втулкорез", cutter_table),
            ("Тип резки", cut_type_table),
            ("Партия сырья", batch_table),
        )
    }
    counts["Полоса"] = count_child_records_for_parents(
        api,
        strip_table,
        {str(row["i"]) for row in cut_type_records.values()},
    )
    print("live counts:", json.dumps(counts, ensure_ascii=False, sort_keys=True))


def read_token(args: argparse.Namespace) -> str:
    if args.token_file:
        token = Path(args.token_file).read_text(encoding="utf-8").strip()
    else:
        token = os.environ.get("INTEGRAM_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Pass --token-file or set INTEGRAM_TOKEN")
    return token


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://ideav.ru")
    parser.add_argument("--db", default="ateh")
    parser.add_argument("--token-file")
    parser.add_argument("--dry-run", action="store_true", help="plan changes without POSTing writes")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    try:
        run(parse_args(argv))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
