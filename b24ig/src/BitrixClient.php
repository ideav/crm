<?php
/** REST-клиент Битрикс24 (входящий вебхук). Логика чтения сущностей — в Bitrix24Source. */
class BitrixClient
{
    private $webhook;
    private $timeout;
    private $retries;
    private $interval;
    private $lastCall = 0.0;

    public function __construct(array $cfg)
    {
        if (empty($cfg['webhook'])) throw new ConnectorException('webhook Битрикса пуст: задайте переменную окружения из конфига');
        $this->webhook = rtrim($cfg['webhook'], '/') . '/';
        $this->timeout = isset($cfg['timeout_sec']) ? (int)$cfg['timeout_sec'] : 30;
        $this->retries = isset($cfg['retries']) ? (int)$cfg['retries'] : 3;
        $rps = isset($cfg['requests_per_sec']) ? (float)$cfg['requests_per_sec'] : 2;
        $this->interval = $rps > 0 ? 1.0 / $rps : 0;
    }

    /** Вызов REST-метода. Адрес вебхука в логи и исключения не попадает. */
    public function call($method, array $params = array())
    {
        $lastError = '';
        for ($attempt = 0; $attempt <= $this->retries; $attempt++) {
            if ($attempt > 0) sleep(min(30, 2 * $attempt));
            $wait = $this->lastCall + $this->interval - microtime(true);
            if ($wait > 0) usleep((int)($wait * 1000000));
            $this->lastCall = microtime(true);

            // JSON-тело, как в export_b3x.php: сохраняет true/false и отрицательные числа (start=-1)
            $r = Http::request('POST', $this->webhook . $method,
                array('Content-Type: application/json'), json_encode($params, JSON_UNESCAPED_UNICODE), $this->timeout);
            if ($r['error'] !== '' || $r['code'] === 0 || $r['code'] >= 500) {
                $lastError = "HTTP {$r['code']} {$r['error']}";
                continue;
            }
            $data = json_decode($r['body'], true);
            if (!is_array($data)) {
                $lastError = 'ответ не JSON: ' . substr($r['body'], 0, 200);
                continue;
            }
            if (isset($data['error'])) {
                $lastError = $data['error'] . (isset($data['error_description']) ? ': ' . $data['error_description'] : '');
                if (in_array($data['error'], array('QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT'), true)) continue;
                throw new ConnectorException("Битрикс $method: $lastError");
            }
            return $data;
        }
        throw new ConnectorException("Битрикс $method: не удалось за {$this->retries} повтора ($lastError)");
    }
}
