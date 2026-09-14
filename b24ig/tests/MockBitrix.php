<?php
/**
 * Имитация REST Битрикс24 по JSON-файлам для тестов.
 * Поддерживает фильтры >ID / <=ID / >=ДАТА / >ДАТА, постраничность 50 записей,
 * camelCase-ключи задач, описание полей (*.fields) по ключам фикстур.
 */
class MockBitrix
{
    private $dir;
    public $calls = array();

    public function __construct($dir) { $this->dir = rtrim($dir, '/'); }

    private function load($name)
    {
        $f = "{$this->dir}/$name.json";
        return is_file($f) ? json_decode(file_get_contents($f), true) : array();
    }

    public function call($method, array $params = array())
    {
        $this->calls[] = array($method, $params);
        switch ($method) {
            case 'crm.lead.list':
                return $this->listById('leads', $params);
            case 'crm.deal.list':
                return $this->listById('deals', $params);
            case 'tasks.task.list':
                $r = $this->listById('tasks', $params);
                $tasks = array();
                foreach ($r['result'] as $t) {
                    $c = array();
                    foreach ($t as $k => $v) $c[self::camel($k)] = $v;
                    $tasks[] = $c;
                }
                return array('result' => array('tasks' => $tasks));
            case 'user.get':
                return $this->listByStart('users', $params, 'FILTER');
            case 'department.get':
                return $this->listByStart('departments', $params, null);
            case 'crm.status.list':
                return array('result' => $this->load('statuses'));
            case 'crm.lead.fields':
                return array('result' => $this->fieldsOf('leads', array('UF_CRM_1648027063964' => array('type' => 'enumeration', 'items' => $this->load('lead_direction')))));
            case 'crm.deal.fields':
                return array('result' => $this->fieldsOf('deals', array()));
            case 'tasks.task.getFields':
                return array('result' => array('fields' => $this->fieldsOf('tasks', array())));
        }
        throw new ConnectorException("MockBitrix: метод $method не поддержан");
    }

    public static function camel($k)
    {
        return lcfirst(str_replace('_', '', ucwords(strtolower($k), '_')));
    }

    private function fieldsOf($name, array $extra)
    {
        $out = array();
        foreach ($this->load($name) as $r) foreach ($r as $k => $_) $out[$k] = array('type' => 'string');
        return array_merge($out, $extra);
    }

    private function listById($name, array $p)
    {
        $f = isset($p['filter']) ? $p['filter'] : array();
        $rows = array();
        foreach ($this->load($name) as $r) if (self::match($r, $f)) $rows[] = $r;
        usort($rows, function ($a, $b) { return (int)$a['ID'] - (int)$b['ID']; });
        return array('result' => array_slice($rows, 0, 50));
    }

    private function listByStart($name, array $p, $filterKey)
    {
        $rows = $this->load($name);
        if ($filterKey && isset($p[$filterKey])) {
            foreach ($p[$filterKey] as $k => $v) {
                $rows = array_values(array_filter($rows, function ($r) use ($k, $v) {
                    return isset($r[$k]) && (bool)$r[$k] === (bool)$v;
                }));
            }
        }
        $start = isset($p['start']) ? (int)$p['start'] : 0;
        $out = array('result' => array_slice($rows, $start, 50), 'total' => count($rows));
        if ($start + 50 < count($rows)) $out['next'] = $start + 50;
        return $out;
    }

    public static function match(array $r, array $filter)
    {
        foreach ($filter as $k => $v) {
            if (!preg_match('/^(>=|<=|>|<|=)?(.+)$/', $k, $m)) continue;
            $op = $m[1] !== '' ? $m[1] : '=';
            $field = $m[2];
            if ($field === 'ID') {
                $a = (int)$r['ID'];
                $b = (int)$v;
            } else {
                $a = isset($r[$field]) ? strtotime((string)$r[$field]) : false;
                $b = strtotime((string)$v);
                if ($a === false || $b === false) return false;
            }
            if ($op === '>' && !($a > $b)) return false;
            if ($op === '>=' && !($a >= $b)) return false;
            if ($op === '<' && !($a < $b)) return false;
            if ($op === '<=' && !($a <= $b)) return false;
            if ($op === '=' && $a != $b) return false;
        }
        return true;
    }
}
