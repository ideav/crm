<?php
/**
 * Адаптер 1С:Предприятие через стандартный интерфейс OData (только чтение).
 *  - ключ записей — GUID Ref_Key, постранично $top/$skip с сортировкой;
 *  - период — $filter по полю даты; изменённые записи ядро находит по DataVersion (load.detect_changes);
 *  - нулевой GUID (пустая ссылка) и дата 0001-01-01 → пустое значение (иначе Интеграм запишет 01.01.2001),
 *    дата без пояса → с поясом подключения;
 *  - схема — $metadata (EntityType/ComplexType); табличные части — вложенные коллекции записей.
 */
class OneCSource implements SourceAdapter
{
    const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

    private $name;
    private $client;
    private $cfg;
    private $tz;
    private $types = null;

    /** @param ODataClient|MockOData $client — объект с методами get($entity, $params) и metadataXml() */
    public function __construct($name, $client, array $cfg)
    {
        $this->name = $name;
        $this->client = $client;
        $this->cfg = $cfg;
        $this->tz = new DateTimeZone(!empty($cfg['timezone']) ? $cfg['timezone'] : date_default_timezone_get());
    }

    public function name() { return $this->name; }

    /** Условия запроса → $filter OData. */
    public function filter(array $src, array $query)
    {
        foreach (array('id_gt', 'id_lte', 'modified_gt') as $k) {
            if (!empty($query[$k])) {
                throw new ConnectorException("источник «{$this->name}» (1С): условие $k не поддерживается — для 1С используйте load.mode=full и load.detect_changes");
            }
        }
        $parts = array();
        if (!empty($src['filter'])) $parts[] = '(' . $src['filter'] . ')';
        $p = isset($query['period']) ? $query['period'] : null;
        if (!empty($p['field'])) {
            if (!empty($p['from'])) $parts[] = $p['field'] . " ge datetime'" . $p['from'] . "T00:00:00'";
            if (!empty($p['to'])) $parts[] = $p['field'] . " le datetime'" . $p['to'] . "T23:59:59'";
        }
        return implode(' and ', $parts);
    }

    public function each(array $src, array $query, array $select, $callback)
    {
        if (empty($src['entity'])) throw new ConnectorException("источник «{$this->name}» (1С): не задан source.entity");
        $entity = $src['entity'];
        $page = max(1, (int)(isset($src['page_size']) ? $src['page_size'] : (isset($this->cfg['page_size']) ? $this->cfg['page_size'] : 500)));
        $params = array('$orderby' => isset($src['order']) ? $src['order'] : 'Ref_Key');
        $filter = $this->filter($src, $query);
        if ($filter !== '') $params['$filter'] = $filter;
        $props = $this->properties($entity);
        $sel = array();
        foreach ($select as $f) if (isset($props[$f])) $sel[] = $f;
        if ($sel) $params['$select'] = implode(',', $sel);

        for ($skip = 0; ; $skip += $page) {
            $params['$top'] = $page;
            $params['$skip'] = $skip;
            $data = $this->client->get($entity, $params);
            $items = (isset($data['value']) && is_array($data['value'])) ? $data['value'] : array();
            if ($items) $callback(array_map(array($this, 'normalize'), $items), null);
            if (count($items) < $page) break;
        }
    }

    /** Пустые ссылки и даты → null, дата без пояса → с поясом подключения; рекурсивно для табличных частей. */
    public function normalize($value)
    {
        if (is_array($value)) {
            foreach ($value as $k => $v) $value[$k] = $this->normalize($v);
            return $value;
        }
        if (!is_string($value)) return $value;
        if ($value === self::EMPTY_GUID || strpos($value, '0001-01-01T') === 0) return null;
        if (preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/', $value)) {
            $d = new DateTime($value, $this->tz);
            return $d->format('Y-m-d\TH:i:sP');
        }
        return $value;
    }

    public function describeFields(array $src)
    {
        if (empty($src['entity'])) return null;
        return array_keys($this->properties($src['entity']));
    }

    public function dictionary(array $d)
    {
        if ($d['source'] !== 'odata.entity') throw new ConnectorException("1С не поддерживает справочник source={$d['source']}");
        $code = isset($d['code']) ? $d['code'] : 'Ref_Key';
        $name = isset($d['name']) ? $d['name'] : 'Description';
        $map = array();
        $this->each(array('entity' => $d['entity']), array(), array($code, $name), function ($items) use (&$map, $code, $name) {
            foreach ($items as $it) {
                if (isset($it[$code])) $map[(string)$it[$code]] = isset($it[$name]) ? (string)$it[$name] : '';
            }
        });
        return $map;
    }

    /** Свойства сущности из $metadata: имя → тип. */
    private function properties($entity)
    {
        $types = $this->types();
        if (!isset($types[$entity])) {
            throw new ConnectorException("в \$metadata 1С нет сущности «{$entity}» (неверное имя или нет прав на чтение)");
        }
        return $types[$entity];
    }

    private function types()
    {
        if ($this->types !== null) return $this->types;
        $prev = libxml_use_internal_errors(true);
        $doc = new DOMDocument();
        $ok = $doc->loadXML($this->client->metadataXml());
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$ok) throw new ConnectorException('OData 1С: не удалось разобрать $metadata');
        $types = array();
        foreach (array('EntityType', 'ComplexType') as $tag) {
            foreach ($doc->getElementsByTagName($tag) as $et) {
                $props = array();
                foreach ($et->childNodes as $n) {
                    if (!($n instanceof DOMElement)) continue;
                    if ($n->localName === 'Property') $props[$n->getAttribute('Name')] = $n->getAttribute('Type');
                    elseif ($n->localName === 'NavigationProperty') $props[$n->getAttribute('Name')] = 'Navigation';
                }
                $types[$et->getAttribute('Name')] = $props;
            }
        }
        return $this->types = $types;
    }
}
