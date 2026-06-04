#!/usr/bin/env python3
"""Regression check for issue #2998: bootstrap scripts must use token auth.

The Atex/Integram bootstrap scripts are run by automation. They must not call
POST /auth with login/password; they should accept a pre-issued token and get
_xsrf through /xsrf under that token.

Run with:
  python3 experiments/test-issue-2998-token-bootstrap.py
"""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]

POWERSHELL_SCRIPTS = [
    ROOT / "docs" / "create_db_from_scratch.ps1",
    ROOT / "docs" / "create_roles_users.ps1",
    ROOT / "docs" / "create_atex_menu.ps1",
    ROOT / "docs" / "create_perelidoz.ps1",
]

E2E_SCRIPTS = [
    ROOT / "experiments" / "test-issue-2899-create-db-from-scratch.sh",
    ROOT / "experiments" / "test-issue-2901-create-atex-db.sh",
    ROOT / "experiments" / "test-issue-2904-create-roles-users.sh",
    ROOT / "experiments" / "test-issue-2992-create-atex-menu.sh",
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


for path in POWERSHELL_SCRIPTS:
    rel = path.relative_to(ROOT)
    text = read(path)
    forbidden = [
        r"\[string\]\$Login\b",
        r"\[string\]\$Password\b",
        r"Endpoint\s+['\"]auth['\"]",
        r"login\s*=\s*\$Login",
        r"pwd\s*=\s*\$Password",
    ]
    for pattern in forbidden:
        if re.search(pattern, text):
            fail(f"{rel} still contains password-auth pattern: {pattern}")
    required = [
        "[string]$Token",
        "Get-XsrfByToken",
        "Initialize-TokenSession",
        "/xsrf",
    ]
    for needle in required:
        if needle not in text:
            fail(f"{rel} does not contain required token-auth marker: {needle}")

for path in E2E_SCRIPTS:
    rel = path.relative_to(ROOT)
    text = read(path)
    if "-Login" in text or "-Password" in text:
        fail(f"{rel} still passes login/password to a bootstrap script")
    if "-Token mock-token" not in text:
        fail(f"{rel} should pass -Token mock-token to the bootstrap script")

workflow = read(ROOT / "docs" / "integram-app-workflow.md")
if "POST /{db}/auth?JSON=1" in workflow:
    fail("docs/integram-app-workflow.md still instructs agents to call POST /auth")

print("PASS: bootstrap scripts and docs use token + /xsrf, not login/password auth")
