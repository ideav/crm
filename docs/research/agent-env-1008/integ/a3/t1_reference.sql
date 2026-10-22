-- Эталон T1 среды A″ (a3) замера python2node#1060, часть S1 сверх эталона A′ (integ/a1/t1_reference.sql).
-- Копия справочника в S1 хранит ссылку на элемент S2: ext_id = Ref_Key. По ней сопоставляет
-- эталонная синхронизация integ/a3/sync_reference.py.

ALTER TABLE api.company ADD COLUMN ext_id uuid UNIQUE;
