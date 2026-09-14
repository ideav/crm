<?php
/**
 * Загрузка одной сущности:
 * проверка схемы → чтение Битрикса → строки импорта в порядке колонок → импорт файлами →
 * второй проход ссылок по id → сверка результата → сохранение состояния.
 */
class EntitySync
{
    private $name;
    private $ent;
    private $ctx;
    /** @var TableSchema */
    private $schema;
    private $target;
    private $rules;
    private $snap;
    private $stats;
    private $secondPass = array();  // ключ записи => [колонка => [spec, keys]]
    private $sentKeys = array();    // ключ => true, отправленные в этом запуске
    private $warned = array();
    private $versions = array();     // load.detect_changes: версии прошлой загрузки
    private $newVersions = array();  // версии отправленных в этом запуске

    public function __construct($name, array $ent, Context $ctx)
    {
        $this->name = $name;
        $this->ent = $ent;
        $this->ctx = $ctx;
        $this->target = $ent['target'];
        $this->rules = arr_get($ent, 'target.bind_existing.normalize', array('trim', 'lower', 'yo'));
    }

    /** Поля Битрикса, которые нужны сущности: [поле => необязательное]. */
    public static function sourceFields(array $ent)
    {
        $out = array();
        if ($d = arr_get($ent, 'load.detect_changes.field')) $out[$d] = false;
        foreach ($ent['fields'] as $fname => $spec) {
            if (arr_get($spec, 'transform') === 'template') {
                preg_match_all('/\{([A-Z0-9_]+)\}/', $spec['template'], $m);
                foreach ($m[1] as $f) if (!isset($out[$f])) $out[$f] = true;
                continue;
            }
            $f = Transform::sourceField($spec, $fname);
            $out[$f] = !empty($spec['optional']) && empty($out[$f]);
        }
        return $out;
    }

    public function run()
    {
        $this->stats = array(
            'entity' => $this->name, 'table' => $this->target['table'], 'fetched' => 0, 'rows' => 0,
            'new' => 0, 'existing' => 0, 'unchanged' => 0, 'kept_insert_only' => 0, 'bound' => 0, 'manual_binding' => array(),
            'skipped' => array(), 'missing_refs' => array(), 'refs_set' => 0, 'files' => 0, 'warnings' => array(),
        );
        $this->schema = $this->ctx->schema($this->target['table_id']);
        $this->checkIntegramSchema();
        $this->checkSourceFields();
        if ($this->ctx->opt('check')) return $this->stats;

        if (!empty($this->target['parent'])) {
            $this->runChildren();
        } else {
            $this->snap = $this->ctx->snapshot($this->schema, $this->target['key'], $this->rules);
            if (arr_get($this->ent, 'load.mode', 'full') === 'incremental') $this->runIncremental();
            else $this->runFull();
            $this->ctx->changed[$this->name] = array_map('strval', array_keys($this->sentKeys));   // для табличных частей
        }

        foreach ($this->ctx->transform->unknown as $dict => $codes) {
            $this->warn("коды без перевода в справочнике $dict: " . implode(', ', array_slice(array_keys($codes), 0, 20)));
        }
        $this->ctx->transform->unknown = array();
        return $this->stats;
    }

    // ---------------------------------------------------------------- проверки схемы

