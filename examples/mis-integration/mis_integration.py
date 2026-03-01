#!/usr/bin/env python3
"""
Прототип интеграции с МИС Инфоклиника
======================================
Тестирует два метода API:
  - CLIENTS_CHANGE_LIST (3.2.1) — получение изменений в картотеке пациентов
  - CLIENT_ADD (3.2.5) — регистрация нового пациента

Документация: https://docs.infoclinica.ru/icru/integration/crm-schedule

НАСТРОЙКА: см. файл ИНСТРУКЦИЯ.md в этой папке
"""

import ssl
import uuid
import datetime
import re
import xml.etree.ElementTree as ET
import urllib.request
import urllib.error
import sys
import json

# ─────────────────────────────────────────────────────────────────────────────
# КОНФИГУРАЦИЯ — заполните перед запуском
# (подробное описание каждого параметра: см. ИНСТРУКЦИЯ.md)
# ─────────────────────────────────────────────────────────────────────────────

# Путь к файлу SSL-сертификата (предоставляется МИС)
SSL_CERT_FILE = "client.crt"

# Путь к файлу приватного ключа SSL
SSL_KEY_FILE = "client.key"

# Хост медицинского учреждения на портале Инфоклиника.RU (например: "demo.infoclinica.ru")
# Без https:// и без слэша в конце
CLINIC_HOST = "demo.infoclinica.ru"

# Идентификатор филиала (для CLIENTS_CHANGE_LIST обязательно)
# Получить список филиалов: запрос GET_FILIAL_LIST
FILIAL_ID = 1  # замените на реальный идентификатор

# Идентификатор внешней системы (произвольная строка, согласованная с МИС)
EXTERNAL_SYSTEM_ID = "CRM_IDEAV"

# ─────────────────────────────────────────────────────────────────────────────
# ТЕСТОВЫЕ ДАННЫЕ ДЛЯ CLIENT_ADD (регистрация пациента)
# ─────────────────────────────────────────────────────────────────────────────

TEST_PATIENT = {
    "LASTNAME":   "Тестов",
    "FIRSTNAME":  "Тест",
    "MIDNAME":    "Тестович",
    "EMAIL":      "test@example.com",
    "PHONE":      "+7(999)000-00-00",
    "BDATE":      "19900101",   # формат YYYYMMDD
    "GENDER":     "1",          # 1 — Мужской, 2 — Женский
    "CHECKMODE":  "1",          # 1 — ФИО + Дата рождения
}

# ─────────────────────────────────────────────────────────────────────────────
# URL API
# ─────────────────────────────────────────────────────────────────────────────
API_URL = "https://api.infoclinica.ru/api/xml"


# ─────────────────────────────────────────────────────────────────────────────
# Вспомогательные функции
# ─────────────────────────────────────────────────────────────────────────────

def _now_ts() -> str:
    """Текущее время в формате YYYYMMDDHHNNSS."""
    return datetime.datetime.now().strftime("%Y%m%d%H%M%S")


def _msg_id() -> str:
    """Уникальный идентификатор сообщения."""
    return str(uuid.uuid4()).replace("-", "")[:20]


def _build_msh_xml(msg_type: str, filial_id: int | None = None) -> str:
    """
    Формирует XML-блок заголовка MSH.

    :param msg_type:  тип сообщения (например, CLIENTS_CHANGE_LIST)
    :param filial_id: идентификатор филиала (для запросов, требующих MSH.99)
    """
    filial_tag = f"<MSH.99>{filial_id}</MSH.99>" if filial_id is not None else ""
    return f"""<MSH>
    <MSH.3>{EXTERNAL_SYSTEM_ID}</MSH.3>
    <MSH.7><TS.1>{_now_ts()}</TS.1></MSH.7>
    <MSH.9>
        <MSG.1>WEB</MSG.1>
        <MSG.2>{msg_type}</MSG.2>
    </MSH.9>
    <MSH.10>{_msg_id()}</MSH.10>
    <MSH.18>UTF-8</MSH.18>
    {filial_tag}
</MSH>"""


