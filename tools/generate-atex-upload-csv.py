#!/usr/bin/env python3
"""Generate upload-ready atex CSV dictionaries from BRD source files.

The source files live in the separate ideav/atex repository. This script expects
the `brd/` directory from that repo and writes CSV files that can be loaded with
`templates/upload.html`.
"""

from __future__ import annotations

import argparse
import csv
import re
import statistics
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from zipfile import ZipFile


XLSX_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = {"pr": "http://schemas.openxmlformats.org/package/2006/relationships"}

CYRILLIC_V = "\u0412"
STRIP_RE = re.compile(r"([0-9]+(?:[,.][0-9]+)?)\s*мм\s*х\s*([0-9]+)", re.IGNORECASE)
DIMENSION_RE = re.compile(r"([0-9]+(?:[,.][0-9]+)?)\s*[хx×]\s*([0-9]+(?:[,.][0-9]+)?)", re.IGNORECASE)


@dataclass
class MaterialInfo:
    code: str
    full_name: str = ""
    article: str = ""
    unit: str = ""
    source: str = ""
    inventory_full_name: str = ""
    inventory_unit: str = ""
    inventory_score: int = 0


@dataclass
class InventoryRow:
    source_code: str
    code: str
    full_name: str
    unit: str
    stock: str
    free: str
    score: int


@dataclass
class PlanMaterialStats:
    rows: int = 0
    types: Counter[str] = field(default_factory=Counter)
    per_cut_minutes: list[float] = field(default_factory=list)
    setup_minutes: list[float] = field(default_factory=list)


@dataclass
class PlanCutStats:
    rows: int = 0
    per_cut_minutes: list[float] = field(default_factory=list)
    setup_minutes: list[float] = field(default_factory=list)


@dataclass
class CuttingGroup:
    material: str
    name: str
    input_widths: Counter[str] = field(default_factory=Counter)
    intervals: Counter[str] = field(default_factory=Counter)
    source_widths: Counter[str] = field(default_factory=Counter)
    comments: Counter[str] = field(default_factory=Counter)
    lines: list[int] = field(default_factory=list)


