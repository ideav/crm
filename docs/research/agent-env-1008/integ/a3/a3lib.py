"""Общее для среды A″ (a3) замера python2node#1060: клиент S2 и запуск sync.py.

Нужен раннеру (envs_integ.A3Env) и MCP-серверу агента (effort/build_mcp.py, R1055_ENV=a3).
Состояние среды a3 — три части с одним именем снимка: база S1 в кластере crm1055a, файл S2
$STAND/data/<имя>.json (у живой S2 — registry.json) и каталог $STAND/sync/<имя>/ с sync.py.
"""
import base64
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAND = Path(os.getenv("R1060_A3_STAND", "/root/crm1060r"))
REG_URL = os.getenv("R1060_A3_URL", "http://127.0.0.1:18692/odata/standard.odata")
S1_STAND = Path(os.getenv("R1055_A1_STAND", "/root/crm1055a"))
S1_CONTAINER = os.getenv("R1055_A1_DB", "crm1055a-db")
SYNC_IMAGE = os.getenv("R1060_A3_SYNC_IMAGE", "crm1060-sync")
SYNC_TIMEOUT = 60
LIVE = "registry"  # живая S2 — data/registry.json
DOC = HERE / "REGISTRY_API.md"


def _env_file(path: Path) -> dict:
    return dict(line.split("=", 1) for line in path.read_text().split() if "=" in line)


def creds() -> tuple:
    e = _env_file(STAND / ".env")
    return e["R1060R_USER"], e["R1060R_PASSWORD"]


# --- S2 ----------------------------------------------------------------------------------------

def quote_path(path: str) -> str:
    """Кириллица и пробелы пути — в %-кодировку; уже закодированное и служебные символы OData не трогаем."""
    return urllib.parse.quote(path.lstrip("/"), safe="/?&=$,()'.:-_~+%*;!@")


def reg_call(method: str, path: str, body=None) -> tuple:
    user, pw = creds()
    headers = {"Authorization": "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode(),
               "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{REG_URL}/{quote_path(path)}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def data_file(name: str) -> Path:
    return STAND / "data" / f"{name}.json"


def read_data(name: str = LIVE) -> dict:
    return json.loads(data_file(name).read_text("utf-8"))


def write_data(data: dict, name: str = LIVE):
    p = data_file(name)
    tmp = p.with_name(f".{p.name}.runner")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    os.replace(tmp, p)


def copy_data(src: str, dst: str):
    write_data(read_data(src), dst)


# --- sync.py -----------------------------------------------------------------------------------

def sync_dir(name: str) -> Path:
    return STAND / "sync" / name


def write_sync(name: str, code: str) -> Path:
    d = sync_dir(name)
    d.mkdir(parents=True, exist_ok=True)
    p = d / "sync.py"
    p.write_text(code, "utf-8")
    return p


def copy_sync(src: str, dst: str):
    shutil.rmtree(sync_dir(dst), ignore_errors=True)
    if (sync_dir(src) / "sync.py").exists():
        shutil.copytree(sync_dir(src), sync_dir(dst))


def drop_sync(name: str):
    shutil.rmtree(sync_dir(name), ignore_errors=True)


def s1_dsn(db: str = "app") -> str:
    """S1 по адресу контейнера базы в сети docker: из контейнера sync (--network host) он доступен."""
    ip = subprocess.run(["docker", "inspect", S1_CONTAINER, "--format",
                         "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}"],
                        capture_output=True, text=True, check=True).stdout.split()[0]
    pw = _env_file(S1_STAND / ".env")["PG_PASSWORD"]
    return f"host={ip} port=5432 dbname={db} user=postgres password={pw}"


def run_sync(name: str, db: str = "app", timeout: int = SYNC_TIMEOUT) -> dict:
    """Запуск sync.py снимка name против живых S1 (база db) и S2. Код возврата, вывод, превышение времени."""
    p = sync_dir(name) / "sync.py"
    if not p.exists():
        return {"rc": None, "stdout": "", "stderr": "sync.py не написан", "timeout": False, "missing": True}
    user, pw = creds()
    cname = f"crm1060-sync-{os.getpid()}"
    cmd = ["docker", "run", "--rm", "--name", cname, "--network", "host", "--memory", "512m", "--read-only",
           "--tmpfs", "/tmp", "-v", f"{sync_dir(name)}:/work:ro", "-w", "/work",
           "-e", f"S1_DSN={s1_dsn(db)}", "-e", f"REG_URL={REG_URL}", "-e", f"REG_USER={user}",
           "-e", f"REG_PASSWORD={pw}", "-e", "PYTHONIOENCODING=utf-8", "-e", "PYTHONDONTWRITEBYTECODE=1",
           SYNC_IMAGE, "python3", "sync.py"]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
        return {"rc": r.returncode, "stdout": r.stdout.decode("utf-8", "replace")[-8000:],
                "stderr": r.stderr.decode("utf-8", "replace")[-8000:], "timeout": False}
    except subprocess.TimeoutExpired as e:
        subprocess.run(["docker", "rm", "-f", cname], capture_output=True)
        return {"rc": None, "stdout": (e.stdout or b"").decode("utf-8", "replace")[-8000:],
                "stderr": (e.stderr or b"").decode("utf-8", "replace")[-8000:], "timeout": True}