def _ssl_context() -> ssl.SSLContext:
    """Создаёт SSL-контекст с клиентским сертификатом."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.load_verify_locations(cafile=None)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # для тестирования; в продакшн — включить
    ctx.load_cert_chain(certfile=SSL_CERT_FILE, keyfile=SSL_KEY_FILE)
    return ctx


def _send_request(xml_body: str, filial_id: int | None = None) -> ET.Element:
    """
    Отправляет XML-запрос на API и возвращает распарсенный ответ.

    :param xml_body:  XML-тело запроса (строка)
    :param filial_id: если задан, добавляется HTTP-заголовок X-Forwarded-Host
    """
    headers = {
        "Content-Type": "application/xml; charset=utf-8",
        "Accept":        "application/xml",
    }
    if filial_id is not None:
        headers["X-Forwarded-Host"] = CLINIC_HOST

    data = xml_body.encode("utf-8")
    req  = urllib.request.Request(API_URL, data=data, headers=headers, method="POST")
    ctx  = _ssl_context()

    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        print(f"[WARN] HTTP {exc.code}: {raw.decode('utf-8', errors='replace')[:500]}")
        raise

    xml_str = raw.decode("utf-8")
    # Strip XML namespaces so ElementTree findtext() works without ns prefix
    xml_str = re.sub(r'\s+xmlns(?::\w+)?="[^"]*"', '', xml_str)
    return ET.fromstring(xml_str)


def _check_msa(root: ET.Element, method: str) -> bool:
    """Проверяет MSA.1 (AA — успех, AE — ошибка)."""
    msa1 = root.findtext(".//MSA.1", "")
    msa3 = root.findtext(".//MSA.3", "")
    if msa1 == "AA":
        return True
    print(f"[{method}] Ошибка MSA: {msa1} — {msa3}")
    return False


def _spresult(root: ET.Element, out_tag: str) -> tuple[int, str]:
    """Извлекает SPRESULT и SPCOMMENT из ответа."""
    result  = int(root.findtext(f".//{out_tag}/SPRESULT", "-999") or -999)
    comment = root.findtext(f".//{out_tag}/SPCOMMENT", "")
    return result, comment


# ─────────────────────────────────────────────────────────────────────────────
# Метод 1: CLIENTS_CHANGE_LIST — получение изменений в картотеке пациентов
# ─────────────────────────────────────────────────────────────────────────────

def clients_change_list(filial_id: int = FILIAL_ID) -> list[dict]:
    """
    Запрашивает список изменений в картотеке пациентов (пакет до 100 записей).

    :param filial_id: идентификатор филиала (обязателен)
    :returns:         список словарей с данными изменений
    """
    msh = _build_msh_xml("CLIENTS_CHANGE_LIST", filial_id=filial_id)
    xml_body = f"""<?xml version="1.0" encoding="UTF-8"?>
<WEB_CLIENTS_CHANGE_LIST xmlns="http://sdsys.ru/">
    {msh}
    <CLIENTS_CHANGE_LIST_IN/>
</WEB_CLIENTS_CHANGE_LIST>"""

    print(f"\n{'='*60}")
    print("ЗАПРОС: CLIENTS_CHANGE_LIST")
    print(f"Филиал: {filial_id}, Хост: {CLINIC_HOST}")
    print("="*60)

    root    = _send_request(xml_body, filial_id=filial_id)
    ok      = _check_msa(root, "CLIENTS_CHANGE_LIST")
    result, comment = _spresult(root, "CLIENTS_CHANGE_LIST_OUT")

    print(f"SPRESULT : {result}")
    print(f"SPCOMMENT: {comment}")

    changes = []
    if ok and result == 1:
        for node in root.findall(".//CLIENT_CHANGE_INFO"):
            change = {
                child.tag: (child.text or "").strip()
                for child in node
            }
            changes.append(change)

        print(f"\nПолучено изменений: {len(changes)}")
        for i, ch in enumerate(changes[:5], 1):  # выводим первые 5
            print(f"\n  [{i}] CHANGEID={ch.get('CHANGEID','')} "
                  f"OP={ch.get('CHANGEOP','')} "
                  f"PCODE={ch.get('PCODE','')}")
            print(f"       {ch.get('LASTNAME','')} {ch.get('FIRSTNAME','')} "
                  f"{ch.get('MIDNAME','')} / {ch.get('PPHONE','')}")
        if len(changes) > 5:
            print(f"  ... и ещё {len(changes)-5} записей")
    else:
        raw_xml = ET.tostring(root, encoding="unicode")
        print(f"Ответ XML:\n{raw_xml[:2000]}")

    return changes


# ─────────────────────────────────────────────────────────────────────────────
# Метод 2: CLIENT_ADD — регистрация нового пациента
# ─────────────────────────────────────────────────────────────────────────────

def client_add(patient: dict | None = None) -> dict:
    """
    Регистрирует нового пациента в МИС.

    :param patient: словарь с реквизитами пациента (или TEST_PATIENT по умолчанию)
    :returns:       словарь {pcode, spresult, spcomment}
    """
    if patient is None:
        patient = TEST_PATIENT

    msh = _build_msh_xml("CLIENT_ADD")  # MSH.99 не нужен — вызов на ЦБД

    def _opt(key: str) -> str:
        val = patient.get(key, "")
        return f"<{key}>{val}</{key}>" if val else ""

    xml_body = f"""<?xml version="1.0" encoding="UTF-8"?>
