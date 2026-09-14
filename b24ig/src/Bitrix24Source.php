<?php
/** Адаптер Битрикс24: REST через входящий вебхук. */
class Bitrix24Source implements SourceAdapter
{
    private $name;
    private $client;

    /** @param BitrixClient|MockBitrix $client — любой объект с методом call($method, $params) */
    public function __construct($name, $client)
    {
        $this->name = $name;
        $this->client = $client;
    }

    public function name() { return $this->name; }

    /** Условия запроса → фильтр Битрикса (курсор id_gt добавляется при обходе страниц). */
    public static function filter(array $query)
    {
        $f = array();
        $p = isset($query['period']) ? $query['period'] : null;
        if (!empty($p['field'])) {
            if (!empty($p['from'])) $f['>=' . $p['field']] = $p['from'] . 'T00:00:00';
            if (!empty($p['to'])) $f['<=' . $p['field']] = $p['to'] . 'T23:59:59';
        }
        if (!empty($query['modified_gt']['field'])) $f['>' . $query['modified_gt']['field']] = $query['modified_gt']['since'];
        if (!empty($query['id_lte'])) $f['<=ID'] = (int)$query['id_lte'];
        return $f;
    }

    public function each(array $src, array $query, array $select, $callback)
    {
        $method = $src['method'];
        $path = isset($src['result_path']) ? $src['result_path'] : 'result';
        $camel = arr_get($src, 'response_keys') === 'camelCase';

        if (arr_get($src, 'pagination', 'start') === 'id_cursor') {
            $filter = self::filter($query);
            $last = isset($query['id_gt']) ? (int)$query['id_gt'] : 0;
            while (true) {
                $f = $filter;
                if ($last > 0) $f['>ID'] = $last;
                $params = array('filter' => $f, 'order' => array('ID' => 'ASC'));
                if ($select) $params['select'] = $select;
                if (strpos($method, 'crm.') === 0) $params['start'] = -1; // без подсчёта total — быстрее
                $items = $this->extract($this->client->call($method, $params), $path, $camel);
                if (!$items) break;
                $max = $last;
                foreach ($items as $it) $max = max($max, (int)$it['ID']);
                if ($max <= $last) throw new ConnectorException("$method: курсор ID не растёт ($last)");
                $callback($items, $max);
                $last = $max;
            }
            return;
        }

        // pagination=start (user.get, department.get) не умеет ни курсора по ID, ни фильтра по датам,
        // поэтому период и инкрементальные условия здесь молча потерялись бы — отклоняем такую настройку.
        if (!empty($query['period']['field']) || !empty($query['id_gt']) || !empty($query['id_lte']) || !empty($query['modified_gt'])) {
            throw new ConnectorException("$method: pagination=start не поддерживает период и инкрементальную загрузку — используйте pagination=id_cursor или load.mode=full без period");
        }

        $filters = isset($src['filters']) ? $src['filters'] : array(null);
        $seen = array();
        foreach ($filters as $flt) {
            $start = 0;
            $guard = 0;
            do {
                $params = array('start' => $start);
                if ($flt !== null) $params['FILTER'] = $flt;
                $data = $this->client->call($method, $params);
                $items = array();
                foreach ($this->extract($data, $path, $camel) as $it) {
                    $id = isset($it['ID']) ? (string)$it['ID'] : null;
                    if ($id === null || isset($seen[$id])) continue;
                    $seen[$id] = true;
                    $items[] = $it;
                }
                if ($items) $callback($items, null);
                $start = isset($data['next']) ? (int)$data['next'] : null;
                if (++$guard > 10000) throw new ConnectorException("$method: слишком много страниц");
            } while ($start !== null);
        }
    }

    public function describeFields(array $src)
    {
        $method = isset($src['method']) ? $src['method'] : '';
        if ($method === 'tasks.task.list') {
            $fieldsMethod = 'tasks.task.getFields';
            $path = 'result.fields';
        } elseif (preg_match('/^(crm\.[a-z]+)\.list$/', $method, $m)) {
            $fieldsMethod = $m[1] . '.fields';
            $path = 'result';
        } else {
            return null; // user.get / department.get: пользовательские поля этими методами не описываются
        }
        $names = array();
        foreach (array_keys(arr_get($this->client->call($fieldsMethod), $path, array())) as $k) $names[] = upper_snake($k);
        return $names;
    }

    public function dictionary(array $d)
    {
        if ($d['source'] === 'crm.status.list') {
            $map = array();
            $start = 0;
            do {
                $data = $this->client->call('crm.status.list', array('order' => array('SORT' => 'ASC'), 'start' => $start));
                foreach ($data['result'] as $row) {
                    $e = (string)$row['ENTITY_ID'];
                    if ($e === $d['entity_prefix'] || strpos($e, $d['entity_prefix'] . '_') === 0) {
                        $map[(string)$row[$d['code']]] = (string)$row[$d['name']];
                    }
                }
                $start = isset($data['next']) ? $data['next'] : null;
            } while ($start !== null);
            return $map;
        }

        if (preg_match('/^crm\.[a-z]+\.fields$/', $d['source'])) {
            // варианты списочного пользовательского поля
            $fields = arr_get($this->client->call($d['source']), 'result', array());
            $itemsKey = isset($d['items']) ? $d['items'] : 'items';
            $items = isset($fields[$d['field']][$itemsKey]) ? $fields[$d['field']][$itemsKey] : array();
            $map = array();
            foreach ($items as $it) $map[(string)$it[$d['code']]] = (string)$it[$d['name']];
            if (!$map) throw new ConnectorException("{$d['source']}: у поля {$d['field']} нет вариантов");
            return $map;
        }

        throw new ConnectorException("Битрикс24 не поддерживает справочник source={$d['source']}");
    }

    private function extract($data, $path, $camel)
    {
        $items = arr_get($data, $path, array());
        if (!is_array($items)) return array();
        $out = array();
        foreach ($items as $it) {
            if (!is_array($it)) continue;
            if ($camel) {
                $n = array();
                foreach ($it as $k => $v) $n[upper_snake($k)] = $v;
                $it = $n;
            }
            $out[] = $it;
        }
        return $out;
    }
}
