<?php

/** Общее окружение запуска: конфиг, клиенты, кэш схем и снимков таблиц. */
class Context
{
    public $cfg;
    public $root;       // корень данных: runtime-пути, запасные файлы справочников
    public $codeRoot;   // корень кода: имитации источников в tests/
    public $opts;
    public $dryRun;
    public $confinePaths;   // запуск для базы (--db / URL): пути из конфига запираем в папке базы
    /** @var IntegramClient */
    public $ig;
    /** @var State */
    public $state;
    /** @var Transform */
    public $transform;
    /** @var array сущность => ключи, отправленные в этом запуске (для табличных частей) */
    public $changed = array();
    private $sources = array();
    private $schemas = array();
    private $snapshots = array();
    private $names = array();
    private $sourceCache = array();

    public function __construct(array $cfg, $root, array $opts, $codeRoot = null)
    {
        $this->cfg = $cfg;
        $this->root = $root;
        $this->codeRoot = $codeRoot !== null ? $codeRoot : $root;
        $this->opts = $opts;
        $this->confinePaths = !empty($opts['db']);
        $this->dryRun = !empty($opts['dry_run']) || arr_get($cfg, 'runtime.dry_run', false);
        $this->ig = new IntegramClient($cfg['target']);
        $this->state = new State($this->path(arr_get($cfg, 'runtime.state_dir', 'state/' . $cfg['project'])));
        $this->transform = new Transform(new Dictionaries(isset($cfg['dictionaries']) ? $cfg['dictionaries'] : array(), $this));
    }

    public function path($p) {
        if ($this->confinePaths) return $this->dataFile($p, 'путь из конфига');
        return $p !== '' && $p[0] === '/' ? $p : $this->root . '/' . $p;
    }

    /** Путь строго внутри папки базы: без абсолютного пути и без .. (защита от записи/чтения чужих папок). */
    public function dataFile($rel, $what)
    {
        $rel = (string)$rel;
        if ($rel === '' || $rel[0] === '/' || $rel[0] === '\\' || preg_match('~(^|[/\\\\])\.\.([/\\\\]|$)~', $rel)) {
            throw new ConnectorException("$what: путь «{$rel}» должен быть внутри папки базы, без .. и абсолютных путей");
        }
        return $this->root . '/' . $rel;
    }

    public function opt($k) { return isset($this->opts[$k]) ? $this->opts[$k] : null; }

    public function entity($name)
    {
        if (!isset($this->cfg['entities'][$name])) throw new ConnectorException("сущность $name не описана");
        return $this->cfg['entities'][$name];
    }

    /** @return SourceAdapter подключение из sources по имени */
    public function source($connection)
    {
        if (!isset($this->cfg['sources'][$connection])) throw new ConnectorException("подключение «{$connection}» не описано в sources");
        if (!isset($this->sources[$connection])) {
            $this->sources[$connection] = Sources::create($connection, $this->cfg['sources'][$connection], $this->codeRoot);
        }
        return $this->sources[$connection];
    }

    /** Имя подключения: явно указанное или единственное в sources. */
    public function connection($explicit, $what)
    {
        if ($explicit !== null && $explicit !== '') return $explicit;
        $names = array_keys($this->cfg['sources']);
        if (count($names) === 1) return $names[0];
        throw new ConnectorException("$what: подключений несколько — укажите connection");
    }

    /** @return SourceAdapter источник сущности (для from_entity — источник исходной сущности) */
    public function sourceFor($entityName)
    {
        $ent = $this->entity($entityName);
        if (isset($ent['source']['from_entity'])) return $this->sourceFor($ent['source']['from_entity']);
        return $this->source($this->connection(arr_get($ent, 'source.connection'), "сущность $entityName"));
    }

    /** @return TableSchema */
    public function schema($tableId)
    {
        $tableId = (int)$tableId;
        if (!isset($this->schemas[$tableId])) $this->schemas[$tableId] = TableSchema::fromMetadata($this->ig->metadata($tableId));
        return $this->schemas[$tableId];
    }