    private function checkIntegramSchema()
    {
        $s = $this->schema;
        $problems = array();
        if ($s->name !== $this->target['table']) $problems[] = "table_id {$s->id} — это «{$s->name}», а в конфиге «{$this->target['table']}»";
        $key = isset($this->target['key']) ? $this->target['key'] : null;
        if (!empty($this->target['parent'])) {
            $pe = $this->ctx->entity($this->target['parent']['entity']);
            $ps = $this->ctx->schema($pe['target']['table_id']);
            $isChild = false;
            foreach ($ps->columns as $c) if ($c['arr'] === $s->id) $isChild = true;
            if (!$isChild) $problems[] = "«{$s->name}» не подчинённая таблица «{$ps->name}»";
        } elseif ($key === '@name') {
            if (!$s->unique) $problems[] = 'ключ @name, но первая колонка таблицы не уникальна';
        } else {
            $c = $s->column($key);
            if (!$c) $problems[] = "нет колонки ключа «{$key}»";
            elseif (!$c['key']) $problems[] = "у колонки «{$key}» нет флага ключа уникальности (_d_key/{$c['req']})";
            // при уникальной первой колонке импорт ищет запись по ключу И названию: переименование в источнике = дубль
            if ($s->unique) $problems[] = "ключ «{$key}», но первая колонка «{$s->name}» уникальна — переименование в источнике создаст дубль (снимите уникальность или используйте key=@name)";
        }
        foreach ($this->ent['fields'] as $f => $spec) {
            $c = $s->column($spec['column']);
            if (!$c) {
                $problems[] = "нет колонки «{$spec['column']}» (поле $f)";
                continue;
            }
            if (isset($s->duplicateNames[$spec['column']])) $problems[] = "в таблице несколько колонок «{$spec['column']}»";
            if (!empty($spec['ref']) && !$c['ref']) $problems[] = "колонка «{$spec['column']}» не ссылочная";
            if (!empty($spec['ref']) && (bool)arr_get($spec, 'ref.multi', false) !== $c['multi']) $problems[] = "признак multi у «{$spec['column']}» не совпадает";
        }
        if ($problems) $this->drift('Интеграм: ' . implode('; ', $problems));
    }

    private function checkSourceFields()
    {
        if (isset($this->ent['source']['from_entity'])) return;
        $adapter = $this->ctx->sourceFor($this->name);
        $names = $adapter->describeFields($this->ent['source']);
        if ($names === null) return;   // источник не описывает поля этой сущности
        $have = array_flip($names);
        $missing = array();
        foreach (self::sourceFields($this->ent) as $f => $optional) {
            if (isset($have[$f])) continue;
            if ($optional) $this->warn("в источнике «{$adapter->name()}» нет необязательного поля $f — колонка останется пустой");
            else $missing[] = $f;
        }
        if ($missing) $this->drift("источник «{$adapter->name()}»: нет полей " . implode(', ', $missing));
    }

    private function drift($msg)
    {
        if (arr_get($this->ctx->cfg, 'safety.on_schema_drift', 'stop') === 'stop') throw new SchemaDriftException($msg);
        $this->warn("расхождение схемы: $msg");
    }

    // ---------------------------------------------------------------- режимы загрузки

    private function detectField()
    {
        return arr_get($this->ent, 'load.detect_changes.field');
    }

    private function runFull()
    {
        if ($this->detectField()) $this->versions = $this->ctx->state->loadVersions($this->name);
        $records = $this->ctx->sourceRecords($this->name);
        $this->stats['fetched'] = count($records);
        $lines = $this->rowsFor($records);

        $ratio = arr_get($this->ctx->cfg, 'safety.max_new_ratio_on_full_load');
        if ($ratio !== null && $this->snap['count'] > 0 && $this->stats['new'] > 0 && !$this->ctx->opt('allow_mass_create')
            && $this->stats['new'] / max(1, count($records)) > $ratio) {
            throw new SafetyException(sprintf('полная загрузка создаст %d новых записей из %d полученных (> %d%%). Проверьте ключ или запустите с --allow-mass-create',
                $this->stats['new'], count($records), $ratio * 100));
        }

        $chunker = $this->chunker();
        foreach ($lines as $line) {
            if ($chunker->wouldOverflow(1, strlen($line))) $this->flush($chunker);
            $chunker->add($line);
        }
        $this->flush($chunker);
        $this->finish();
        if (!$this->ctx->dryRun) {
            $state = $this->ctx->state->load($this->name);
            $state['last_run'] = date('c');
            $this->ctx->state->save($this->name, $state);
            if ($this->detectField()) $this->ctx->state->saveVersions($this->name, array_merge($this->versions, $this->newVersions));
        }
    }

