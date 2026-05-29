#!/usr/bin/env python3
"""Structurally compare reconstructed metadata against the input metadata.

Comparison is id-agnostic: tables match by name, references/arrays by the
NAME of their target table, attrs by parsed flags. Numeric defaults on
reference columns are expected to be dropped (record ids absent in a fresh DB).
"""
import json
import re
import sys


def parse_attrs(attrs):
    """Port of FieldAttrsParse: returns {required, multi, key, alias, default}."""
    res = {"required": False, "multi": False, "key": False, "alias": None, "default": ""}
    if not attrs:
        return res
    s = attrs.strip()
    if s.startswith("{"):
        try:
            j = json.loads(s)
            for k, v in j.items():
                if k in ("required", "notNull", "not_null"):
                    res["required"] = bool(v)
                elif k == "multi":
                    res["multi"] = bool(v)
                elif k == "key":
                    res["key"] = bool(v)
                elif k == "alias":
                    res["alias"] = v
                elif k in ("default", "defaultValue"):
                    res["default"] = str(v)
            return res
        except json.JSONDecodeError:
            pass
    res["required"] = ":!NULL:" in attrs
    res["multi"] = ":MULTI:" in attrs
    res["key"] = ":KEY:" in attrs
    m = re.search(r":ALIAS=(.*?):", attrs)
    if m:
        res["alias"] = m.group(1)
    default = re.sub(r":ALIAS=(.*?):", "", attrs)
    default = default.replace(":KEY:", "").replace(":MULTI:", "").replace(":!NULL:", "")
    res["default"] = default
    return res


def index_by_id(tables):
    return {str(t["id"]): t for t in tables}


def normalize_table(t, by_id):
    """Return a name-keyed dict of normalized reqs for one table."""
    reqs = {}
    for r in t.get("reqs", []):
        kind = "simple"
        target = None
        if str(r.get("type")) == "1":
            kind = "freelink"
        elif "ref" in r:
            kind = "ref"
            target = by_id.get(str(r["ref"]), {}).get("val", "?" + str(r["ref"]))
        elif "arr_id" in r:
            kind = "arr"
            target = by_id.get(str(r["arr_id"]), {}).get("val", "?" + str(r["arr_id"]))
        reqs[r["val"]] = {
            "kind": kind,
            "num": r["num"],
            "type": str(r.get("type")),
            "target": target,
            "attrs": parse_attrs(r.get("attrs", "")),
        }
    return reqs


def compare(expected_file, actual_file):
    expected = json.load(open(expected_file, encoding="utf-8"))
    actual = json.load(open(actual_file, encoding="utf-8"))
    exp_by_id = index_by_id(expected)
    act_by_id = index_by_id(actual)
    exp_by_name = {t["val"]: t for t in expected}
    act_by_name = {t["val"]: t for t in actual}

    errors = []
    warnings = []

    # 1. Same set of tables (by name).
    exp_names = set(exp_by_name)
    act_names = set(act_by_name)
    for missing in sorted(exp_names - act_names):
        errors.append(f"TABLE MISSING in reconstruction: '{missing}'")
    for extra in sorted(act_names - exp_names):
        errors.append(f"UNEXPECTED extra table in reconstruction: '{extra}'")

    # 2. Per-table comparison.
    for name in sorted(exp_names & act_names):
        et, at = exp_by_name[name], act_by_name[name]
        if str(et["type"]) != str(at["type"]):
            errors.append(f"[{name}] base type {et['type']} != {at['type']}")
        if str(et.get("unique", "0")) != str(at.get("unique", "0")):
            errors.append(f"[{name}] unique {et.get('unique')} != {at.get('unique')}")

        er = normalize_table(et, exp_by_id)
        ar = normalize_table(at, act_by_id)
        for col in er:
            if col not in ar:
                errors.append(f"[{name}] column MISSING: '{col}'")
                continue
            e, a = er[col], ar[col]
            if e["kind"] != a["kind"]:
                errors.append(f"[{name}.{col}] kind {e['kind']} != {a['kind']}")
            if e["type"] != a["type"]:
                errors.append(f"[{name}.{col}] type {e['type']} != {a['type']}")
            if e["target"] != a["target"]:
                errors.append(f"[{name}.{col}] target {e['target']!r} != {a['target']!r}")
            # attrs
            ea, aa = e["attrs"], a["attrs"]
            for flag in ("required", "multi", "key"):
                if ea[flag] != aa[flag]:
                    errors.append(f"[{name}.{col}] attr {flag} {ea[flag]} != {aa[flag]}")
            if (ea["alias"] or "") != (aa["alias"] or ""):
                errors.append(f"[{name}.{col}] alias {ea['alias']!r} != {aa['alias']!r}")
            if ea["default"] != aa["default"]:
                # numeric default on a ref column is intentionally dropped
                if e["kind"] == "ref" and re.fullmatch(r"\d+", ea["default"] or "") and not aa["default"]:
                    warnings.append(f"[{name}.{col}] dropped record-id default '{ea['default']}' (expected on fresh DB)")
                else:
                    errors.append(f"[{name}.{col}] default {ea['default']!r} != {aa['default']!r}")
        for col in ar:
            if col not in er:
                errors.append(f"[{name}] unexpected extra column: '{col}'")

    print(f"Expected tables: {len(expected)}  Reconstructed tables: {len(actual)}")
    if warnings:
        print(f"\n{len(warnings)} expected difference(s):")
        for w in warnings:
            print("  ~", w)
    if errors:
        print(f"\n{len(errors)} ERROR(S):")
        for e in errors:
            print("  ✗", e)
        return 1
    print("\n✓ Structural match: every table, column, reference, array and attribute reproduced.")
    return 0


if __name__ == "__main__":
    sys.exit(compare(sys.argv[1], sys.argv[2]))