    /**
     * Снимок таблицы: byKey[ключ] => [id записей], keyless[норм. название] => [id], rows[id] => r[].
     * Кэшируется до invalidate() — после импорта в таблицу.
     */
    public function snapshot(TableSchema $s, $keyCol, array $rules)
    {
        $cacheKey = $s->id . '|' . $keyCol . '|' . implode(',', $rules);
        if (isset($this->snapshots[$cacheKey])) return $this->snapshots[$cacheKey];
        $col = $s->column($keyCol);
        if (!$col) throw new ConnectorException("в «{$s->name}» нет колонки «{$keyCol}»");
        $rows = $this->ig->readAll($s->id);
        $snap = array('byKey' => array(), 'keyless' => array(), 'rows' => $rows, 'count' => count($rows));
        foreach ($rows as $id => $r) {
            $k = isset($r[$col['pos']]) ? trim((string)$r[$col['pos']]) : '';
            if ($k === '') $snap['keyless'][norm_name($r[0], $rules)][] = $id;
            else $snap['byKey'][$k][] = $id;
        }
        return $this->snapshots[$cacheKey] = $snap;
    }

    public function invalidate($tableId)
    {
        foreach (array_keys($this->snapshots) as $k) {
            if (strpos($k, (int)$tableId . '|') === 0) unset($this->snapshots[$k]);
        }
        unset($this->names[(int)$tableId]);
    }

    /** Названия (первая колонка) записей таблицы-справочника. */
    public function names($tableId)
    {
        if (!isset($this->names[$tableId])) {
            $this->names[$tableId] = array();
            foreach ($this->ig->readAll($tableId) as $r) $this->names[$tableId][(string)$r[0]] = true;
        }
        return $this->names[$tableId];
    }

    /** Все записи сущности с полной загрузкой (кэш на запуск; from_entity — записи другой сущности). */
    public function sourceRecords($name)
    {
        $ent = $this->entity($name);
        if (isset($ent['source']['from_entity'])) {
            if (empty($ent['source']['collection'])) return $this->sourceRecords($ent['source']['from_entity']);
            return $this->collectionRecords($name, $ent['source']['from_entity'], $ent['source']['collection']);
        }
        if (!isset($this->sourceCache[$name])) {
            $all = array();
            $adapter = $this->sourceFor($name);
            $select = array_keys(EntitySync::sourceFields($ent));
            foreach ($this->cfg['entities'] as $other) {   // табличные части, которые возьмут дочерние сущности
                if (arr_get($other, 'source.from_entity') === $name && !empty($other['source']['collection'])) $select[] = $other['source']['collection'];
            }
            $query = array('period' => arr_get($ent, 'load.period'));
            $adapter->each($ent['source'], $query, array_values(array_unique($select)), function ($items) use (&$all) {
                foreach ($items as $it) $all[] = $it;
            });
            $this->sourceCache[$name] = $all;
            Log::info("[$name] получено из «{$adapter->name()}»: " . count($all));
        }
        return $this->sourceCache[$name];
    }

    /** Строки табличной части: записи коллекции родителей, у каждой __parent = внешний ключ родителя. */
    private function collectionRecords($name, $parentName, $collection)
    {
        $pe = $this->entity($parentName);
        $keyField = null;
        foreach ($pe['fields'] as $fname => $spec) {
            if ($spec['column'] === $pe['target']['key'] && empty($spec['ref'])) $keyField = Transform::sourceField($spec, $fname);
        }
        if ($keyField === null) throw new ConnectorException("сущность $name: у родителя $parentName нет поля ключа «{$pe['target']['key']}»");
        $out = array();
        foreach ($this->sourceRecords($parentName) as $prec) {
            if (empty($prec[$collection]) || !is_array($prec[$collection])) continue;
            foreach ($prec[$collection] as $row) {
                if (!is_array($row)) continue;
                $row['__parent'] = Transform::scalar(isset($prec[$keyField]) ? $prec[$keyField] : '');
                $out[] = $row;
            }
        }
        return $out;
    }
}

class Runner
{
    /** Предел сна перед отдачей повтора по URL, секунд (см. runWeb). */
    const WEB_REPEAT_SLEEP_MAX = 7;

    const USAGE = <<<TXT
Коннектор источников (Битрикс24, 1С OData) → Интеграм

  Проект в папке коннектора:
    php b24ig.php --config=config/<проект>.json [опции]
  База на сервере Интеграма (конфиг templates/custom/<база>/connector/<имя>.json):
    php b24ig.php --db=<база> --config=<имя> [опции]
  По URL (из опций доступны только only, dry_run, check; JSON — отчёт в JSON):
    https://<сервер>/b24ig.php?db=<база>&config=<имя>[&only=a,b][&dry_run][&check][&JSON]
  Подбор соответствия полей (рабочее место «Коннектор»), POST {"source":[[поле,подпись],…],"target":[колонка,…]}:
    https://<сервер>/b24ig.php?action=match&db=<база>&config=<имя>