    private function runIncremental()
    {
        $state = $this->ctx->state->load($this->name);
        $runStart = date('c');
        $load = $this->ent['load'];
        $select = array_keys(self::sourceFields($this->ent));

        // условия запроса не зависят от источника — адаптер переводит их в свой синтаксис
        $period = arr_get($load, 'period');

        // Фаза 1: новые записи (ID больше курсора)
        $newPhaseStartId = (int)$state['last_id'];
        $this->streamPhase(array('period' => $period, 'id_gt' => $newPhaseStartId), $select, $state, 'last_id');

        // Фаза 2: изменённые с прошлого полного прогона (ID не больше границы новых)
        if (!empty($state['updated_since']) && ($updField = arr_get($load, 'updated.field'))) {
            if ((int)$state['upd_cursor'] === 0) $state['upd_max_id'] = $newPhaseStartId;
            if ((int)$state['upd_max_id'] > 0) {
                Log::info("[{$this->name}] изменённые с {$state['updated_since']}");
                $this->streamPhase(array(
                    'period' => $period,
                    'modified_gt' => array('field' => $updField, 'since' => $state['updated_since']),
                    'id_lte' => (int)$state['upd_max_id'],
                    'id_gt' => (int)$state['upd_cursor'],
                ), $select, $state, 'upd_cursor');
            }
        }

        // ссылки и сверка сделаны побатчно в streamPhase (settle); при сбое оттуда летит исключение
        // и курсор остаётся на последнем удачном батче, а updated_since не обновляется — следующий запуск продолжит.
        if ($this->ctx->dryRun) return;
        $state['updated_since'] = $runStart;
        $state['upd_cursor'] = 0;
        $state['upd_max_id'] = 0;
        $state['last_run'] = date('c');
        $this->ctx->state->save($this->name, $state);
    }

    private function streamPhase(array $query, array $select, array &$state, $cursorKey)
    {
        $chunker = $this->chunker();
        $pendingMax = null;
        $batchKeys = array();
        $saveState = !$this->ctx->dryRun && arr_get($this->ctx->cfg, 'safety.advance_state_only_after_upload', true);
        $self = $this;
        // Файл залит → сразу проставляем ссылки и сверяем ЭТОТ батч, и только потом двигаем курсор.
        // Иначе сбой на следующем файле оставил бы записи батча без ссылок, а курсор бы их уже пропустил.
        $flush = function () use ($self, $chunker, &$pendingMax, &$batchKeys, &$state, $cursorKey, $saveState) {
            if ($chunker->isEmpty()) return;
            $self->flush($chunker);
            $missing = $self->settle($batchKeys);
            if ($missing) throw new ConnectorException('после импорта не найдены записи: ' . implode(', ', array_slice($missing, 0, 20)));
            $batchKeys = array();
            if ($saveState && $pendingMax !== null) {
                $state[$cursorKey] = $cursorKey === 'last_id' ? max((int)$state['last_id'], $pendingMax) : $pendingMax;
                $self->saveState($state);
            }
        };
        $this->ctx->sourceFor($this->name)->each($this->ent['source'], $query, $select,
            function ($items, $maxId) use ($self, $chunker, &$pendingMax, &$batchKeys, $flush) {
                $newKeys = array();
                $lines = $self->rowsFor($items, $newKeys);
                $bytes = 0;
                foreach ($lines as $l) $bytes += strlen($l);
                if ($chunker->wouldOverflow(count($lines), $bytes)) $flush();
                foreach ($lines as $l) $chunker->add($l);
                foreach ($newKeys as $k) $batchKeys[] = $k;
                $pendingMax = $maxId;
                $self->addFetched(count($items));
            });
        $flush();
        if ($cursorKey === 'upd_cursor') $state['upd_cursor'] = 0;
    }

    /**
     * @internal Импорт батча уже сделан: проставить ссылки второго прохода для его ключей и сверить,
     * что записи появились. Возвращает не найденные ключи (пусто = всё на месте).
     */
    public function settle(array $keys)
    {
        if ($this->ctx->dryRun || !$keys) return array();
        $this->ctx->invalidate($this->schema->id);
        $own = $this->ctx->snapshot($this->schema, $this->target['key'], $this->rules);
        $missing = array();
        if (arr_get($this->ctx->cfg, 'safety.verify_counts', true)) {
            foreach ($keys as $k) if (empty($own['byKey'][$k])) $missing[] = (string)$k;
            if ($missing) {   // запись могла ещё не доехать до реплики — одна повторная проверка
                sleep(3);
                $this->ctx->invalidate($this->schema->id);
                $own = $this->ctx->snapshot($this->schema, $this->target['key'], $this->rules);
                $missing = array();
                foreach ($keys as $k) if (empty($own['byKey'][$k])) $missing[] = (string)$k;
            }
        }
        foreach ($keys as $k) {
            if (!isset($this->secondPass[$k]) || empty($own['byKey'][$k])) continue;
            $rid = $this->pickBest($own, $own['byKey'][$k]);
            $this->applyRefs($rid, $own['rows'][$rid], $this->secondPass[$k]);
            unset($this->secondPass[$k]);
        }
        $this->ctx->invalidate($this->schema->id);
        return $missing;
    }

