-- A′ (python2node#1055): приложение «Заявки на финансирование» в PostgreSQL, API — PostgREST (схема api).
-- Исходное состояние для сборки: таблицы и права владельца. Админ фонда (роль fund_admin) — владелец
-- приложения, у эксперта (expert) и заявителей (applicant) прав нет. Роли кластера создаёт a1/stand.sh.
-- Пользователь API определяется JWT: {"role": <роль PostgreSQL>, "login": <логин из api.app_user>}.

CREATE SCHEMA api;

CREATE TABLE api.company (
    id            integer PRIMARY KEY,
    name          text NOT NULL UNIQUE,
    inn           text,
    funding_limit numeric
);

-- ord — порядок статуса в процессе (Черновик = 1 … Отклонена = 5)
CREATE TABLE api.status (
    id   integer PRIMARY KEY,
    name text NOT NULL UNIQUE,
    ord  integer NOT NULL
);

-- role — роль PostgreSQL пользователя; company_id — компания заявителя
CREATE TABLE api.app_user (
    login      text PRIMARY KEY,
    fio        text,
    role       text NOT NULL,
    company_id integer REFERENCES api.company
);

CREATE TABLE api.application (
    id          serial PRIMARY KEY,
    number      text NOT NULL UNIQUE,
    company_id  integer NOT NULL REFERENCES api.company,
    status_id   integer NOT NULL REFERENCES api.status,
    amount      numeric,
    revenue     numeric,
    description text,
    expert      text REFERENCES api.app_user,
    verdict     text
);

GRANT USAGE ON SCHEMA api TO fund_admin, expert, applicant;
GRANT ALL ON ALL TABLES IN SCHEMA api TO fund_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA api TO fund_admin;