  --only=a,b            загрузить только эти сущности (порядок из конфига сохраняется)
  --dry-run             ничего не записывать в Интеграм и состояние
  --bki-dir=DIR         сохранить файлы импорта в DIR (удобно вместе с --dry-run)
  --check               только проверить схемы Интеграма и источников
  --allow-mass-create   разрешить полной загрузке создать много новых записей (первый запуск)
  --reset=a,b           сбросить состояние загрузки сущностей и выйти
  --site-root=DIR       корень сайта Интеграма (по умолчанию — папка b24ig.php)

Коды выхода: 0 — успех (или предыдущий запуск ещё идёт), 1 — были ошибки, 2 — неверный запуск.

TXT;

    const NAME_MASK = '/^[A-Za-z0-9_-]{1,64}$/';

    /** Пути для базы на сервере Интеграма. Имена по маске — через URL не прочитать чужой файл. */
    public static function dbPaths($siteRoot, $db, $config)
    {
        if (!preg_match(self::NAME_MASK, (string)$db)) throw new ConnectorException('неверное имя базы');
        if (!preg_match(self::NAME_MASK, (string)$config)) throw new ConnectorException('неверное имя конфига');
        $dir = rtrim($siteRoot, '/') . "/templates/custom/$db/connector";
        return array('data_root' => $dir, 'config' => "$dir/$config.json", 'default' => "$dir/$config.default.json",
            'secrets' => "$dir/secrets.json");
    }

    /**
     * Рабочий конфиг базы живёт на сервере и правится из UI коннектора; из репо деплоится только
     * эталон <имя>.default.json. Рабочего нет — один раз создаём его из эталона, дальше деплой
     * эталона рабочий конфиг не трогает (issue #5061). true — конфиг создан.
     */
    public static function seedConfig(array $p)
    {
        if (is_file($p['config']) || !is_file($p['default'])) return false;
        if (!@copy($p['default'], $p['config'])) return false;
        @chmod($p['config'], 0664);   // cron и UI (dir_admin) могут работать от разных пользователей
        return true;
    }

