-- ============================================================================
-- Сборка эталонной базы `cm` — шаблона «Сопоставление каталогов» (issue #4956)
-- ============================================================================
--
-- Шаблон базы в Интеграме — таблица MySQL, которую ядро клонирует при создании
-- базы пользователя (`newDb()` в index.php):
--     CREATE TABLE <база> LIKE cm;  INSERT INTO <база> SELECT * FROM cm;
-- Копируется ВСЁ содержимое таблицы, поэтому в шаблоне не должно остаться ни
-- пользователей (их токены и пароли уехали бы в базу каждого клиента и были бы
-- там действующими), ни данных чужого клиента.
--
-- Скрипт: копирует рабочую базу в `cm`, вычищает данные и пользователей,
-- печатает две сводки для проверки. Существующая таблица `cm` пересоздаётся.
--
-- Запуск (MySQL 8: нужны рекурсивные CTE):
--     mysql -u <user> -p <schema> < docs/scripts/prepare_cm_template.sql
--
-- Прогон на стенде, без боевой базы: prepare_cm_template.stand.sql поднимает
-- синтетическую базу `xcom` (пользователи с токенами, данные, роли, меню,
-- отчёт, настройка, поддерево в три уровня), после чего этот скрипт запускается
-- поверх неё:
--     mysql -u root -p stand < docs/scripts/prepare_cm_template.stand.sql
--     mysql -u root -p stand < docs/scripts/prepare_cm_template.sql
--
-- Разбор шаблона целиком — docs/xcom-matching/template-db.md
-- ============================================================================

-- --- ПРАВИТЬ ЗДЕСЬ ---------------------------------------------------------

-- Рабочая база, с которой снимается эталон.
SET @src := 'xcom';

-- ---------------------------------------------------------------------------

-- 1. Копия рабочей базы в таблицу шаблона.
DROP TABLE IF EXISTS cm;
SET @stmt := CONCAT('CREATE TABLE cm LIKE `', @src, '`');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
SET @stmt := CONCAT('INSERT INTO cm SELECT * FROM `', @src, '`');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Таблицы с ДАННЫМИ: их записи из шаблона удаляются. Имена — как в базе,
--    сравнение регистронезависимое. Таблицы настроек здесь перечислять не надо:
--    их записи и есть стартовый конфиг шаблона.
--    Список лежит во временной таблице, а не в переменной: у переменной кодировка
--    соединения, и сравнение с колонкой базы падает «Illegal mix of collations».
DROP TEMPORARY TABLE IF EXISTS cm_data_tables;
CREATE TEMPORARY TABLE cm_data_tables LIKE cm;

-- --- ПРАВИТЬ ЗДЕСЬ (вместе с @src выше) ------------------------------------
INSERT INTO cm_data_tables (val) VALUES
    ('SKU'),
    ('RFP'),
    ('Токен'),
    ('Бренд'),
    ('Решение по паре'),
    ('Журнал развёртывания'),
    ('Профиль загрузки');
-- ---------------------------------------------------------------------------

-- 3. Что удаляем: записи перечисленных таблиц и ВСЕ записи «Пользователь».
--    Тип в Интеграме — строка с up=0, запись верхнего уровня — строка с up=1 и
--    t = id типа; реквизиты и подчинённые записи висят под записью по `up`,
--    поэтому поддерево обходится рекурсивно.
--    18 — «Пользователь» (константа USER в index.php).
DROP TEMPORARY TABLE IF EXISTS cm_doomed;
CREATE TEMPORARY TABLE cm_doomed (id INT UNSIGNED PRIMARY KEY);

INSERT INTO cm_doomed (id)
WITH RECURSIVE subtree AS (
    SELECT rec.id
      FROM cm rec
     WHERE rec.up = 1
       AND (rec.t = 18
            OR rec.t IN (SELECT typ.id FROM cm typ
                           JOIN cm_data_tables name ON name.val = typ.val
                          WHERE typ.up = 0))
    UNION ALL
    SELECT child.id
      FROM cm child
      JOIN subtree parent ON child.up = parent.id
)
SELECT id FROM subtree;

DELETE FROM cm WHERE id IN (SELECT id FROM cm_doomed);
DROP TEMPORARY TABLE cm_doomed;
DROP TEMPORARY TABLE cm_data_tables;

-- 4. Сводка: что осталось в шаблоне. Ожидание — настройки, роли, меню,
--    определения отчётов; записей SKU/RFP/токенов и пользователей нет.
SELECT COALESCE(typ.val, CONCAT('тип ', rec.t)) AS `Таблица`,
       COUNT(*)                                 AS `Записей`
  FROM cm rec
  LEFT JOIN cm typ ON typ.id = rec.t AND typ.up = 0
 WHERE rec.up = 1
 GROUP BY rec.t, typ.val
 ORDER BY `Записей` DESC, `Таблица`;

-- 5. Контроль утечки доступа. Обязан быть ноль: Пароль (20), xsrf (40),
--    Token (125), Secret (130).
SELECT COUNT(*) AS `Осталось строк с секретами`
  FROM cm WHERE t IN (20, 40, 125, 130);
