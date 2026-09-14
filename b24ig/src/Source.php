<?php
/**
 * Источник данных. Ядро коннектора работает с источником только через этот интерфейс,
 * поэтому Битрикс24, 1С и другие системы подключаются адаптерами без изменений ядра.
 */
interface SourceAdapter
{
    /** Имя подключения из конфига (sources.<имя>). */
    public function name();

    /**
     * Обходит записи сущности, вызывая $callback(array $items, $cursor) на каждую страницу.
     * Ключи записей — имена полей так, как они записаны в fields конфига.
     *
     * $query — условия, не зависящие от источника (адаптер переводит их в свой синтаксис):
     *   period      => [field, from, to]  созданные в периоде (даты YYYY-MM-DD, to может быть null)
     *   id_gt       => int                курсор: ID больше
     *   id_lte      => int                ID не больше
     *   modified_gt => [field, since]     изменённые после момента (ISO 8601)
     * $cursor — курсор после страницы (null, если постраничность без курсора).
     */
    public function each(array $src, array $query, array $select, $callback);

    /** Имена полей сущности в источнике — для сверки схемы; null, если источник их не описывает. */
    public function describeFields(array $src);

    /** Справочник «код → название» по описанию из dictionaries (кроме source=static). */
    public function dictionary(array $d);
}

class Sources
{
    /** @return SourceAdapter */
    public static function create($name, array $cfg, $root)
    {
        $type = isset($cfg['type']) ? $cfg['type'] : '';
        if ($type === 'mock') {   // формат v1: имитация Битрикса в тестах
            $type = 'bitrix24';
            $cfg['transport'] = 'mock';
        }
        $mock = arr_get($cfg, 'transport') === 'mock';
        $fixtures = $mock ? self::abs((string)$cfg['fixtures_dir'], $root) : null;
        switch ($type) {
            case 'bitrix24':
                if ($mock) require_once $root . '/tests/MockBitrix.php';
                return new Bitrix24Source($name, $mock ? new MockBitrix($fixtures) : new BitrixClient($cfg));
            case 'odata1c':
                if ($mock) require_once $root . '/tests/MockOData.php';
                return new OneCSource($name, $mock ? new MockOData($fixtures) : new ODataClient($cfg), $cfg);
        }
        throw new ConnectorException("подключение «{$name}»: неизвестный тип источника «{$type}»");
    }

    private static function abs($dir, $root)
    {
        return ($dir !== '' && $dir[0] === '/') ? $dir : $root . '/' . $dir;
    }
}