    /** @internal вызывается из замыкания */
    public function saveState(array $state) { $this->ctx->state->save($this->name, $state); }
    /** @internal */
    public function addFetched($n) { $this->stats['fetched'] += $n; }

    private function chunker()
    {
        return new BkiChunker(arr_get($this->ctx->cfg, 'target.max_rows_per_file', 5000), arr_get($this->ctx->cfg, 'target.max_file_bytes', 7000000));
    }

    // ---------------------------------------------------------------- табличные части

    /**
     * Подчинённая таблица (табличная часть документа). У строк нет своего ключа, поэтому у каждого
     * изменённого родителя старые строки удаляются и загружаются заново: autoParent = таблица родителя,
     * первая колонка файла — id записи родителя (без путаницы с одинаковыми названиями).
     * Ссылки строк ставятся вторым проходом.
     */
    private function runChildren()
    {
        $par = $this->target['parent'];
        $pe = $this->ctx->entity($par['entity']);
        $ps = $this->ctx->schema($pe['target']['table_id']);
        $this->ctx->invalidate($ps->id);
        $psnap = $this->ctx->snapshot($ps, $pe['target']['key'], $this->rules);

        $groups = array();
        foreach ($this->ctx->sourceRecords($this->name) as $rec) {
            $groups[(string)$rec['__parent']][] = $rec;
            $this->stats['fetched']++;
        }
        // родитель загружался в этом запуске — только его изменённые записи, иначе все родители из источника
        $parents = isset($this->ctx->changed[$par['entity']]) ? $this->ctx->changed[$par['entity']] : array_keys($groups);

        $s = $this->schema;
        $chunker = $this->chunker();
        $plan = array();
        $childSecond = array();   // pid => [по строкам в порядке файла: данные второго прохода или []]
        try {
            foreach ($parents as $pkey) {
                $pkey = (string)$pkey;
                if (empty($psnap['byKey'][$pkey])) {
                    $this->missingRef('родитель', $pkey);
                    continue;
                }
                $pid = $this->pickBest($psnap, $psnap['byKey'][$pkey]);
                $lines = array();
                foreach (isset($groups[$pkey]) ? $groups[$pkey] : array() as $rec) {
                    $values = array_fill(0, $s->width, '');
                    $second = array();
                    foreach ($this->ent['fields'] as $fname => $spec) {
                        $col = $s->column($spec['column']);
                        if (!empty($spec['ref'])) {
                            list($import, $pass) = $this->refValue($spec, $fname, $rec, $col);
                            $values[$col['pos']] = $import;
                            if ($pass !== null) $second[$spec['column']] = $pass;
                        } else {
                            $values[$col['pos']] = $this->ctx->transform->apply($spec, $fname, $rec);
                        }
                    }
                    if ($values[0] === '') {
                        $this->skip('пустая первая колонка строки', $pkey);
                        continue;
                    }
                    // ключа у строк табличной части нет: сопоставляем по ПОРЯДКУ, а не по первой колонке
                    // (у двух строк она может совпадать) — childSecond идёт параллельно lines.
                    $childSecond[$pid][] = $second;
                    array_unshift($values, (string)$pid);
                    $lines[] = Bki::row($values);
                }
                $plan[$pid] = count($lines);
                if (!$this->ctx->dryRun) {
                    foreach (array_keys($this->ctx->ig->readChildren($s->id, $pid)) as $oldId) $this->ctx->ig->mDel($oldId);
                }
                foreach ($lines as $line) {
                    if ($chunker->wouldOverflow(1, strlen($line))) $this->flush($chunker, array('autoParent' => $ps->id));
                    $chunker->add($line);
                }
                $this->stats['new'] += count($lines);
            }
            $this->flush($chunker, array('autoParent' => $ps->id));
            $this->stats['parents'] = count($plan);
            if ($this->ctx->dryRun) return;

            $bad = array();
            foreach ($plan as $pid => $n) {
                $children = $this->ctx->ig->readChildren($s->id, $pid);
                if (count($children) !== $n) $bad[] = "родитель $pid: ожидалось $n строк, есть " . count($children);
                ksort($children);   // id по возрастанию = порядок вставки = порядок строк файла
                $seconds = isset($childSecond[$pid]) ? $childSecond[$pid] : array();
                $i = 0;
                foreach ($children as $cid => $r) {
                    if (!empty($seconds[$i])) $this->applyRefs($cid, $r, $seconds[$i]);
                    $i++;
                }
            }
            if ($bad) throw new ConnectorException('строки табличной части не совпали: ' . implode('; ', array_slice($bad, 0, 10)));
        } catch (Exception $e) {
            // заставляем родителей перечитать строки в следующий раз
            if (!$this->ctx->dryRun) $this->forgetParentVersions($parents);
            throw $e;
        }
    }

