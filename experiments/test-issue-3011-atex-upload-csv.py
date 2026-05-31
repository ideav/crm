#!/usr/bin/env python3
"""Validate atex CSV dictionaries prepared for templates/upload.html."""

from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSV_DIR = ROOT / "docs" / "atex_upload_csv"

EXPECTED = {
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


def read_csv(name: str) -> list[dict[str, str]]:
    path = CSV_DIR / name
    if not path.exists():
        raise AssertionError(f"Missing CSV file: {path.relative_to(ROOT)}")
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != EXPECTED[name]:
            raise AssertionError(f"{name}: header {reader.fieldnames!r} != {EXPECTED[name]!r}")
        return list(reader)


def assert_unique(rows: list[dict[str, str]], key: str, label: str) -> None:
    seen: set[str] = set()
    dupes: set[str] = set()
    for row in rows:
        value = row[key].strip()
        if not value:
            raise AssertionError(f"{label}: empty {key!r} value")
        if value in seen:
            dupes.add(value)
        seen.add(value)
    if dupes:
        raise AssertionError(f"{label}: duplicate {key!r} values: {sorted(dupes)[:10]}")


def assert_number(value: str, context: str, *, allow_empty: bool = False) -> None:
    text = value.strip()
    if allow_empty and text == "":
        return
    try:
        float(text)
    except ValueError as exc:
        raise AssertionError(f"{context}: not a number: {value!r}") from exc


def main() -> None:
    if not CSV_DIR.exists():
        raise AssertionError(f"Missing CSV directory: {CSV_DIR.relative_to(ROOT)}")

    rows = {name: read_csv(name) for name in EXPECTED}

    materials = rows["100-vid-syrya.csv"]
    slitters = rows["101-slitter.csv"]
    cutters = rows["102-vtulkorez.csv"]
    cut_types = rows["104-tip-rezki.csv"]
    strips = rows["105-polosa.csv"]
    batches = rows["106-partiya-syrya.csv"]

    assert_unique(materials, "Вид сырья", "materials")
    assert_unique(cut_types, "Тип резки", "cut types")
    assert_unique(slitters, "Слиттер", "slitters")
    assert_unique(cutters, "Втулкорез", "tube cutters")
    assert_unique(batches, "Партия сырья", "raw batches")

    if len(materials) < 38:
        raise AssertionError(f"materials: expected at least 38 rows, got {len(materials)}")
    if len(cut_types) < 490:
        raise AssertionError(f"cut types: expected at least 490 rows, got {len(cut_types)}")
    if len(strips) < 600:
        raise AssertionError(f"strips: expected at least 600 rows, got {len(strips)}")
    if len(slitters) != 4:
        raise AssertionError(f"slitters: expected 4 rows, got {len(slitters)}")
    if len(cutters) != 3:
        raise AssertionError(f"tube cutters: expected 3 rows, got {len(cutters)}")

    material_names = {row["Вид сырья"] for row in materials}
    cut_type_names = {row["Тип резки"] for row in cut_types}

    for row in cut_types:
        if row["Вид сырья"] not in material_names:
            raise AssertionError(f"cut type {row['Тип резки']!r} references missing material {row['Вид сырья']!r}")
        assert_number(row["Ширина входа, мм"], f"cut type {row['Тип резки']}: input width")
        assert_number(row["Итого ножей"], f"cut type {row['Тип резки']}: total knives")
        assert_number(row["Остаток, мм"], f"cut type {row['Тип резки']}: remainder")

    for row in strips:
        if row["Тип резки"] not in cut_type_names:
            raise AssertionError(f"strip references missing cut type {row['Тип резки']!r}")
        assert_number(row["Полоса"], f"strip {row['Тип резки']}: index")
        assert_number(row["Ширина, мм"], f"strip {row['Тип резки']}: width")
        assert_number(row["Количество"], f"strip {row['Тип резки']}: quantity")
        if row["Назначение"] not in {"Заказ", "Склад", "Отходы"}:
            raise AssertionError(f"strip {row['Тип резки']}: unexpected purpose {row['Назначение']!r}")

    for row in batches:
        if row["Вид сырья"] not in material_names:
            raise AssertionError(f"batch {row['Партия сырья']!r} references missing material {row['Вид сырья']!r}")
        assert_number(row["Получено, м²"], f"batch {row['Партия сырья']}: received")
        assert_number(row["Остаток, м²"], f"batch {row['Партия сырья']}: remainder")

    if not any(row["Ширина, мм"] == "32.5" for row in strips):
        raise AssertionError("strips: expected at least one decimal width from the source files")

    print(
        "validated "
        f"{len(materials)} materials, {len(cut_types)} cut types, "
        f"{len(strips)} strips, {len(batches)} raw batches"
    )


if __name__ == "__main__":
    main()
