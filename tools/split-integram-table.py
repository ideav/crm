#!/usr/bin/env python3
"""One-time script: split js/integram-table.js into modules in js/integram-table/."""

import os

# Always run from project root regardless of working directory
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SRC = 'js/integram-table.js'
OUT_DIR = 'js/integram-table'

# (name, start_line, end_line) — 1-indexed, inclusive
MODULES = [
    ('00-class-open',          1,     16),
    ('01-core',                17,    788),
    ('02-format-helpers',      789,   1146),
    ('03-filters-core',        1147,  1247),
    ('04-render-table',        1248,  1628),
    ('05-date-utils',          1629,  1755),
    ('06-render-cell',         1756,  3072),
    ('07-inline-edit',         3073,  5723),
    ('08-navigation',          5724,  5851),
    ('09-scroll-layout',       5852,  6083),
    ('10-filter-ui',           6084,  6258),
    ('11-column-settings',     6259,  7555),
    ('12-table-settings',      7556,  7855),
    ('13-grouping',            7856,  8203),
    ('14-url-config',          8204,  8855),
    ('15-sort',                8856,  8888),
    ('16-state',               8889,  9535),
    ('17-ref-filter',          9536,  9842),
    ('18-data-source',         9843,  10122),
    ('19-form-edit',           10123, 11711),
    ('20-form-create',         11712, 13204),
    ('21-form-field-settings', 13205, 14180),
    ('22-utils',               14181, 14646),
    ('23-bulk-export',         14647, 15340),
    ('24-global-functions',    15341, 15505),
    ('25-create-form-helper',  15506, 17805),
]

def main():
    with open(SRC, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    total = len(lines)
    print(f'Source: {SRC} — {total} lines')

    os.makedirs(OUT_DIR, exist_ok=True)

    covered = 0
    for name, start, end in MODULES:
        path = os.path.join(OUT_DIR, f'{name}.js')
        chunk = lines[start - 1:end]   # convert 1-indexed to 0-indexed
        with open(path, 'w', encoding='utf-8') as f:
            f.writelines(chunk)
        covered += len(chunk)
        print(f'  {path}: {len(chunk)} lines  (L{start}–L{end})')

    print(f'\nTotal lines written: {covered}')
    if covered != total:
        print(f'ERROR: {total - covered} lines not covered! Check MODULES config.')
        raise SystemExit(1)
    else:
        print('OK: all lines covered')

if __name__ == '__main__':
    main()