    /**
     * Подбор соответствия полей (рабочее место «Коннектор»): браузер → b24ig.php → эмбеддер.
     * Эмбеддер один на все базы: адрес и токен — в include/b24ig/embedder.json на сервере
     * ({"url": "...", "token": "..."}, в git не хранится, include/ закрыт от веб-доступа); в браузер
     * не отдаются и в БД не хранятся. Тело POST: {"source":[[поле, подпись],…],"target":[колонка,…]}.
     * $http, $siteRoot — только для тестов: подмена HTTP-вызова (сигнатура Http::request) и корня сайта.
     * @return array [HTTP-код, ответ]; ответ — {ok:true, matches, fields, manual} или {ok:false, error}
     */
    public static function match(array $get, $body, $http = null, $siteRoot = null)
    {
        $fail = function ($code, $msg) { return array($code, array('ok' => false, 'error' => $msg)); };
        $db = isset($get['db']) ? (string)$get['db'] : '';
        $config = isset($get['config']) ? (string)$get['config'] : '';
        if ($db === '' || $config === '') return $fail(400, 'нужны параметры db и config');

        $in = json_decode((string)$body, true);
        $source = array();
        $target = array();
        foreach (is_array($in) && isset($in['source']) && is_array($in['source']) ? $in['source'] : array() as $f) {
            if (is_array($f) && isset($f[0]) && is_scalar($f[0]) && (string)$f[0] !== '') {
                $source[] = array((string)$f[0], isset($f[1]) && is_scalar($f[1]) ? (string)$f[1] : '');
            }
        }
        foreach (is_array($in) && isset($in['target']) && is_array($in['target']) ? $in['target'] : array() as $c) {
            if (is_scalar($c) && (string)$c !== '') $target[] = (string)$c;
        }
        if (!$source || !$target) return $fail(400, 'в теле POST нужны source [[поле, подпись], …] и target [колонка, …]');
        if (count($source) > 500 || count($target) > 500) return $fail(400, 'слишком много полей или колонок (не больше 500)');

        try {
            if ($siteRoot === null) $siteRoot = defined('B24IG_ROOT') ? B24IG_ROOT : dirname(__DIR__);
            $p = self::dbPaths($siteRoot, $db, $config);
            self::seedConfig($p);
            if (!is_file($p['config'])) return $fail(404, "конфиг «{$config}» базы «{$db}» не найден");
            $secrets = is_file($p['secrets']) ? json_decode(file_get_contents($p['secrets']), true) : array();
            if (!is_array($secrets)) return $fail(500, 'secrets.json базы: ошибка JSON');
            $cfg = self::loadConfig($p['config'], $secrets);
        } catch (ConnectorException $e) {
            return $fail(400, $e->getMessage());
        }
        $td = (string)arr_get($cfg, 'target.db');
        if ($td !== '' && $td !== $db) return $fail(400, 'target.db конфига не совпадает с текущей базой');

        $embFile = $siteRoot . '/include/b24ig/embedder.json';
        $emb = is_file($embFile) ? json_decode(file_get_contents($embFile), true) : array();
        if (!is_array($emb)) return $fail(500, 'include/b24ig/embedder.json: ошибка JSON');
        $url = isset($emb['url']) && is_string($emb['url']) ? trim($emb['url']) : '';
        if ($url === '') return $fail(503, 'эмбеддер не настроен: нет адреса (url) в include/b24ig/embedder.json');
        $headers = array('Content-Type: application/json');
        if (isset($emb['token']) && is_string($emb['token']) && $emb['token'] !== '') {
            $headers[] = 'Authorization: Bearer ' . $emb['token'];
        }
        $payload = json_encode(array('source' => $source, 'target' => $target), JSON_UNESCAPED_UNICODE);
        $r = $http ? call_user_func($http, 'POST', $url, $headers, $payload, 40)
                   : Http::request('POST', $url, $headers, $payload, 40);
        // адрес и токен в текст ошибки не попадают
        if ($r['code'] !== 200) return $fail(502, 'эмбеддер: ' . ($r['code'] ? 'HTTP ' . $r['code'] : 'нет связи'));
        $m = json_decode($r['body'], true);
        if (!is_array($m) || !isset($m['matches'])) return $fail(502, 'эмбеддер: неожиданный ответ');
        $out = array('ok' => true);
        foreach (array('matches', 'fields', 'manual') as $k) {
            if (isset($m[$k])) $out[$k] = $m[$k];
        }
        return array(200, $out);
    }

    public static function cli(array $argv)
    {
        $opts = array();
        foreach (array_slice($argv, 1) as $a) {
            if (!preg_match('/^--([a-z-]+)(?:=(.*))?$/', $a, $m)) {
                fwrite(STDERR, "неизвестный аргумент: $a\n" . self::USAGE);
                return 2;
            }
            $opts[str_replace('-', '_', $m[1])] = isset($m[2]) ? $m[2] : true;
        }
        if (!empty($opts['help']) || empty($opts['config'])) {
            fwrite(empty($opts['help']) ? STDERR : STDOUT, self::USAGE);
            return empty($opts['help']) ? 2 : 0;
        }
        $code = self::run($opts);
        return $code === 3 ? 0 : $code;   // для cron «уже идёт» — не ошибка
    }

