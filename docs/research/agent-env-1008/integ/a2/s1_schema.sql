-- A″ (python2node#1060), S1 «Заявки»: приложение #1055 (effort/a1/schema.sql) без таблицы компаний.
-- Компании живут в S2 «Реестр контрагентов»; заявка и заявитель ссылаются на компанию по ИНН (company_inn).
-- Пользователь API определяется JWT: {"role": <роль PostgreSQL>, "login": <логин из api.app_user>}.

CREATE SCHEMA api;

-- ord — порядок статуса в процессе (Черновик = 1 … Отклонена = 5)
CREATE TABLE api.status (
    id   integer PRIMARY KEY,
    name text NOT NULL UNIQUE,
    ord  integer NOT NULL
);

-- role — роль PostgreSQL пользователя; company_inn — ИНН компании заявителя (реестр контрагентов)
CREATE TABLE api.app_user (
    login       text PRIMARY KEY,
    fio         text,
    role        text NOT NULL,
    company_inn text
);

CREATE TABLE api.application (
    id          serial PRIMARY KEY,
    number      text NOT NULL UNIQUE,
    company_inn text NOT NULL,
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
