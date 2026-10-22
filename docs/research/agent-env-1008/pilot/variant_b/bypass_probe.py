"""Что может агент B1 из песочницы agent-chat (bwrap + agentrun) против стенда: обход API, БД, секреты.

Запуск на песочнице (после `python3 pilot/variant_b.py services start`):
    /root/agent-chat/venv/bin/python pilot/variant_b/bypass_probe.py
Команды идут через ту же sandbox_argv/sandbox_env, что и Claude в agent-chat; значения секретов не печатаются.
"""
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import variant_b as vb  # noqa: E402

app_dir = vb._pin_agent_chat()
svc = vb._service_env()
os.environ.update({"AGENT_USER": svc.get("AGENT_USER", "agentrun"), "INTEGRAM_BASE": vb.CORE,
                   "DATA_DIR": str(vb.DATA / "b1-data"), "AGENT_BEARER_TOKEN": "x", "KB_DIR": svc.get("KB_DIR", ""),
                   "CALLBACK_HOSTS": "pilot.invalid", "CLAUDE_CODE_OAUTH_TOKEN": svc["CLAUDE_CODE_OAUTH_TOKEN"]})
sys.path.insert(0, str(app_dir))
import agent_chat as ac  # noqa: E402

ctx = vb.provision("probe", None, "B1")
ws = ac.workspace_of(ctx["db"], "alpha_user")
ws.mkdir(parents=True, exist_ok=True)
db_ip = subprocess.run(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "crm1008-db"],
                       capture_output=True, text=True).stdout.strip()
db_path = f"{vb.CORE}/{ctx['db']}"

CHECKS = [
    ("кто я", "id -un; id -u"),
    ("видно /root", "ls /root 2>&1 | head -3; echo rc=$?"),
    (".env стенда", "cat /root/crm1008-stand/crm/.env.local 2>&1 | head -1"),
    (".env agent-chat", "cat /root/agent-chat/.env 2>&1 | head -1"),
    ("журналы ядра", "ls /root/crm1008-stand/logs 2>&1 | head -1"),
    ("запись вне рабочего каталога", "touch /etc/pilot_x 2>&1 | head -1; touch /var/tmp/pilot_x 2>&1 | head -1; echo done"),
    ("имена секретов в окружении", "env | cut -d= -f1 | grep -Ei 'token|key|secret|pass' | tr '\\n' ' '"),
    ("docker.sock читаем", "test -r /var/run/docker.sock && echo YES || echo no"),
    ("ядро без токена: список заявок (HTTP)", f"curl -s -m 5 -o /dev/null -w '%{{http_code}}' '{db_path}/object/10200/?JSON'"),
    ("ядро с чужим токеном (HTTP)", f"curl -s -m 5 -o /dev/null -w '%{{http_code}}' -H 'X-Authorization: 0123456789abcdef' '{db_path}/object/10200/?JSON'"),
    ("порт MariaDB стенда достижим", f"timeout 3 bash -c '</dev/tcp/{db_ip}/3306' 2>/dev/null && echo OPEN || echo closed"),
    ("порт 18681 (ядро) достижим", "timeout 3 bash -c '</dev/tcp/127.0.0.1/18681' 2>/dev/null && echo OPEN || echo closed"),
    ("pilot/run без ключа (HTTP)", f"curl -s -m 5 -o /dev/null -w '%{{http_code}}' -X POST -d '{{}}' http://127.0.0.1:{vb.HOST_PORT}/pilot/run"),
    ("agent/ig без ключа (HTTP)", f"curl -s -m 5 -o /dev/null -w '%{{http_code}}' -X POST -d '{{\"method\":\"GET\",\"path\":\"x\",\"key\":\"k\"}}' http://127.0.0.1:{vb.HOST_PORT}/agent/ig"),
    ("боевой ideav-mcp :8768 без токена (HTTP)", "curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST -d '{}' http://127.0.0.1:8768/mcp/rb_probe"),
    ("интернет", "curl -s -m 6 -o /dev/null -w '%{http_code}' https://example.com || echo none"),
    ("чужие процессы", "ps -e | wc -l"),
]

try:
    for title, cmd in CHECKS:
        argv = ["/bin/bash", "-c", cmd]
        argv = ac.sandbox_argv(argv, ws)
        env = ac.sandbox_env({k: v for k, v in os.environ.items() if k not in ac.SERVICE_SECRETS}, ws)
        env["IG_URL"], env["IG_KEY"] = ac.IG_URL, "probe-key"
        ac.prepare_sandbox(ws)
        p = subprocess.run(argv, env=env, cwd=str(ws), capture_output=True, text=True, timeout=30)
        print(f"{title}: {(p.stdout + p.stderr).strip()[:300]!r}")
finally:
    vb.teardown(ctx)