    /** Запуск по URL. Параметры, способные навредить (массовое создание, сброс, пути), не принимаются. */
    public static function web(array $get)
    {
        // подбор соответствия полей для рабочего места «Коннектор» — отдельный короткий JSON-ответ
        if (isset($get['action']) && $get['action'] === 'match') {
            list($code, $out) = self::match($get, (string)file_get_contents('php://input'));
            http_response_code($code);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode($out, JSON_UNESCAPED_UNICODE);
            return $code === 200 ? 0 : 2;
        }
        ignore_user_abort(true);
        @set_time_limit(0);
        $json = isset($get['JSON']);
        // лог копится в буфере: код ответа (400/409/500) известен только после запуска,
        // а первая же отправленная строка зафиксировала бы 200
        ob_start();
        header($json ? 'Content-Type: application/json; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8');
        // по URL подробный лог (названия и ключи записей, примеры в предупреждениях) в ответ НЕ отдаём —
        // он пишется только в файл; в ответ уходит сводка. URL открыт (по решению админа), данные наружу не течём.
        Log::$web = false;
        Log::$quiet = true;

        $opts = array('db' => isset($get['db']) ? (string)$get['db'] : '', 'config' => isset($get['config']) ? (string)$get['config'] : '', 'web' => true);
        foreach (array('dry_run', 'check') as $k) {
            if (isset($get[$k])) $opts[$k] = true;
        }
        if (isset($get['only']) && preg_match('/^[A-Za-z0-9_,-]{1,256}$/', (string)$get['only'])) $opts['only'] = (string)$get['only'];

        $stamp = null;
        if ($opts['db'] === '' || $opts['config'] === '') {
            $code = 2;
            $summary = self::webReport(array('errors' => array(array('entity' => null, 'kind' => 'bad_request', 'message' => 'нужны параметры db и config'))));
            Log::error('нужны параметры db и config');
        } else {
            $codeRoot = defined('B24IG_ROOT') ? B24IG_ROOT : dirname(__DIR__);
            list($code, $summary, $stamp) = self::runWeb($opts, $codeRoot, function ($o, &$r) { return Runner::run($o, $r); });
        }
        $status = array(0 => 200, 1 => 500, 2 => 400, 3 => 409);
        http_response_code($status[$code]);
        if ($stamp) {
            $summary['cached'] = $stamp['cached'];
            // UTC: у повтора пояс конфига не выставлялся (run() не вызывался) — время должно совпадать у обоих ответов
            $summary['result_at'] = gmdate('Y-m-d\TH:i:s\Z', $stamp['result_at']);
            $summary['next_run_after'] = gmdate('Y-m-d\TH:i:s\Z', $stamp['next_run_after']);
        }
        echo $json ? json_encode($summary, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) : self::webText($summary, $code);
        ob_end_flush();
        return $code;
    }

    /**
     * Запуск по URL не чаще runtime.min_interval_sec конфига базы (решение Алексея 29.09): URL открыт, поэтому
     * внутри интервала отдаётся последний результат того же режима (запуск / check / dry_run, с учётом only)
     * со штампом времени, а реального запуска нет. Штамп протух — результат удаляется, идёт реальный запуск.
     * Правка конфига (например, «Сохранить соответствие») меняет хэш файла и сбрасывает запомненный результат.
     * «Уже выполняется» (код 3) и неверный запрос (код 2) не запоминаются. Без min_interval_sec — как раньше.
     * Повтор отдаётся не сразу: спит столько, сколько шёл последний реальный запуск (длительность хранится со
     * штампом), но не больше WEB_REPEAT_SLEEP_MAX секунд (Алексей 29.09) — по времени ответа повтор не отличить.
     * $runner(opts, &report) → код run(); $now, $sleep(секунды) — только для тестов.
     * @return array [код, сводка webReport, штамп {cached, result_at, next_run_after, seconds} или null]
     */
    public static function runWeb(array $opts, $siteRoot, $runner, $now = null, $sleep = null)
    {
        $now = $now === null ? time() : (int)$now;
        $cache = self::webCache($opts, $siteRoot);
        if ($cache) {
            list($file, $interval, $hash) = $cache;
            $last = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
            if (is_array($last) && isset($last['at'], $last['code'], $last['summary'], $last['hash']) && $last['hash'] === $hash
                && $now >= (int)$last['at'] && $now - (int)$last['at'] < $interval) {
                $sec = isset($last['seconds']) ? max(0.0, (float)$last['seconds']) : 0.0;
                $pause = min((float)self::WEB_REPEAT_SLEEP_MAX, $sec);
                if ($pause > 0) {
                    if ($sleep) call_user_func($sleep, $pause);
                    else usleep((int)round($pause * 1000000));
                }
                return array((int)$last['code'], $last['summary'], array('cached' => true, 'result_at' => (int)$last['at'],
                    'next_run_after' => (int)$last['at'] + $interval, 'seconds' => $sec));
            }
            if (is_file($file)) @unlink($file);   // штамп протух или конфиг изменён — прежний результат удаляется
        }
        $report = null;
        $t = microtime(true);
        $code = call_user_func_array($runner, array($opts, &$report));
        $sec = round(microtime(true) - $t, 3);
        $summary = self::webReport(is_array($report) ? $report : array());
        if (!$cache || ($code !== 0 && $code !== 1)) return array($code, $summary, null);
        if (!is_dir(dirname($file))) @mkdir(dirname($file), 0775, true);
        @file_put_contents($file, json_encode(array('at' => $now, 'code' => $code, 'hash' => $hash, 'seconds' => $sec,
            'summary' => $summary), JSON_UNESCAPED_UNICODE));
        return array($code, $summary, array('cached' => false, 'result_at' => $now, 'next_run_after' => $now + $interval,
            'seconds' => $sec));
    }

