#!/usr/bin/env python3
"""Check Windows PowerShell scripts can be parsed with non-ASCII text."""

from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
UTF8_BOM = b"\xef\xbb\xbf"


def has_non_ascii(data: bytes) -> bool:
    return any(byte >= 0x80 for byte in data)


def main() -> int:
    errors = []

    for path in sorted((REPO_ROOT / "docs").glob("*.ps1")):
        data = path.read_bytes()
        if has_non_ascii(data) and not data.startswith(UTF8_BOM):
            errors.append(path.relative_to(REPO_ROOT))

    if errors:
        print("PowerShell encoding check failed:")
        for path in errors:
            print(f"- {path}: add a UTF-8 BOM for Windows PowerShell 5.1")
        return 1

    print("PowerShell encoding check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
