<?php

class IntegramClient
{
    private $base;
    private $token;
    private $time;
    private $xsrf = null;

    public function __construct(array $cfg)
    {
        if (empty($cfg['token'])) throw new ConnectorException('target.token пуст: задайте переменную окружения из конфига');
        $this->base = rtrim($cfg['base_url'], '/') . '/' . $cfg['db'];
        $this->token = $cfg['token'];
        $this->time = isset($cfg['request_time_sec']) ? (int)$cfg['request_time_sec'] : 120;
    }

    private function url($path)
    {
        // TIME — предел выполнения запроса на сервере (по умолчанию 30 с)
        return $this->base . '/' . $path . (strpos($path, '?') === false ? '?' : '&') . 'TIME=' . $this->time;
    }

    private function decode(array $r, $what)
    {
        if ($r['error'] !== '') throw new ConnectorException("Интеграм $what: {$r['error']}");
        $data = json_decode($r['body'], true);
        if ($r['code'] >= 400 || !is_array($data)) {
            $text = trim(preg_replace('/\s+/u', ' ', strip_tags($r['body'])));
            throw new ConnectorException("Интеграм $what: HTTP {$r['code']} " . substr($text, 0, 300));
        }
        $first = (isset($data[0]) && is_array($data[0])) ? $data[0] : $data;
        if (isset($first['error'])) throw new ConnectorException("Интеграм $what: " . $first['error']);
        return $data;
    }

    public function get($path)
    {
        $r = Http::request('GET', $this->url($path), array('X-Authorization: ' . $this->token), null, $this->time + 30);
        return $this->decode($r, "GET " . strtok($path, '?'));
    }

    public function post($path, array $fields, $filePath = null)
    {
        $fields['token'] = $this->token;
        $fields['_xsrf'] = $this->xsrf();
        if ($filePath !== null) {
            $fields['bki_file'] = new CURLFile($filePath, 'text/plain', 'import.bki');
            $body = $fields;                      // multipart/form-data
        } else {
            $body = http_build_query($fields);   // application/x-www-form-urlencoded
        }
        $r = Http::request('POST', $this->url($path), array('X-Authorization: ' . $this->token), $body, $this->time + 30);
        return $this->decode($r, "POST " . strtok($path, '?'));
    }

    public function xsrf()
    {
        if ($this->xsrf === null) {
            $d = $this->get('xsrf?JSON');
            $this->xsrf = $d['_xsrf'];
        }
        return $this->xsrf;
    }

    public function metadata($tableId)
    {
        return $this->get('metadata/' . (int)$tableId . '?JSON=1');
    }

    /** Все записи таблицы: [id записи => r[]], страницами LIMIT=смещение,размер. */
    public function readAll($tableId, $page = 500)
    {
        $out = array();
        for ($offset = 0; ; $offset += $page) {
            $rows = $this->get('object/' . (int)$tableId . "?JSON_OBJ&LIMIT=$offset,$page");
            foreach ($rows as $row) $out[(int)$row['i']] = $row['r'];
            if (count($rows) < $page) break;
        }
        return $out;
    }

    /** Строки подчинённой таблицы у записи-родителя: [id => r[]]. */
    public function readChildren($tableId, $parentId, $page = 500)
    {
        $out = array();
        for ($offset = 0; ; $offset += $page) {
            $rows = $this->get('object/' . (int)$tableId . '?JSON_OBJ&F_U=' . (int)$parentId . "&LIMIT=$offset,$page");
            foreach ($rows as $row) $out[(int)$row['i']] = $row['r'];
            if (count($rows) < $page) break;
        }
        return $out;
    }

    /** Импорт файла. Возвращает текст предупреждения ядра (если есть). */
    public function import($tableId, $content, array $extra = array())
    {
        $tmp = tempnam(sys_get_temp_dir(), 'bki');
        file_put_contents($tmp, $content);
        try {
            $resp = $this->post('object/' . (int)$tableId . '?JSON&import=1', array_merge(array('import' => '1'), $extra), $tmp);
        } finally {
            unlink($tmp);
        }
        return isset($resp['warning']) ? trim(strip_tags((string)$resp['warning'])) : '';
    }

    public function mSet($recordId, array $fields)
    {
        $resp = $this->post('_m_set/' . (int)$recordId . '?JSON=1', $fields);
        // признак верной адресации: obj == id записи (docs/kb/crud.md)
        if (!isset($resp['obj']) || (int)$resp['obj'] !== (int)$recordId) {
            throw new ConnectorException("_m_set/$recordId: неожиданный ответ " . json_encode($resp, JSON_UNESCAPED_UNICODE));
        }
        return $resp;
    }

    public function mNew($tableId, array $fields)
    {
        if (!isset($fields['up'])) $fields['up'] = 1;
        return $this->post('_m_new/' . (int)$tableId . '?JSON=1', $fields);
    }

    public function mDel($recordId)
    {
        return $this->post('_m_del/' . (int)$recordId . '?JSON=1', array());
    }
}

/** Схема таблицы из metadata: колонки по имени (псевдониму) с позицией в r[]. */
class TableSchema
{
    public $id;
    public $name;
    public $unique;
    public $width;              // число колонок в строке импорта: первая + реквизиты
    public $columns = array();  // имя => колонка
    public $duplicateNames = array();

    public static function fromMetadata(array $m)
    {
        $s = new self();
        $s->id = (int)$m['id'];
        $s->name = (string)$m['val'];
        $s->unique = (string)$m['unique'] === '1';
        $pos = 0;
        foreach ($m['reqs'] as $req) {
            $pos++;
            $attrs = isset($req['attrs']) ? (string)$req['attrs'] : '';
            $json = ($attrs !== '' && $attrs[0] === '{') ? json_decode($attrs, true) : null;
            $name = (string)$req['val'];
            if ($json && !empty($json['alias'])) $name = $json['alias'];
            elseif (preg_match('/:ALIAS=([^:]*):/u', $attrs, $mm)) $name = $mm[1];
            if (isset($s->columns[$name])) {
                $s->duplicateNames[$name] = true;
                continue;
            }
            $s->columns[$name] = array(
                'name' => $name,
                'req' => (int)$req['id'],
                'pos' => $pos,
                'type' => (string)$req['type'],
                'ref' => isset($req['ref']) ? (int)$req['ref'] : 0,
                'arr' => isset($req['arr_id']) ? (int)$req['arr_id'] : 0,   // колонка подчинённой таблицы
                'multi' => ($json && !empty($json['multi'])) || stripos($attrs, ':MULTI:') !== false,
                'key' => ($json && !empty($json['key'])) || stripos($attrs, ':KEY:') !== false,
            );
        }
        $s->width = $pos + 1;
        return $s;
    }

    public function column($name)
    {
        if ($name === '@name') {
            return array('name' => '@name', 'req' => $this->id, 'pos' => 0, 'type' => '', 'ref' => 0, 'multi' => false, 'key' => $this->unique);
        }
        return isset($this->columns[$name]) ? $this->columns[$name] : null;
    }

    /** «2862,2863:HR,IT» → [2862, 2863] */
    public static function refIds($value)
    {
        $value = (string)$value;
        if ($value === '' || strpos($value, ':') === false) return array();
        $ids = array();
        foreach (explode(',', substr($value, 0, strpos($value, ':'))) as $id) {
            if (ctype_digit(trim($id))) $ids[] = (int)$id;
        }
        return $ids;
    }
}
