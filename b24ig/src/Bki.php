<?php
/**
 * Формат импорта Интеграма (plain data): первая строка DATA, дальше по записи на строку.
 * Значения в порядке колонок таблицы (первая колонка, затем реквизиты из metadata).
 */
class Bki
{
    public static function escape($v)
    {
        $v = str_replace(array("\r\n", "\r", "\n", "\t"), ' ', (string)$v);
        // сначала обратный слэш, потом разделитель — иначе «\;» в данных сломает разбор
        return str_replace(array('\\', ';'), array('\\\\', '\\;'), $v);
    }

    /**
     * Завершающий ';' обязателен: ядро считает строку законченной, только когда полей
     * больше, чем колонок, иначе дочитывает следующую строку (подтверждено тестом на spz).
     */
    public static function row(array $values)
    {
        return implode(';', array_map(array('Bki', 'escape'), $values)) . ";\n";
    }
}

/** Набирает строки в файлы импорта не больше заданного числа строк и байт. */
class BkiChunker
{
    const HEADER = "DATA\n";
    private $rows = array();
    private $bytes;
    private $maxRows;
    private $maxBytes;

    public function __construct($maxRows, $maxBytes)
    {
        $this->maxRows = max(1, (int)$maxRows);
        $this->maxBytes = max(1024, (int)$maxBytes);
        $this->bytes = strlen(self::HEADER);
    }

    public function wouldOverflow($rowCount, $bytes)
    {
        return $this->rows
            && (count($this->rows) + $rowCount > $this->maxRows || $this->bytes + $bytes > $this->maxBytes);
    }

    public function add($line)
    {
        $this->rows[] = $line;
        $this->bytes += strlen($line);
    }

    public function isEmpty() { return !$this->rows; }
    public function count() { return count($this->rows); }

    public function take()
    {
        $content = self::HEADER . implode('', $this->rows);
        $this->rows = array();
        $this->bytes = strlen(self::HEADER);
        return $content;
    }
}
