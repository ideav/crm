<?php
/**
 * Имитация стандартного интерфейса OData 1С по файлам: metadata.xml и <Сущность>.json.
 * Поддерживает $filter (datetime ge/le/gt/lt, eq true/false, eq '…'/guid'…', and), $orderby, $select, $top, $skip.
 */
class MockOData
{
    private $dir;
    public $requests = array();

    public function __construct($dir) { $this->dir = rtrim($dir, '/'); }

    public function metadataXml()
    {
        return file_get_contents($this->dir . '/metadata.xml');
    }

    public function get($entity, array $params)
    {
        $this->requests[] = array($entity, $params);
        $file = "{$this->dir}/$entity.json";
        if (!is_file($file)) throw new ConnectorException("MockOData: нет набора $entity");
        $rows = json_decode(file_get_contents($file), true);
        if (!empty($params['$filter'])) {
            $flt = $params['$filter'];
            $rows = array_values(array_filter($rows, function ($r) use ($flt) { return MockOData::match($r, $flt); }));
        }
        if (!empty($params['$orderby'])) {
            $parts = explode(' ', trim($params['$orderby']));
            $k = $parts[0];
            usort($rows, function ($a, $b) use ($k) { return strcmp((string)$a[$k], (string)$b[$k]); });
        }
        if (!empty($params['$select'])) {
            $keep = array_flip(explode(',', $params['$select']));
            foreach ($rows as &$r) $r = array_intersect_key($r, $keep);
            unset($r);
        }
        $skip = isset($params['$skip']) ? (int)$params['$skip'] : 0;
        $top = isset($params['$top']) ? (int)$params['$top'] : count($rows);
        return array('odata.metadata' => 'mock/$metadata#' . $entity, 'value' => array_slice($rows, $skip, $top));
    }

    public static function match(array $r, $filter)
    {
        foreach (preg_split('/\s+and\s+/iu', trim($filter)) as $cond) {
            $cond = trim($cond, " ()");
            if (preg_match("/^(\\w+) (ge|le|gt|lt|eq) datetime'([^']+)'$/u", $cond, $m)) {
                $a = isset($r[$m[1]]) ? strtotime($r[$m[1]]) : false;
                $b = strtotime($m[3]);
                if ($a === false) return false;
                $ok = array('ge' => $a >= $b, 'le' => $a <= $b, 'gt' => $a > $b, 'lt' => $a < $b, 'eq' => $a == $b);
                if (!$ok[$m[2]]) return false;
            } elseif (preg_match('/^(\w+) eq (true|false)$/u', $cond, $m)) {
                if ((bool)(isset($r[$m[1]]) ? $r[$m[1]] : false) !== ($m[2] === 'true')) return false;
            } elseif (preg_match("/^(\\w+) eq (?:guid)?'([^']*)'$/u", $cond, $m)) {
                if ((string)(isset($r[$m[1]]) ? $r[$m[1]] : '') !== $m[2]) return false;
            } else {
                throw new ConnectorException("MockOData: условие не поддержано: $cond");
            }
        }
        return true;
    }
}