    /** Файл последнего результата, интервал и хэш конфига; null — интервал не задан или конфиг не читается. */
    private static function webCache(array $opts, $siteRoot)
    {
        try {
            $p = self::dbPaths($siteRoot, $opts['db'], $opts['config']);
            self::seedConfig($p);
            if (!is_file($p['config'])) return null;
            $text = (string)file_get_contents($p['config']);
            $secrets = is_file($p['secrets']) ? json_decode(file_get_contents($p['secrets']), true) : array();
            $cfg = self::loadConfig($p['config'], is_array($secrets) ? $secrets : array());
            $interval = (int)arr_get($cfg, 'runtime.min_interval_sec', 0);
            if ($interval <= 0) return null;
            $dir = self::dataPath($p['data_root'], arr_get($cfg, 'runtime.state_dir', 'state/' . $cfg['project']), true);
        } catch (Exception $e) {
            return null;   // конфиг с ошибкой — запуск сам о ней сообщит
        }
        $mode = !empty($opts['check']) ? 'check' : (!empty($opts['dry_run']) ? 'dry_run' : 'run');
        if (!empty($opts['only'])) $mode .= '-' . preg_replace('/[^A-Za-z0-9_-]/', '_', (string)$opts['only']);
        return array("$dir/web-last-$mode.json", $interval, sha1($text));
    }

    /** Сводка для ответа по URL: счётчики и ошибки без построчных данных (предупреждения и привязки — числами). */
    private static function webReport(array $r)
    {
        $ents = array();
        foreach ((isset($r['entities']) ? $r['entities'] : array()) as $name => $s) {
            $ents[$name] = array(
                'fetched' => $s['fetched'], 'rows' => $s['rows'], 'new' => $s['new'], 'existing' => $s['existing'],
                'unchanged' => $s['unchanged'], 'files' => $s['files'], 'refs_set' => $s['refs_set'], 'bound' => $s['bound'],
                'seconds' => isset($s['seconds']) ? $s['seconds'] : 0,
                'manual_binding' => count($s['manual_binding']), 'warnings' => count($s['warnings']),
            );
        }
        return array(
            'project' => isset($r['project']) ? $r['project'] : null,
            'ok' => empty($r['errors']) && empty($r['busy']),
            'busy' => !empty($r['busy']),
            'entities' => $ents,
            'errors' => isset($r['errors']) ? $r['errors'] : array(),   // kind/entity/message (о схеме и параметрах, не данные записей)
            'log_counts' => isset($r['log_counts']) ? $r['log_counts'] : null,
        );
    }

    private static function webText(array $s, $code)
    {
        $out = 'project: ' . ($s['project'] === null ? '-' : $s['project']) . "\n";
        $out .= 'status: ' . ($code === 0 ? 'ok' : ($code === 3 ? 'busy' : 'errors')) . "\n";
        if (isset($s['result_at'])) {
            $out .= 'результат от ' . $s['result_at'] . (empty($s['cached']) ? '' : ' (повтор последнего запуска)')
                . ', следующий реальный запуск — после ' . $s['next_run_after'] . "\n";
        }
        foreach ($s['entities'] as $name => $e) {
            $out .= "$name: получено {$e['fetched']}, строк {$e['rows']} (новых {$e['new']}, существующих {$e['existing']}, без изменений {$e['unchanged']}), ссылок {$e['refs_set']}, файлов {$e['files']}\n";
        }
        foreach ($s['errors'] as $er) {
            $out .= 'ОШИБКА [' . $er['kind'] . ']' . (empty($er['entity']) ? '' : ' ' . $er['entity']) . ': ' . (isset($er['message']) ? $er['message'] : '') . "\n";
        }
        return $out;
    }

