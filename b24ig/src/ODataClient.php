<?php
/** HTTP-клиент стандартного интерфейса OData 1С:Предприятия (только чтение, Basic-авторизация). */
class ODataClient
{
    private $url;
    private $auth;
    private $timeout;
    private $retries;

    public function __construct(array $cfg)
    {
        if (empty($cfg['url'])) throw new ConnectorException('url OData 1С не задан');
        if (!isset($cfg['user']) || $cfg['user'] === '') throw new ConnectorException('user OData 1С пуст: задайте переменную окружения из конфига');
        $this->url = rtrim($cfg['url'], '/') . '/';
        $this->auth = 'Authorization: Basic ' . base64_encode($cfg['user'] . ':' . (isset($cfg['password']) ? $cfg['password'] : ''));
        $this->timeout = isset($cfg['timeout_sec']) ? (int)$cfg['timeout_sec'] : 60;
        $this->retries = isset($cfg['retries']) ? (int)$cfg['retries'] : 3;
    }

    /** Записи набора: $params — параметры OData ($top, $skip, $filter, $select, $orderby). */
    public function get($entity, array $params)
    {
        $params['$format'] = 'json';
        return $this->request(self::path($entity, $params), 'application/json', true);
    }

    public function metadataXml()
    {
        return $this->request('$metadata', 'application/xml', false);
    }

    /** Имя набора и значения кодируются, «$» в именах параметров остаётся как есть. */
    public static function path($entity, array $params)
    {
        $q = array();
        foreach ($params as $k => $v) $q[] = $k . '=' . rawurlencode((string)$v);
        return rawurlencode($entity) . ($q ? '?' . implode('&', $q) : '');
    }

    private function request($path, $accept, $json)
    {
        $last = '';
        for ($attempt = 0; $attempt <= $this->retries; $attempt++) {
            if ($attempt > 0) sleep(min(30, 2 * $attempt));
            $r = Http::request('GET', $this->url . $path, array($this->auth, 'Accept: ' . $accept), null, $this->timeout);
            if ($r['error'] !== '' || $r['code'] === 0 || $r['code'] >= 500) {
                $last = "HTTP {$r['code']} {$r['error']}";
                continue;
            }
            if ($r['code'] === 401 || $r['code'] === 403) {
                throw new ConnectorException("OData 1С: доступ запрещён (HTTP {$r['code']}) — проверьте пользователя и права на чтение");
            }
            if ($r['code'] >= 400) throw new ConnectorException("OData 1С " . strtok($path, '?') . ": HTTP {$r['code']} " . self::errorText($r['body']));
            if (!$json) return $r['body'];
            $data = json_decode($r['body'], true);
            if (!is_array($data)) {
                $last = 'ответ не JSON';
                continue;
            }
            return $data;
        }
        throw new ConnectorException('OData 1С ' . strtok($path, '?') . ": не удалось за {$this->retries} повтора ($last)");
    }

    private static function errorText($body)
    {
        $d = json_decode($body, true);
        if (isset($d['odata.error']['message']['value'])) return $d['odata.error']['message']['value'];
        return substr(trim(preg_replace('/\s+/u', ' ', strip_tags($body))), 0, 200);
    }
}