<WEB_CLIENT_ADD xmlns="http://sdsys.ru/">
    {msh}
    <CLIENT_ADD_IN>
        <LASTNAME>{patient['LASTNAME']}</LASTNAME>
        <FIRSTNAME>{patient['FIRSTNAME']}</FIRSTNAME>
        {_opt('MIDNAME')}
        {_opt('EMAIL')}
        {_opt('PHONE')}
        <BDATE>{patient['BDATE']}</BDATE>
        {_opt('GENDER')}
        {_opt('SNILS')}
        {_opt('NSP')}
        {_opt('CHECKMODE')}
        {_opt('REFUSECALL')}
        {_opt('REFUSESMS')}
    </CLIENT_ADD_IN>
</WEB_CLIENT_ADD>"""

    print(f"\n{'='*60}")
    print("ЗАПРОС: CLIENT_ADD")
    print(f"Пациент: {patient['LASTNAME']} {patient['FIRSTNAME']} {patient.get('MIDNAME','')}")
    print("="*60)

    root    = _send_request(xml_body)
    ok      = _check_msa(root, "CLIENT_ADD")
    result, comment = _spresult(root, "CLIENT_ADD_OUT")
    pcode   = root.findtext(".//CLIENT_ADD_OUT/PCODE", "")

    print(f"SPRESULT : {result}")
    print(f"SPCOMMENT: {comment}")
    if pcode:
        print(f"PCODE    : {pcode}  (идентификатор нового пациента в МИС)")

    if not ok or result != 1:
        raw_xml = ET.tostring(root, encoding="unicode")
        print(f"Ответ XML:\n{raw_xml[:2000]}")

    return {"pcode": pcode, "spresult": result, "spcomment": comment}


# ─────────────────────────────────────────────────────────────────────────────
# Точка входа
# ─────────────────────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Прототип интеграции с МИС Инфоклиника",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python mis_integration.py --get-changes
  python mis_integration.py --add-patient
  python mis_integration.py --all
  python mis_integration.py --get-changes --filial 42
  python mis_integration.py --add-patient --patient '{"LASTNAME":"Иванов","FIRSTNAME":"Иван","BDATE":"19850315"}'
        """,
    )
    parser.add_argument("--get-changes", action="store_true",
                        help="Запустить CLIENTS_CHANGE_LIST")
    parser.add_argument("--add-patient", action="store_true",
                        help="Запустить CLIENT_ADD (тестовый пациент)")
    parser.add_argument("--all",         action="store_true",
                        help="Запустить оба метода")
    parser.add_argument("--filial",      type=int, default=FILIAL_ID,
                        help=f"Идентификатор филиала (по умолчанию: {FILIAL_ID})")
    parser.add_argument("--patient",     type=str, default=None,
                        help="JSON-строка с реквизитами пациента для CLIENT_ADD")
    args = parser.parse_args()

    if not (args.get_changes or args.add_patient or args.all):
        parser.print_help()
        sys.exit(0)

    patient_data = None
    if args.patient:
        try:
            patient_data = json.loads(args.patient)
        except json.JSONDecodeError as exc:
            print(f"Ошибка парсинга JSON пациента: {exc}")
            sys.exit(1)

    if args.get_changes or args.all:
        try:
            clients_change_list(filial_id=args.filial)
        except Exception as exc:
            print(f"\n[ОШИБКА] CLIENTS_CHANGE_LIST: {exc}")

    if args.add_patient or args.all:
        try:
            client_add(patient=patient_data)
        except Exception as exc:
            print(f"\n[ОШИБКА] CLIENT_ADD: {exc}")


if __name__ == "__main__":
    main()