def normalize_space(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def normalize_code(value: object) -> str:
    text = normalize_space(value)
    return text.replace("M" + CYRILLIC_V, "MB")


def normalize_cut_key(value: object) -> str:
    return normalize_space(value).strip(" /")


def split_codes(value: object) -> list[str]:
    codes = [normalize_code(part) for part in str(value or "").split(",")]
    return [code for code in codes if code and code != "#N/A"]


def parse_float(value: object) -> float | None:
    text = normalize_space(value)
    if not text or text.startswith("#"):
        return None
    text = text.replace(" ", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def format_number(value: object, places: int = 3) -> str:
    number = parse_float(value)
    if number is None:
        return ""
    rounded = round(number, places)
    if abs(rounded) < 10 ** (-(places + 1)):
        rounded = 0
    text = f"{rounded:.{places}f}".rstrip("0").rstrip(".")
    return text or "0"


def average(values: list[float]) -> str:
    if not values:
        return ""
    return format_number(statistics.fmean(values), 2)


def column_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref)
    if not match:
        return 0
    index = 0
    for char in match.group(1):
        index = index * 26 + ord(char) - 64
    return index


def shared_strings(zip_file: ZipFile) -> list[str]:
    try:
        root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    values = []
    for item in root.findall("a:si", XLSX_NS):
        values.append("".join(t.text or "" for t in item.findall(".//a:t", XLSX_NS)))
    return values


def workbook_sheets(zip_file: ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    rels = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pr:Relationship", REL_NS)
    }
    sheets = []
    for sheet in workbook.findall(".//a:sheet", XLSX_NS):
        rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        target = targets[rid]
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheets.append((sheet.attrib["name"], target))
    return sheets


def cell_value(cell: ET.Element, strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "s":
        value = cell.find("a:v", XLSX_NS)
        if value is None or value.text is None:
            return ""
        return strings[int(value.text)]
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in cell.findall(".//a:t", XLSX_NS))
    value = cell.find("a:v", XLSX_NS)
    return value.text if value is not None and value.text is not None else ""


def read_xlsx(path: Path) -> dict[str, list[list[str]]]:
    with ZipFile(path) as zip_file:
        strings = shared_strings(zip_file)
        result: dict[str, list[list[str]]] = {}
        for sheet_name, sheet_path in workbook_sheets(zip_file):
            root = ET.fromstring(zip_file.read(sheet_path))
            sheet_rows = []
            for row in root.findall(".//a:sheetData/a:row", XLSX_NS):
                cells: dict[int, str] = {}
                max_col = 0
                for cell in row.findall("a:c", XLSX_NS):
                    index = column_index(cell.attrib.get("r", ""))
                    if index <= 0:
                        continue
                    cells[index] = normalize_space(cell_value(cell, strings))
                    max_col = max(max_col, index)
                if cells:
                    sheet_rows.append([cells.get(i, "") for i in range(1, max_col + 1)])
            result[sheet_name] = sheet_rows
        return result


def row_value(row: list[str], index: int) -> str:
    return row[index] if index < len(row) else ""


def name_score(name: str) -> int:
    text = name.lower()
    if "jumbo" in text:
        return 3
    if any(token in text for token in ("wax", "resin", "foil", "термо", "фольга")):
        return 2
    return 0


def parse_dimensions(name: str) -> tuple[str, str]:
    match = DIMENSION_RE.search(name)
    if not match:
        return "", ""
    return format_number(match.group(1), 1), format_number(match.group(2), 1)


def read_materials_from_inventory(source_dir: Path) -> tuple[dict[str, MaterialInfo], dict[str, InventoryRow]]:
    workbook = read_xlsx(source_dir / "остатки сырья!.xlsx")
    info: dict[str, MaterialInfo] = {}

    article_rows = workbook["осататки на 24.01"]
    header_index = 0
    for index, row in enumerate(article_rows):
        if row_value(row, 0) == "Артикул" and row_value(row, 2) == "Наш Кросс":
            header_index = index
            break
    for row in article_rows[header_index + 1 :]:
        article = row_value(row, 0)
        full_name = row_value(row, 1)
        unit = row_value(row, 3)
        for code in split_codes(row_value(row, 2)):
            item = info.setdefault(code, MaterialInfo(code=code))
            if full_name and not item.full_name:
                item.full_name = full_name
            if article and not item.article:
                item.article = article
            if unit and not item.unit:
                item.unit = unit
            if full_name:
                item.source = "brd/остатки сырья!.xlsx: осататки на 24.01"

    inventory: dict[str, InventoryRow] = {}
    for row in workbook["TDSheet (2)"][1:]:
        source_code = normalize_code(row_value(row, 0))
        if not source_code or source_code == "#N/A":
            continue
        name = row_value(row, 1)
        full_name = row_value(row, 7) or name
        candidate_name = full_name if name_score(full_name) >= name_score(name) else name
        score = name_score(candidate_name)
        unit = row_value(row, 8)
        stock = row_value(row, 3)
        free = row_value(row, 6)
        for code in split_codes(source_code):
            current = inventory.get(code)
            if current is None or score > current.score:
                inventory[code] = InventoryRow(
                    source_code=source_code,
                    code=code,
                    full_name=candidate_name,
                    unit=unit,
                    stock=stock,
                    free=free,
                    score=score,
                )
            item = info.setdefault(code, MaterialInfo(code=code))
            if score > item.inventory_score:
                item.inventory_full_name = candidate_name
                item.inventory_unit = unit
                item.inventory_score = score
            if not item.full_name and score > 0:
                item.full_name = candidate_name
                item.source = "brd/остатки сырья!.xlsx: TDSheet (2)"
            if not item.unit and unit:
                item.unit = unit

    return info, inventory


def read_plan_stats(source_dir: Path) -> tuple[dict[str, PlanMaterialStats], dict[tuple[str, str], PlanCutStats]]:
    workbook = read_xlsx(source_dir / "План производства.xlsx")
    rows = workbook["Лист1"]
    header_index = 0
    for index, row in enumerate(rows):
        if "Заказ на производство" in row:
            header_index = index
            break
    headers = {name: index for index, name in enumerate(rows[header_index])}
    material_stats: dict[str, PlanMaterialStats] = defaultdict(PlanMaterialStats)
    cut_stats: dict[tuple[str, str], PlanCutStats] = defaultdict(PlanCutStats)

    for row in rows[header_index + 1 :]:
        material = normalize_code(row_value(row, headers["Сырьё"]))
        if not material:
            continue
        cut_name = normalize_cut_key(row_value(row, headers["Название Резки"]))
        material_type = row_value(row, headers["Тип сырья"])
        cut_count = parse_float(row_value(row, headers["Количество резок"])) or 0
        exec_time = parse_float(row_value(row, headers["Время Выполнения Резки"]))
        setup_time = parse_float(row_value(row, headers["Время Переналадок"]))

        mstats = material_stats[material]
        mstats.rows += 1
        if material_type:
            mstats.types[material_type] += 1
        if exec_time is not None and cut_count > 0:
            mstats.per_cut_minutes.append(exec_time / cut_count)
        if setup_time is not None and setup_time > 0:
            mstats.setup_minutes.append(setup_time)

        if cut_name:
            cstats = cut_stats[(material, cut_name)]
            cstats.rows += 1
            if exec_time is not None and cut_count > 0:
                cstats.per_cut_minutes.append(exec_time / cut_count)
            if setup_time is not None and setup_time > 0:
                cstats.setup_minutes.append(setup_time)

    return dict(material_stats), dict(cut_stats)


def read_cutting_groups(source_dir: Path) -> dict[tuple[str, str], CuttingGroup]:
    path = source_dir / "Типы резки.txt"
    groups: dict[tuple[str, str], CuttingGroup] = {}
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    for line_number, line in enumerate(lines[1:], start=2):
        parts = line.split("\t")
        parts += [""] * (6 - len(parts))
        input_width, interval, material, source_width, name, comment = [
            normalize_space(part) for part in parts[:6]
        ]
        material = normalize_code(material)
        name = normalize_cut_key(name)
        if not material or not name:
            continue
        key = (material, name)
        group = groups.setdefault(key, CuttingGroup(material=material, name=name))
        group.input_widths[input_width] += 1
        group.intervals[interval] += 1
        group.source_widths[format_number(source_width, 1) or source_width] += 1
        if comment:
            group.comments[comment] += 1
        group.lines.append(line_number)
    return groups


def parse_strips(name: str) -> list[tuple[float, int]]:
    strips = []
    for width, qty in STRIP_RE.findall(name):
        parsed_width = parse_float(width)
        if parsed_width is None:
            continue
        strips.append((parsed_width, int(qty)))
    return strips


def top_items(counter: Counter[str], limit: int = 3) -> str:
    return "; ".join(f"{name} ({count})" for name, count in counter.most_common(limit) if name)


def material_notes(
    code: str,
    info: MaterialInfo,
    cutting_groups: dict[tuple[str, str], CuttingGroup],
    plan_stats: dict[str, PlanMaterialStats],
) -> str:
    notes = []
    if info.source:
        notes.append(f"Источник названия: {info.source}")
    if info.article:
        notes.append(f"Артикул: {info.article}")
    if info.unit:
        notes.append(f"Ед. изм.: {info.unit}")
    cuts_count = sum(1 for material, _name in cutting_groups if material == code)
    if cuts_count:
        notes.append(f"Типов резки в brd/Типы резки.txt: {cuts_count}")
    stats = plan_stats.get(code)
    if stats:
        notes.append(f"Строк в brd/План производства.xlsx: {stats.rows}")
        material_type = top_items(stats.types, 2)
        if material_type:
            notes.append(f"Тип сырья из плана: {material_type}")
        per_cut = average(stats.per_cut_minutes)
        if per_cut:
            notes.append(f"Среднее время одной резки: {per_cut} мин")
        setup = average(stats.setup_minutes)
        if setup:
            notes.append(f"Средняя переналадка: {setup} мин")
    if not info.full_name or info.full_name == code:
        notes.append("Полное название не найдено в приложенных файлах; использован код.")
    if code == "Фольга горячего тиснения MB":
        notes.append("В План производства.xlsx один раз встречается вариант с кириллической В; нормализовано к MB.")
    return "; ".join(notes)


def build_material_rows(
    material_info: dict[str, MaterialInfo],
    inventory: dict[str, InventoryRow],
    cutting_groups: dict[tuple[str, str], CuttingGroup],
    plan_stats: dict[str, PlanMaterialStats],
) -> list[dict[str, str]]:
    material_codes = set(material_info) | {key[0] for key in cutting_groups} | set(plan_stats)
    rows = []
    for code in sorted(material_codes):
        info = material_info.setdefault(code, MaterialInfo(code=code))
        if not info.full_name:
            inv = inventory.get(code)
            if inv and inv.score > 0:
                info.full_name = inv.full_name
                info.source = "brd/остатки сырья!.xlsx: TDSheet (2)"
            else:
                info.full_name = code
        width, length = parse_dimensions(info.full_name)
        if not width:
            input_widths = Counter(
                width
                for (material, _name), group in cutting_groups.items()
                if material == code
                for width in group.input_widths
                if width
            )
            width = format_number(input_widths.most_common(1)[0][0], 1) if input_widths else ""
        rows.append(
            {
                "Вид сырья": code,
                "Полное название": info.full_name,
                "Ширина, мм": width,
                "Длина рулона, м": length,
                "Примечания": material_notes(code, info, cutting_groups, plan_stats),
            }
        )
    return rows


def cut_type_label(group: CuttingGroup) -> str:
    return f"{group.material} - {group.name}"


def cut_type_notes(group: CuttingGroup, plan_cut_stats: dict[tuple[str, str], PlanCutStats]) -> str:
    notes = ["Источник: brd/Типы резки.txt"]
    if len(group.lines) == 1:
        notes.append(f"Строка источника: {group.lines[0]}")
    else:
        notes.append(f"Строк источника: {len(group.lines)}")
    source_widths = ", ".join(width for width, _count in group.source_widths.most_common() if width)
    if source_widths:
        notes.append(f"Ширины заказа из источника: {source_widths}")
    intervals = ", ".join(interval for interval, _count in group.intervals.most_common() if interval)
    if intervals:
        notes.append(f"Допустимый интервал: {intervals}")
    comments = "; ".join(comment for comment, _count in group.comments.most_common() if comment)
    if comments:
        notes.append(f"Комментарий: {comments}")
    stats = plan_cut_stats.get((group.material, normalize_cut_key(group.name)))
    if stats:
        notes.append(f"Строк в План производства.xlsx: {stats.rows}")
        per_cut = average(stats.per_cut_minutes)
        if per_cut:
            notes.append(f"Среднее время одной резки: {per_cut} мин")
        setup = average(stats.setup_minutes)
        if setup:
            notes.append(f"Средняя переналадка: {setup} мин")
    return "; ".join(notes)


def build_cut_rows(
    cutting_groups: dict[tuple[str, str], CuttingGroup],
    plan_cut_stats: dict[tuple[str, str], PlanCutStats],
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[str]]:
    cut_rows = []
    strip_rows = []
    anomalies = []
    for key in sorted(cutting_groups):
        group = cutting_groups[key]
        input_width = group.input_widths.most_common(1)[0][0]
        input_width_number = parse_float(input_width) or 0
        strips = parse_strips(group.name)
        used_width = sum(width * qty for width, qty in strips)
        total_knives = sum(qty for _width, qty in strips)
        remainder = input_width_number - used_width
        if not strips:
            anomalies.append(f"{cut_type_label(group)}: не удалось разобрать полосы из названия '{group.name}'")
        elif remainder < -0.001 or remainder > 200:
            anomalies.append(
                f"{cut_type_label(group)}: ширина входа {format_number(input_width_number)}, "
                f"занято {format_number(used_width)}, остаток {format_number(remainder)}"
            )

        cut_rows.append(
            {
                "Тип резки": cut_type_label(group),
                "Вид сырья": group.material,
                "Ширина входа, мм": format_number(input_width_number, 1),
                "Допуск, мм": "",
                "Итого ножей": format_number(total_knives, 1),
                "Остаток, мм": format_number(remainder, 3),
                "Примечания": cut_type_notes(group, plan_cut_stats),
            }
        )
        for index, (width, qty) in enumerate(strips, start=1):
            strip_rows.append(
                {
                    "Тип резки": cut_type_label(group),
                    "Полоса": str(index),
                    "Ширина, мм": format_number(width, 3),
                    "Количество": str(qty),
                    "Назначение": "Заказ",
                }
            )
    return cut_rows, strip_rows, anomalies


def build_batch_rows(
    inventory: dict[str, InventoryRow],
    material_rows: list[dict[str, str]],
) -> list[dict[str, str]]:
    material_codes = {row["Вид сырья"] for row in material_rows}
    rows = []
    seen: set[str] = set()
    for code in sorted(inventory):
        inv = inventory[code]
        if code not in material_codes or inv.score < 2:
            continue
        quantity = parse_float(inv.free) if parse_float(inv.free) is not None else parse_float(inv.stock)
        if quantity is None or quantity <= 0:
            continue
        batch_code = code
        if "," in inv.source_code:
            batch_code = split_codes(inv.source_code)[0]
            if code != batch_code:
                continue
        batch_name = f"Начальный остаток {inv.source_code}"
        if batch_name in seen:
            continue
        seen.add(batch_name)
        rows.append(
            {
                "Партия сырья": batch_name,
                "Вид сырья": batch_code,
                "Штрих-код": "",
                "Дата прихода": "",
                "Получено, м²": format_number(quantity, 3),
                "Остаток, м²": format_number(quantity, 3),
            }
        )
    return rows


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=headers, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def write_readme(out_dir: Path, counts: dict[str, int]) -> None:
    readme = f"""# CSV для загрузки справочников atex

Источник данных: файлы из `ideav/atex/brd/`, приложенные к требованиям в issue #3011.

Файлы подготовлены для ручной загрузки через `templates/upload.html`: кодировка UTF-8,
первая строка содержит заголовок, разделитель — запятая. Заголовки совпадают с
названиями таблиц и реквизитов из `docs/atex_metadata.json`.

## Порядок загрузки

1. `100-vid-syrya.csv` -> таблица `Вид сырья` ({counts['materials']} строк).
2. `101-slitter.csv` -> таблица `Слиттер` ({counts['slitters']} строки).
3. `102-vtulkorez.csv` -> таблица `Втулкорез` ({counts['cutters']} строки).
4. `104-tip-rezki.csv` -> таблица `Тип резки` ({counts['cut_types']} строк).
5. `105-polosa.csv` -> таблица `Полоса` ({counts['strips']} строк). Это подчинённая
   таблица: в `templates/upload.html` нужно указать автородителя из первой колонки
   `Тип резки`; сами поля `Полоса`, `Ширина, мм`, `Количество`, `Назначение`
   идут следующими колонками.
6. `106-partiya-syrya.csv` -> таблица `Партия сырья` ({counts['batches']} строк).
   Это не справочник, а опциональные начальные остатки из `остатки сырья!.xlsx`.
   Штрих-код и дата прихода оставлены пустыми, потому что в источнике нет этих
   значений для начальных остатков.

## Правила подготовки

- `Тип резки` дедуплицирован по паре `Сырьё + Название Резки`: 681 строка
  источника превращается в {counts['cut_types']} уникальных конфигураций.
- Название типа резки сделано уникальным: `{{Вид сырья}} - {{Название Резки}}`.
- Дробные ширины сохранены с точкой, например `32.5`.
- Колонка `Допуск, мм` оставлена пустой: в источнике есть `Допустимый интервал`,
  но это не то же самое, что поле допуска в текущей схеме. Интервал перенесён в
  `Примечания`.
- В `Примечания` у сырья добавлены артикулы, типы сырья и среднее время резки из
  `План производства.xlsx`, когда эти данные есть в источнике.
"""
    (out_dir / "README.md").write_text(readme, encoding="utf-8")


def write_validation(out_dir: Path, anomalies: list[str], missing_full_names: list[str]) -> None:
    lines = [
        "# Проверка источников",
        "",
        "Этот файл фиксирует неоднозначности исходных BRD-файлов, которые не были исправлены вручную.",
        "",
        "## Аномальные суммы ширин",
        "",
    ]
    if anomalies:
        lines.extend(f"- {item}" for item in anomalies)
    else:
        lines.append("- Не найдено.")
    lines.extend(["", "## Материалы без полного названия", ""])
    if missing_full_names:
        lines.extend(f"- {item}" for item in missing_full_names)
    else:
        lines.append("- Не найдено.")
    lines.append("")
    (out_dir / "SOURCE_VALIDATION.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="Path to ideav/atex/brd")
    parser.add_argument("--out", type=Path, default=Path("docs/atex_upload_csv"))
    args = parser.parse_args()

    source_dir = args.source
    out_dir = args.out
    required = [
        "остатки сырья!.xlsx",
        "План производства.xlsx",
        "Типы резки.txt",
    ]
    missing = [name for name in required if not (source_dir / name).exists()]
    if missing:
        raise SystemExit(f"Missing source files in {source_dir}: {', '.join(missing)}")

    material_info, inventory = read_materials_from_inventory(source_dir)
    plan_stats, plan_cut_stats = read_plan_stats(source_dir)
    cutting_groups = read_cutting_groups(source_dir)

    material_rows = build_material_rows(material_info, inventory, cutting_groups, plan_stats)
    cut_rows, strip_rows, anomalies = build_cut_rows(cutting_groups, plan_cut_stats)
    batch_rows = build_batch_rows(inventory, material_rows)

    slitter_rows = [
        {
            "Слиттер": f"SL-0{number}",
            "Статус": "Доступен",
            "Примечания": (
                f"Источник: Bus Req Doc.txt и План производства.xlsx, станок {number}. "
                "Фольга планируется в конец дня; не ставится на SL-02 и SL-03."
                if number in (2, 3)
                else f"Источник: Bus Req Doc.txt и План производства.xlsx, станок {number}."
            ),
        }
        for number in range(1, 5)
    ]
    cutter_rows = [
        {"Втулкорез": "TC-20", "Диаметр, мм": "20", "Статус": "Доступен"},
        {"Втулкорез": "TC-40", "Диаметр, мм": "40", "Статус": "Доступен"},
        {"Втулкорез": "TC-76", "Диаметр, мм": "76", "Статус": "Доступен"},
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "100-vid-syrya.csv", ["Вид сырья", "Полное название", "Ширина, мм", "Длина рулона, м", "Примечания"], material_rows)
    write_csv(out_dir / "101-slitter.csv", ["Слиттер", "Статус", "Примечания"], slitter_rows)
    write_csv(out_dir / "102-vtulkorez.csv", ["Втулкорез", "Диаметр, мм", "Статус"], cutter_rows)
    write_csv(out_dir / "104-tip-rezki.csv", ["Тип резки", "Вид сырья", "Ширина входа, мм", "Допуск, мм", "Итого ножей", "Остаток, мм", "Примечания"], cut_rows)
    write_csv(out_dir / "105-polosa.csv", ["Тип резки", "Полоса", "Ширина, мм", "Количество", "Назначение"], strip_rows)
    write_csv(out_dir / "106-partiya-syrya.csv", ["Партия сырья", "Вид сырья", "Штрих-код", "Дата прихода", "Получено, м²", "Остаток, м²"], batch_rows)

    missing_full_names = sorted(
        row["Вид сырья"]
        for row in material_rows
        if "Полное название не найдено" in row["Примечания"]
    )
    counts = {
        "materials": len(material_rows),
        "slitters": len(slitter_rows),
        "cutters": len(cutter_rows),
        "cut_types": len(cut_rows),
        "strips": len(strip_rows),
        "batches": len(batch_rows),
    }
    write_readme(out_dir, counts)
    write_validation(out_dir, anomalies, missing_full_names)
    print(
        "Generated "
        f"{counts['materials']} materials, {counts['cut_types']} cut types, "
        f"{counts['strips']} strips, {counts['batches']} raw batches into {out_dir}"
    )


if __name__ == "__main__":
    main()
