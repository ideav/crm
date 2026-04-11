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
    ('01-core',                17,    734),
    ('02-format-helpers',      735,   1076),
    ('03-filters-core',        1077,  1177),
    ('04-render-table',        1178,  1497),
    ('05-date-utils',          1498,  1624),
    ('06-render-cell',         1625,  2280),
    ('07-inline-edit',         2281,  4841),
    ('08-navigation',          4842,  4969),
    ('09-scroll-layout',       4970,  5176),
    ('10-filter-ui',           5177,  5351),
    ('11-column-settings',     5352,  6569),
    ('12-table-settings',      6570,  6818),
    ('13-grouping',            6819,  7130),
    ('14-url-config',          7131,  7805),
    ('15-sort',                7806,  7838),
    ('16-state',               7839,  8426),
    ('17-ref-filter',          8427,  8727),
    ('18-data-source',         8728,  8902),
    ('19-form-edit',           8903,  10042),
    ('20-form-create',         10043, 11405),
    ('21-form-field-settings', 11406, 12162),
    ('22-utils',               12163, 12627),
    ('23-bulk-export',         12628, 13299),
    ('24-global-functions',    13300, 13464),
    ('25-create-form-helper',  13465, 15701),
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