    private function forgetParentVersions(array $keys)
    {
        $pname = $this->target['parent']['entity'];
        $versions = $this->ctx->state->loadVersions($pname);
        foreach ($keys as $k) unset($versions[(string)$k]);
        $this->ctx->state->saveVersions($pname, $versions);
    }

    // ---------------------------------------------------------------- построение строк

    /** @internal Строки импорта для записей источника; $acceptedKeys заполняется ключами принятых строк. */
    public function rowsFor(array $records, &$acceptedKeys = null)
    {
        $s = $this->schema;
        $keyCol = $this->target['key'];
        $keyPos = $keyCol === '@name' ? 0 : $s->column($keyCol)['pos'];
        $lines = array();
        if (!is_array($acceptedKeys)) $acceptedKeys = array();

        foreach ($records as $rec) {
            $values = array_fill(0, $s->width, '');
            $second = array();
            foreach ($this->ent['fields'] as $fname => $spec) {
                $col = $s->column($spec['column']);
                if (!empty($spec['ref'])) {
                    list($import, $pass) = $this->refValue($spec, $fname, $rec, $col);
                    $values[$col['pos']] = $import;
                    if ($pass !== null) $second[$spec['column']] = $pass;
                } else {
                    $values[$col['pos']] = $this->ctx->transform->apply($spec, $fname, $rec);
                }
            }

            $key = $values[$keyPos];
            $srcId = isset($rec['ID']) ? $rec['ID'] : '?';
            if ($key === '' && arr_get($this->ctx->cfg, 'safety.require_key', true)) { $this->skip('нет внешнего ключа', $srcId); continue; }
            if ($values[0] === '') { $this->skip('пустая первая колонка (при ключе это удаление записи)', $srcId); continue; }
            if (isset($this->sentKeys[$key])) { $this->skip('повтор ключа в одном запуске', $key); continue; }

            $exists = !empty($this->snap['byKey'][$key]);
            if (!$exists && $keyCol !== '@name' && !empty($this->target['bind_existing'])) {
                $bound = $this->bind($key, $values[0]);
                if ($bound === 'manual') continue;
                $exists = $bound === 'bound';
            }
            $detect = $this->detectField();
            $version = $detect ? Transform::scalar(isset($rec[$detect]) ? $rec[$detect] : null) : '';
            if ($exists && $version !== '' && isset($this->versions[$key]) && $this->versions[$key] === $version) {
                $this->stats['unchanged']++;   // версия в источнике та же — запись в Интеграме актуальна
                continue;
            }
            if ($this->target['mode'] === 'insert_only' && $exists) {
                $this->stats['kept_insert_only']++;
                continue;
            }
            $this->stats[$exists ? 'existing' : 'new']++;
            $this->sentKeys[$key] = true;
            $acceptedKeys[] = $key;
            if ($version !== '') $this->newVersions[$key] = $version;
            if ($second) $this->secondPass[$key] = $second;
            $lines[] = Bki::row($values);
        }
        return $lines;
    }

