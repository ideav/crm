<?php

/** Справочники: перевод кодов Битрикса в названия, загружаются при каждом запуске. */
class Dictionaries
{
    private $cfg;
    private $ctx;
    private $maps = array();

    public function __construct(array $cfg, $ctx)
    {
        $this->cfg = $cfg;
        $this->ctx = $ctx;
    }

    public function name($dict, $code)
    {
        if (!isset($this->maps[$dict])) $this->load($dict);
        return isset($this->maps[$dict][$code]) ? $this->maps[$dict][$code] : null;
    }

    public function load($dict)
    {
        if (!isset($this->cfg[$dict])) throw new ConnectorException("справочник $dict не описан в dictionaries");
        $d = $this->cfg[$dict];
        try {
            $this->maps[$dict] = $this->fetch($d);
            Log::info("справочник $dict: " . count($this->maps[$dict]) . " значений ({$d['source']})");
        } catch (Exception $e) {
            if (empty($d['fallback_file'])) throw $e;
            Log::warn("справочник $dict: " . $e->getMessage() . " — беру запасной файл {$d['fallback_file']}");
            $this->maps[$dict] = $this->fallback($d['fallback_file']);
        }
    }

    private function fetch(array $d)
    {
        if ($d['source'] === 'static') return array_map('strval', $d['map']);
        $conn = $this->ctx->connection(isset($d['connection']) ? $d['connection'] : null, 'справочник');
        return $this->ctx->source($conn)->dictionary($d);
    }

    private function fallback($spec)
    {
        // Только JSON внутри папки базы и никогда require: конфиг пишет владелец базы через dir_admin,
        // подключение произвольного файла было бы выполнением его кода на сервере.
        $parts = explode('#', $spec, 2);
        $path = $this->ctx->dataFile($parts[0], 'fallback_file справочника');
        if (!is_file($path)) throw new ConnectorException("запасной файл справочника не найден: {$parts[0]}");
        $all = json_decode(file_get_contents($path), true);
        if (!is_array($all)) throw new ConnectorException("запасной файл справочника не JSON: {$parts[0]}");
        if (isset($parts[1])) $all = isset($all[$parts[1]]) ? $all[$parts[1]] : array();
        return array_map('strval', $all);
    }
}

/** Преобразования значений полей (fields[*].transform). */
class Transform
{
    private $dicts;
    public $unknown = array();   // справочник => [код => true] — коды без перевода

    public function __construct(Dictionaries $dicts) { $this->dicts = $dicts; }

    public static function scalar($v)
    {
        if ($v === null) return '';
        if (is_bool($v)) return $v ? 'Y' : 'N';
        if (is_array($v)) {
            $parts = array();
            foreach ($v as $x) {
                $s = is_array($x) ? (isset($x['VALUE']) ? (string)$x['VALUE'] : json_encode($x, JSON_UNESCAPED_UNICODE)) : (string)$x;
                if (trim($s) !== '') $parts[] = trim($s);
            }
            return implode(', ', $parts);
        }
        return trim(preg_replace('/\s+/u', ' ', (string)$v));
    }

    public static function sourceField(array $spec, $fieldName)
    {
        return isset($spec['from']) ? $spec['from'] : $fieldName;
    }

    public function raw(array $spec, $fieldName, array $record)
    {
        $src = self::sourceField($spec, $fieldName);
        return array_key_exists($src, $record) ? $record[$src] : null;
    }

    public function apply(array $spec, $fieldName, array $record)
    {
        $t = isset($spec['transform']) ? $spec['transform'] : '';

        if ($t === 'template') {
            $s = preg_replace_callback('/\{([A-Z0-9_]+)\}/', function ($m) use ($record) {
                return isset($record[$m[1]]) ? Transform::scalar($record[$m[1]]) : '';
            }, $spec['template']);
            return trim(preg_replace('/\s+/u', ' ', $s));
        }

        $v = $this->raw($spec, $fieldName, $record);

        if (strpos($t, 'dict:') === 0) {
            $dict = substr($t, 5);
            $out = array();
            foreach ((is_array($v) ? $v : array($v)) as $code) {
                $code = self::scalar($code);
                if ($code === '') continue;
                $name = $this->dicts->name($dict, $code);
                if ($name === null) {
                    $this->unknown[$dict][$code] = true;
                    $name = $code;
                }
                $out[] = $name;
            }
            return implode(', ', $out);
        }

        switch ($t) {
            case '':
            case 'datetime':   // ISO Битрикса ядро разбирает само, с учётом пояса
            case 'multifield': // [{VALUE: ...}, ...] → «a, b»
                return self::scalar($v);
            case 'number':
                return preg_match('/^-?\d+/', self::scalar($v), $m) ? $m[0] : '';
            case 'money':
                $s = str_replace(array(' ', ','), array('', '.'), self::scalar($v));
                return is_numeric($s) ? $s : '';
            case 'yn':
                if (is_bool($v)) return $v ? 'Y' : 'N';
                $s = strtoupper(self::scalar($v));
                if (in_array($s, array('Y', 'TRUE', '1'), true)) return 'Y';
                if (in_array($s, array('N', 'FALSE', '0'), true)) return 'N';
                return $s;
            case 'join':
                if (!is_array($v)) return self::scalar($v);
                $parts = array();
                foreach ($v as $x) if (($x = self::scalar($x)) !== '') $parts[] = $x;
                return implode(',', $parts);
        }
        throw new ConnectorException("неизвестное преобразование «{$t}»");
    }
}
