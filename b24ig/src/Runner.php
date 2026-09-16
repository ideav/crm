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
            throw new ConnectorException("$what: путь «$rel» должен быть внутри папки базы, без .. и абсолютных путей");
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
    const USAGE = <<<TXT
Коннектор источников (Битрикс24, 1С OData) → Интеграм

  Проект в папке коннектора:
    php b24ig.php --config=config/<проект>.json [опции]
  База на сервере Интеграма (конфиг templates/custom/<база>/connector/<имя>.json):
    php b24ig.php --db=<база> --config=<имя> [опции]
  По URL (из опций доступны только only, dry_run, check; JSON — отчёт в JSON):
    https://<сервер>/b24ig.php?db=<база>&config=<имя>[&only=a,b][&dry_run][&check][&JSON]

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
        return array('data_root' => $dir, 'config' => "$dir/$config.json", 'secrets' => "$dir/secrets.json");
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

        $report = null;
        if ($opts['db'] === '' || $opts['config'] === '') {
            $code = 2;
            $report = array('errors' => array(array('entity' => null, 'kind' => 'bad_request', 'message' => 'нужны параметры db и config')));
            Log::error($report['errors'][0]['message']);
        } else {
            $code = self::run($opts, $report);
        }
        $status = array(0 => 200, 1 => 500, 2 => 400, 3 => 409);
        http_response_code($status[$code]);
        $summary = self::webReport(is_array($report) ? $report : array());
        echo $json ? json_encode($summary, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) : self::webText($summary, $code);
        ob_end_flush();
        return $code;
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
                if (!is_file($p['config'])) throw new ConnectorException("конфиг «{$opts['config']}» базы «{$opts['db']}» не найден");
                $secrets = is_file($p['secrets']) ? json_decode(file_get_contents($p['secrets']), true) : array();
                if (!is_array($secrets)) throw new ConnectorException('secrets.json базы: ошибка JSON');
                $cfg = self::loadConfig($p['config'], $secrets);
                if ((string)arr_get($cfg, 'target.db') !== $opts['db']) {
                    throw new ConnectorException("target.db конфига («" . arr_get($cfg, 'target.db') . "») не совпадает с базой «{$opts['db']}»");
                }
                $dataRoot = $p['data_root'];
                self::protectDir($dataRoot);   // второй барьер: secrets.json/логи не отдаются веб-сервером
            } else {
                $cfg = self::loadConfig($opts['config']);
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
                throw new ConnectorException("путь «$p» должен быть внутри папки базы, без .. и абсолютных путей");
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
