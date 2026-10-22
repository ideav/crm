"""Доступ к MariaDB в контейнере crm1008-db через `docker exec mariadb` (stdlib, без драйвера).

SELECT-ы пишутся так, чтобы каждая строка результата была одним JSON-объектом (JSON_OBJECT):
тогда разбор не зависит от табуляций, переводов строк и NULL в данных.
"""
import json
import os
import re
import subprocess

CONTAINER = os.getenv("R1008_DB_CONTAINER", "crm1008-db")


class DbError(Exception):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code, self.msg = code, msg


def q(v) -> str:
    """Литерал SQL."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    s = str(v)
    for a, b in (("\\", "\\\\"), ("'", "\\'"), ("\0", "\\0"), ("\n", "\\n"), ("\r", "\\r"), ("\x1a", "\\Z")):
        s = s.replace(a, b)
    return "'" + s + "'"


def ident(name: str) -> str:
    if "`" in name or "\0" in name or not name or len(name) > 64:
        raise ValueError("недопустимое имя")
    return "`" + name + "`"


def safe_db_name(run_id: str) -> str:
    return "ra_" + re.sub(r"\W", "_", run_id, flags=re.A)[:58]


def run(sql: str, db: str | None = None, timeout: int = 60) -> list[str]:
    """Выполняет SQL, возвращает строки stdout (без заголовков)."""
    cmd = ["docker", "exec", "-i", CONTAINER, "sh", "-c",
           'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" --default-character-set=utf8mb4 '
           '--batch --raw --skip-column-names ' + (db or "")]
    p = subprocess.run(cmd, input=sql.encode("utf-8"), capture_output=True, timeout=timeout)
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace")
        m = re.search(r"ERROR (\d+)", err)
        raise DbError(int(m.group(1)) if m else 0, err.strip().splitlines()[-1] if err.strip() else "db error")
    return p.stdout.decode("utf-8").splitlines()


def rows(sql: str, db: str) -> list:
    """SELECT, каждая строка которого — один JSON."""
    return [json.loads(x) for x in run(sql, db) if x.strip()]
