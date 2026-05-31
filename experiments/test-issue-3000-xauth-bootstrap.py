#!/usr/bin/env python3
"""Regression check for issue #3000: bootstrap scripts must carry the token in
the X-Authorization header.

PR #2999 switched the PowerShell bootstrap scripts to token auth but delivered
the token only through a manually-set Cookie header on `Invoke-RestMethod`.
PowerShell drops that header, so the live Integram server answered
`401 [{"error":"No authorization token provided"}]` (see the issue log and the
live-server transport probe in atex#44).

The server only reads the token from the `X-Authorization` header, the
`idb_<db>` cookie, or the POST body `token=` field — never from an
`Authorization: Bearer` header or a `?token=` query string. The scripts must
therefore send the token in the `X-Authorization` header on every request.

Run with:
  python3 experiments/test-issue-3000-xauth-bootstrap.py
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

WORKFLOW_DOC = ROOT / "docs" / "integram-app-workflow.md"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


for path in POWERSHELL_SCRIPTS:
    rel = path.relative_to(ROOT)
    text = read(path)

    # The xsrf bootstrap GET must send the token via X-Authorization.
    if not re.search(r'"X-Authorization"\s*=\s*\$TokenValue', text):
        fail(f"{rel} does not send the token via X-Authorization on the /xsrf GET")

    # Authenticated API calls must also attach the X-Authorization header.
    if not re.search(r'"X-Authorization"\]?\s*=\s*\$(script:)?AuthToken', text):
        fail(f"{rel} does not attach X-Authorization to authenticated API requests")

    # Every Invoke-RestMethod that performs a real request must forward -Headers
    # so the X-Authorization header is actually sent.
    for line in text.splitlines():
        if "Invoke-RestMethod" not in line:
            continue
        if "function Invoke-RestMethod" in line or "param(" in line:
            continue
        if "-Uri" not in line:
            continue
        if "-Headers" not in line:
            fail(f"{rel} has an Invoke-RestMethod without -Headers: {line.strip()}")


workflow = read(WORKFLOW_DOC)

# The doc must steer agents to the working transport and warn off the ignored
# ones. A bare "Authorization: Bearer" recommendation (without being marked as
# ignored) would re-introduce the bug for future readers.
if "X-Authorization" not in workflow:
    fail("docs/integram-app-workflow.md no longer documents the X-Authorization transport")

wf_lines = workflow.splitlines()
for i, ln in enumerate(wf_lines):
    if "Authorization: Bearer" not in ln:
        continue
    # A mention is acceptable only if it is flagged as ignored within the same
    # warning block (this or an adjacent line).
    context = " ".join(wf_lines[max(0, i - 2): i + 3]).lower()
    if "игнор" not in context:
        fail(
            "docs/integram-app-workflow.md still recommends Authorization: Bearer "
            f"without marking it as ignored: {ln.strip()}"
        )

print("PASS: bootstrap scripts send the token via X-Authorization; docs warn off ignored transports")