    /** @return array [значение для импорта, данные второго прохода|null] */
    private function refValue(array $spec, $fname, array $rec, array $col)
    {
        $ref = $spec['ref'];
        $missing = isset($ref['missing']) ? $ref['missing'] : 'skip';

        if ($ref['by'] === 'name') {
            $v = $this->ctx->transform->apply($spec, $fname, $rec);
            if ($v === '' || $missing === 'create') return array($v, null);   // ядро найдёт или создаст запись справочника
            $names = $this->ctx->names($col['ref']);
            if (isset($names[$v])) return array($v, null);
            if ($missing === 'error') throw new ConnectorException("[{$this->name}] нет «{$v}» в справочнике колонки «{$spec['column']}»");
            $this->missingRef($spec['column'], $v);
            return array('', null);
        }

        // by key: цель — сущность этого конфига
        $raw = $this->ctx->transform->raw($spec, $fname, $rec);
        $keys = array();
        foreach ((is_array($raw) ? $raw : explode(',', Transform::scalar($raw))) as $k) {
            $k = Transform::scalar($k);
            if ($k !== '' && $k !== '0') $keys[] = $k;
        }
        if (!$keys) return array('', null);   // пусто — ядро не трогает текущее значение

        $te = $this->ctx->entity($ref['entity']);
        $canImport = $ref['entity'] !== $this->name && empty($ref['multi']) && $te['target']['key'] === '@name';
        if ($canImport) {
            // уникальная первая колонка цели: имя = ключ, можно отдать ядру прямо в импорте
            $tsnap = $this->ctx->snapshot($this->ctx->schema($te['target']['table_id']), '@name', $this->rules);
            $n = isset($tsnap['byKey'][$keys[0]]) ? count($tsnap['byKey'][$keys[0]]) : 0;
            if ($n === 1) return array($keys[0], null);
            if ($n === 0) {
                if ($missing === 'error') throw new ConnectorException("[{$this->name}] нет записи с ключом {$keys[0]} для «{$spec['column']}»");
                $this->missingRef($spec['column'], $keys[0]);   // заглушку не создаём
                return array('', null);
            }
            $this->warnOnce("dup:{$te['target']['table']}:{$keys[0]}", "в «{$te['target']['table']}» несколько записей с ключом {$keys[0]} — ссылка ставится на самую заполненную");
        }
        // ключевая колонка, мультиссылка, самоссылка или дубли в цели — только по id вторым проходом
        return array('', array('spec' => $spec, 'keys' => $keys));
    }

    private function bind($key, $name)
    {
        $n = norm_name($name, $this->rules);
        $cands = isset($this->snap['keyless'][$n]) ? $this->snap['keyless'][$n] : array();
        if (count($cands) === 1) {
            $rid = $cands[0];
            $col = $this->schema->column($this->target['key']);
            if (!$this->ctx->dryRun) $this->ctx->ig->mSet($rid, array('t' . $col['req'] => $key));
            unset($this->snap['keyless'][$n]);
            $this->snap['byKey'][$key] = array($rid);
            $this->stats['bound']++;
            Log::info("[{$this->name}] привязана существующая запись $rid «{$name}» → ключ $key");
            return 'bound';
        }
        if (count($cands) > 1) {
            $this->stats['manual_binding'][] = array('key' => $key, 'name' => $name, 'candidates' => $cands);
            $this->warn("нужна ручная привязка: «{$name}» (ключ $key), кандидаты " . implode(', ', $cands) . ' — запись пропущена');
            return 'manual';
        }
        return 'none';
    }

    // ---------------------------------------------------------------- импорт и после него

    /** @internal */
    public function flush(BkiChunker $chunker, array $extra = array())
    {
        if ($chunker->isEmpty()) return;
        $n = $chunker->count();
        $content = $chunker->take();
        $this->stats['files']++;
        $this->stats['rows'] += $n;
        if ($dir = $this->ctx->opt('bki_dir')) {
            if (!is_dir($dir)) mkdir($dir, 0775, true);
            file_put_contents(sprintf('%s/%s-%03d.bki', $dir, $this->name, $this->stats['files']), $content);
        }
        if ($this->ctx->dryRun) {
            Log::info("[{$this->name}] пробный запуск: файл на $n строк не отправлен");
            return;
        }
        $warning = $this->ctx->ig->import($this->schema->id, $content, $extra);
        Log::info("[{$this->name}] импорт: $n строк" . ($warning !== '' ? " (ядро: $warning)" : ''));
    }

