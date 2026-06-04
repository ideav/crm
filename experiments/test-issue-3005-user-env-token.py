#!/usr/bin/env python3
"""Regression check for issue #3005: bootstrap scripts must read persisted
PowerShell user-scope tokens.

In PowerShell, this command writes the User environment variable but does not
update the current process' `$env:` drive:

  [Environment]::SetEnvironmentVariable("INTEGRAM_TOKEN", "...", "User")

The bootstrap scripts must therefore resolve INTEGRAM_TOKEN from Process,
User, then Machine scopes instead of relying only on `$env:INTEGRAM_TOKEN`.

Run with:
  python3 experiments/test-issue-3005-user-env-token.py
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


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


for path in POWERSHELL_SCRIPTS:
    rel = path.relative_to(ROOT)
    text = read(path)

    if "function Get-IntegramEnvironmentValue" not in text:
        fail(f"{rel} has no shared resolver for Process/User/Machine env values")

    for target in ("Process", "User", "Machine"):
        marker = f"[System.EnvironmentVariableTarget]::{target}"
        if marker not in text:
            fail(f"{rel} does not read the {target} environment scope")

    token_pattern = r'Get-IntegramEnvironmentValue\s+-Name\s+"INTEGRAM_TOKEN"'
    if not re.search(token_pattern, text):
        fail(f"{rel} does not resolve INTEGRAM_TOKEN through the env-scope helper")

    xsrf_pattern = r'Get-IntegramEnvironmentValue\s+-Name\s+"INTEGRAM_XSRF"'
    if not re.search(xsrf_pattern, text):
        fail(f"{rel} does not resolve INTEGRAM_XSRF through the env-scope helper")

    # The lookup order matters: current process values must win, then persisted
    # user values like issue #3005's command, then machine defaults.
    positions = []
    for target in ("Process", "User", "Machine"):
        marker = f"[System.EnvironmentVariableTarget]::{target}"
        positions.append(text.index(marker))
    if positions != sorted(positions):
        fail(f"{rel} resolves environment scopes in the wrong order")


workflow = read(ROOT / "docs" / "integram-app-workflow.md")
if '[Environment]::SetEnvironmentVariable("INTEGRAM_TOKEN"' not in workflow:
    fail("docs/integram-app-workflow.md does not document persisted PowerShell token setup")
if "Process, User, Machine" not in workflow:
    fail("docs/integram-app-workflow.md does not document env-scope lookup order")

print("PASS: bootstrap scripts read INTEGRAM_TOKEN from Process, User, then Machine scopes")
