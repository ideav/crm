CREATE TABLE IF NOT EXISTS my (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    up INT UNSIGNED NOT NULL DEFAULT 0,
    ord INT NOT NULL DEFAULT 0,
    t INT UNSIGNED NOT NULL DEFAULT 0,
    val MEDIUMTEXT NOT NULL,
    PRIMARY KEY (id),
    KEY up_t (up, t),
    KEY t_up (t, up),
    KEY t_val (t, val(191)),
    KEY up_ord (up, ord)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ru LIKE my;
CREATE TABLE IF NOT EXISTS en LIKE my;

CREATE TEMPORARY TABLE integram_seed LIKE my;

INSERT INTO integram_seed (id, up, ord, t, val) VALUES
    (1, 0, 0, 1, 'FREE_LINK'),
    (2, 0, 0, 2, 'HTML'),
    (3, 0, 0, 3, 'SHORT'),
    (4, 0, 0, 4, 'DATETIME'),
    (5, 0, 0, 5, 'GRANT'),
    (6, 0, 0, 6, 'PWD'),
    (7, 0, 0, 7, 'BUTTON'),
    (8, 0, 0, 8, 'CHARS'),
    (9, 0, 0, 9, 'DATE'),
    (10, 0, 0, 10, 'FILE'),
    (11, 0, 0, 11, 'BOOLEAN'),
    (12, 0, 0, 12, 'MEMO'),
    (13, 0, 0, 13, 'NUMBER'),
    (14, 0, 0, 14, 'SIGNED'),
    (15, 0, 0, 15, 'CALCULATABLE'),
    (16, 0, 0, 16, 'REPORT_COLUMN'),
    (17, 0, 0, 17, 'PATH'),
    (18, 0, 1, 3, 'Пользователь'),
    (20, 18, 1, 6, 'Пароль'),
    (30, 18, 2, 3, 'Телефон'),
    (33, 18, 3, 3, 'Имя'),
    (40, 18, 4, 6, 'xsrf'),
    (41, 18, 5, 3, 'Email'),
    (42, 0, 2, 3, 'Роль'),
    (47, 0, 3, 3, 'Уровень доступа'),
    (49, 116, 2, 3, 'Маска'),
    (55, 116, 3, 11, 'Экспорт'),
    (56, 116, 4, 11, 'Удаление'),
    (115, 18, 6, 144, 'Роль'),
    (116, 42, 1, 5, 'Объекты'),
    (124, 18, 7, 4, 'Activity'),
    (125, 18, 8, 6, 'Token'),
    (130, 18, 9, 3, 'Secret'),
    (135, 42, 2, 12, 'Описание'),
    (144, 0, 0, 42, ''),
    (145, 1, 1, 42, 'admin'),
    (151, 0, 4, 3, 'Меню'),
    (153, 151, 1, 8, 'Адрес'),
    (156, 18, 10, 9, 'Дата'),
    (158, 151, 2, 3, 'Параметры'),
    (164, 1, 2, 42, 'user'),
    (170, 1, 1, 47, 'WRITE'),
    (171, 1, 2, 47, 'READ'),
    (172, 1, 3, 47, 'BARRED'),
    (271, 18, 11, 3, 'База'),
    (275, 271, 1, 9, 'Дата'),
    (276, 271, 2, 12, 'Описание'),
    (283, 271, 3, 3, 'Шаблон'),
    (285, 271, 4, 13, 'Баланс'),
    (300, 18, 12, 13, 'Retries'),
    (391, 151, 3, 8, 'Иконка'),
    (1001, 145, 1, 116, '1'),
    (1002, 1001, 1, 170, ''),
    (1003, 145, 2, 116, '0'),
    (1004, 1003, 1, 170, ''),
    (1005, 145, 3, 116, '10'),
    (1006, 1005, 1, 170, ''),
    (1010, 164, 1, 116, '1'),
    (1011, 1010, 1, 171, '');

INSERT IGNORE INTO my SELECT * FROM integram_seed;
INSERT IGNORE INTO ru SELECT * FROM integram_seed;
INSERT IGNORE INTO en SELECT * FROM integram_seed;

DROP TEMPORARY TABLE integram_seed;