    public static function loadConfig($file, array $secrets = array())
    {
        if (!is_file($file)) throw new ConnectorException("конфиг не найден: $file");
        $cfg = json_decode(file_get_contents($file), true);
        if (!is_array($cfg)) throw new ConnectorException("конфиг $file: ошибка JSON — " . json_last_error_msg());
        // ${ИМЯ}: сначала переменная окружения, затем secrets.json базы (у cron по URL своего окружения нет)
        array_walk_recursive($cfg, function (&$v) use ($secrets) {
            if (is_string($v)) {
                $v = preg_replace_callback('/\$\{([A-Z0-9_]+)\}/', function ($m) use ($secrets) {
                    $e = getenv($m[1]);
                    if ($e !== false && $e !== '') return $e;
                    return isset($secrets[$m[1]]) ? (string)$secrets[$m[1]] : '';
                }, $v);
            }
        });
        if (isset($cfg['source']) && !isset($cfg['sources'])) {   // формат v1: один источник
            $cfg['sources'] = array('default' => $cfg['source']);
        }
        unset($cfg['source']);
        foreach (array('project', 'sources', 'target', 'order', 'entities') as $k) {
            if (empty($cfg[$k])) throw new ConnectorException("в конфиге нет ключа $k");
        }
        return $cfg;
    }