    /** Второй проход ссылок и сверка. Возвращает ключи, не найденные после импорта. */
    private function finish()
    {
        if ($this->ctx->dryRun || !$this->sentKeys) return array();
        $this->ctx->invalidate($this->schema->id);
        $own = $this->ctx->snapshot($this->schema, $this->target['key'], $this->rules);

        $missing = array();
        if (arr_get($this->ctx->cfg, 'safety.verify_counts', true)) {
            $missing = $this->missingKeys($own);
            if ($missing) {   // запись могла ещё не доехать до реплики — одна повторная проверка
                sleep(3);
                $this->ctx->invalidate($this->schema->id);
                $own = $this->ctx->snapshot($this->schema, $this->target['key'], $this->rules);
                $missing = $this->missingKeys($own);
            }
        }

        foreach ($this->secondPass as $key => $cols) {
            if (empty($own['byKey'][$key])) continue;
            $rid = $this->pickBest($own, $own['byKey'][$key]);
            $this->applyRefs($rid, $own['rows'][$rid], $cols);
        }
        if ($this->secondPass) $this->ctx->invalidate($this->schema->id);
        if ($missing && arr_get($this->ent, 'load.mode') !== 'incremental') {
            throw new ConnectorException('после импорта не найдены записи: ' . implode(', ', array_slice($missing, 0, 20)));
        }
        return $missing;
    }

    /** Второй проход: ссылки записи по id целей (_m_set заменяет набор мультиссылки целиком). */
    private function applyRefs($rid, array $current, array $cols)
    {
        $set = array();
        foreach ($cols as $colName => $info) {
                $spec = $info['spec'];
                $col = $this->schema->column($colName);
                $te = $this->ctx->entity($spec['ref']['entity']);
                $tsnap = $this->ctx->snapshot($this->ctx->schema($te['target']['table_id']), $te['target']['key'], $this->rules);
                $ids = array();
                foreach ($info['keys'] as $k) {
                    if (empty($tsnap['byKey'][$k])) {
                        $this->missingRef($colName, $k);
                        continue;
                    }
                    $ids[] = $this->pickBest($tsnap, $tsnap['byKey'][$k]);
                    if (empty($spec['ref']['multi'])) break;
                }
                if (!$ids) continue;   // ни одной цели — текущее значение не трогаем
                $cur = TableSchema::refIds(isset($current[$col['pos']]) ? $current[$col['pos']] : '');
                $want = $ids;
                sort($want);
                sort($cur);
                if ($want !== $cur) $set['t' . $col['req']] = implode(',', $ids);
        }
        if ($set) {
            $this->ctx->ig->mSet($rid, $set);
            $this->stats['refs_set'] += count($set);
        }
    }

    private function missingKeys(array $own)
    {
        $missing = array();
        foreach ($this->sentKeys as $k => $_) if (empty($own['byKey'][$k])) $missing[] = (string)$k;
        return $missing;
    }

    /** Из нескольких записей с одним ключом — самая заполненная, при равенстве — старшая по id. */
    private function pickBest(array $snap, array $ids)
    {
        if (count($ids) === 1) return $ids[0];
        $best = null;
        $bestScore = -1;
        sort($ids);
        foreach ($ids as $id) {
            $score = count(array_filter($snap['rows'][$id], 'strlen'));
            if ($score > $bestScore) {
                $best = $id;
                $bestScore = $score;
            }
        }
        return $best;
    }

    // ---------------------------------------------------------------- учёт

    private function skip($reason, $id)
    {
        if (!isset($this->stats['skipped'][$reason])) $this->stats['skipped'][$reason] = 0;
        $this->stats['skipped'][$reason]++;
        $this->warnOnce("skip:$reason", "пропуск записи ($reason), например ID $id");
    }

    private function missingRef($column, $value)
    {
        if (!isset($this->stats['missing_refs'][$column])) $this->stats['missing_refs'][$column] = 0;
        $this->stats['missing_refs'][$column]++;
        $this->warnOnce("ref:$column", "нет цели для «{$column}» (например «{$value}») — поле оставлено пустым");
    }

    private function warn($msg)
    {
        $this->stats['warnings'][] = $msg;
        Log::warn("[{$this->name}] $msg");
    }

    private function warnOnce($key, $msg)
    {
        if (isset($this->warned[$key])) return;
        $this->warned[$key] = true;
        $this->warn($msg);
    }
}