    /** @return int 0 — успех, 1 — ошибки загрузки, 2 — неверный запуск, 3 — предыдущий запуск ещё идёт */
    public static function run(array $opts, &$report = null)
    {
        $codeRoot = defined('B24IG_ROOT') ? B24IG_ROOT : dirname(__DIR__);
        $report = array('project' => null, 'started' => date('c'), 'options' => $opts, 'entities' => array(), 'errors' => array());
        try {
            if (!empty($opts['db'])) {
                $p = self::dbPaths(isset($opts['site_root']) ? $opts['site_root'] : $codeRoot, $opts['db'], $opts['config']);
                self::seedConfig($p);
                if (!is_file($p['config'])) throw new ConnectorException("конфиг «{$opts['config']}» базы «{$opts['db']}» не найден");
                $secrets = is_file($p['secrets']) ? json_decode(file_get_contents($p['secrets']), true) : array();
                if (!is_array($secrets)) throw new ConnectorException('secrets.json базы: ошибка JSON');
                $cfg = self::loadConfig($p['config'], $secrets);
                // База — текущая, из URL/--db. В конфиге target.db указывать не нужно; если указан —
                // должен совпадать (защита от чужого конфига, скопированного в другую базу).
                $td = (string)arr_get($cfg, 'target.db');
                if ($td === '') $cfg['target']['db'] = $opts['db'];
                elseif ($td !== $opts['db']) throw new ConnectorException("target.db конфига («{$td}») не совпадает с текущей базой «{$opts['db']}» — уберите target.db (возьмётся текущая) или исправьте");
                $dataRoot = $p['data_root'];
                self::protectDir($dataRoot);   // второй барьер: secrets.json/логи не отдаются веб-сервером
            } else {
                $cfg = self::loadConfig($opts['config']);
                if ((string)arr_get($cfg, 'target.db') === '') throw new ConnectorException('в проектном режиме (--config без --db) в конфиге нужен target.db');
                $dataRoot = $codeRoot;
            }
            $confine = !empty($opts['db']);
            $logDir = self::dataPath($dataRoot, arr_get($cfg, 'runtime.log_dir', 'logs/' . $cfg['project']), $confine);
            $lockFile = self::dataPath($dataRoot, arr_get($cfg, 'runtime.lock_file', 'state/' . $cfg['project'] . '/run.lock'), $confine);
        } catch (Exception $e) {
            $report['errors'][] = array('entity' => null, 'kind' => 'bad_request', 'message' => $e->getMessage());
            Log::error($e->getMessage());
            return 2;
        }

        $report['project'] = $cfg['project'];
        $firstSource = reset($cfg['sources']);
        date_default_timezone_set(arr_get($cfg, 'runtime.timezone', isset($firstSource['timezone']) ? $firstSource['timezone'] : 'UTC'));
        Log::init($logDir, (int)arr_get($cfg, 'runtime.log_keep_days', 0));

        $lock = new Lock();
        if (!$lock->acquire($lockFile)) {
            Log::info('предыдущий запуск ещё работает — выходим');
            $report['busy'] = true;
            return 3;
        }

        try {
            $ctx = new Context($cfg, $dataRoot, $opts, $codeRoot);
            if (!empty($opts['reset']) && empty($opts['web'])) {
                foreach (explode(',', $opts['reset']) as $e) {
                    $ctx->state->reset(trim($e));
                    Log::info("состояние $e сброшено");
                }
                $lock->release();
                return 0;
            }
            $only = !empty($opts['only']) ? array_map('trim', explode(',', $opts['only'])) : null;
            Log::info("старт {$cfg['project']}" . ($ctx->dryRun ? ' (пробный запуск)' : '') . (!empty($opts['check']) ? ' (проверка схем)' : ''));

            foreach ($cfg['order'] as $name) {
                $ent = $ctx->entity($name);
                if (($only && !in_array($name, $only, true)) || arr_get($ent, 'enabled', true) === false) continue;
                $t0 = microtime(true);
                try {
                    $stats = (new EntitySync($name, $ent, $ctx))->run();
                    $stats['seconds'] = round(microtime(true) - $t0, 1);
                    $report['entities'][$name] = $stats;
                    Log::info(sprintf('[%s] готово за %.1f с: получено %d, строк %d (новых %d, существующих %d, без изменений %d), привязано %d, ссылок %d, файлов %d',
                        $name, $stats['seconds'], $stats['fetched'], $stats['rows'], $stats['new'], $stats['existing'], $stats['unchanged'], $stats['bound'], $stats['refs_set'], $stats['files']));
                } catch (Exception $e) {
                    $kind = $e instanceof SchemaDriftException ? 'schema_drift' : ($e instanceof SafetyException ? 'safety' : 'error');
                    $report['errors'][] = array('entity' => $name, 'kind' => $kind, 'message' => $e->getMessage());
                    Log::error("[$name] $kind: " . $e->getMessage());
                }
            }
        } catch (Exception $e) {
            $report['errors'][] = array('entity' => null, 'kind' => 'error', 'message' => $e->getMessage());
            Log::error($e->getMessage());
        }

        $report['finished'] = date('c');
        $report['log_counts'] = Log::$counts;
        file_put_contents($logDir . '/last-report.json', json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        self::notify($cfg, $report);
        $lock->release();
        Log::info('итог: ошибок ' . count($report['errors']));
        return $report['errors'] ? 1 : 0;
    }

    private static function abs($root, $p) { return $p !== '' && $p[0] === '/' ? $p : $root . '/' . $p; }

    /** В папке базы лежат secrets.json и логи — закрываем их от веб-сервера (Apache 2.4 и 2.2). */
    private static function protectDir($dir)
    {
        $f = $dir . '/.htaccess';
        if (is_dir($dir) && !is_file($f)) {
            @file_put_contents($f, "Require all denied\n<IfModule !mod_authz_core.c>\nOrder allow,deny\nDeny from all\n</IfModule>\n");
        }
    }

    /** Как abs(), но при запуске для базы ($confine) запрещает абсолютные пути и .. — файлы только в папке базы. */
    private static function dataPath($root, $p, $confine)
    {
        if ($confine) {
            if ($p === '' || $p[0] === '/' || $p[0] === '\\' || preg_match('~(^|[/\\\\])\.\.([/\\\\]|$)~', $p)) {
                throw new ConnectorException("путь «{$p}» должен быть внутри папки базы, без .. и абсолютных путей");
            }
            return $root . '/' . $p;
        }
        return self::abs($root, $p);
    }

    private static function notify(array $cfg, array $report)
    {
        if (!arr_get($cfg, 'notify.enabled', false)) return;
        $on = arr_get($cfg, 'notify.on', array('error'));
        $lines = array();
        foreach ($report['errors'] as $e) {
            if (in_array($e['kind'], $on, true) || in_array('error', $on, true)) $lines[] = "❌ {$e['entity']}: {$e['message']}";
        }
        if (in_array('manual_binding_required', $on, true)) {
            foreach ($report['entities'] as $name => $s) {
                if (!empty($s['manual_binding'])) $lines[] = "✋ $name: нужна ручная привязка — " . count($s['manual_binding']) . ' записей';
            }
        }
        if (!$lines) return;
        $text = "Коннектор {$cfg['project']} (база " . arr_get($cfg, 'target.db') . ")\n" . implode("\n", $lines);
        $r = Http::request('POST', 'https://api.telegram.org/bot' . $cfg['notify']['telegram_bot_token'] . '/sendMessage', array(),
            http_build_query(array('chat_id' => $cfg['notify']['telegram_chat_id'], 'text' => mb_substr($text, 0, 4000))), 20);
        if ($r['code'] !== 200) Log::warn("уведомление не отправлено: HTTP {$r['code']}");
    }
}
