<?php
/**
 * Общие утилиты коннектора: исключения, лог, блокировка запуска, состояние, мелкие функции.
 * Совместимость: PHP 7.2+ (без match, str_contains, типизированных свойств).
 */

class ConnectorException extends Exception {}
class SchemaDriftException extends ConnectorException {}
class SafetyException extends ConnectorException {}

class Log
{
    private static $file = null;
    public static $counts = array('error' => 0, 'warn' => 0);
    public static $web = false;    // запуск по URL: строки уходят в ответ (STDOUT в веб-запросе не определён)
    public static $quiet = false;  // ответ в JSON: строки только в файл

    /** $keepDays > 0 — удалить дневные логи (ГГГГ-ММ-ДД.log) старше этого числа дней. */
    public static function init($dir, $keepDays = 0)
    {
        $dir = rtrim($dir, '/');
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        self::$file = $dir . '/' . date('Y-m-d') . '.log';
        if ($keepDays > 0) {
            $border = time() - (int)$keepDays * 86400;
            foreach ((array)glob($dir . '/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].log') as $f) {
                if (is_file($f) && filemtime($f) < $border) @unlink($f);
            }
        }
    }

    public static function info($msg) { self::write('info', $msg); }
    public static function warn($msg) { self::write('warn', $msg); }
    public static function error($msg) { self::write('error', $msg); }

    private static function write($level, $msg)
    {
        if (isset(self::$counts[$level])) self::$counts[$level]++;
        $line = date('Y-m-d H:i:s') . ' [' . strtoupper($level) . '] ' . $msg;
        if (!self::$quiet) {
            if (self::$web) {
                echo $line, "\n";   // в буфер ответа: код HTTP выставляется после запуска (Runner::web)
            } else {
                fwrite($level === 'error' ? STDERR : STDOUT, $line . PHP_EOL);
            }
        }
        if (self::$file) file_put_contents(self::$file, $line . PHP_EOL, FILE_APPEND);
    }
}

/** Защита от параллельного запуска по cron. */
class Lock
{
    private $fh = null;

    public function acquire($file)
    {
        $dir = dirname($file);
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $this->fh = fopen($file, 'c');
        if (!$this->fh || !flock($this->fh, LOCK_EX | LOCK_NB)) return false;
        ftruncate($this->fh, 0);
        fwrite($this->fh, getmypid() . ' ' . date('c'));
        return true;
    }

    public function release()
    {
        if ($this->fh) {
            flock($this->fh, LOCK_UN);
            fclose($this->fh);
            $this->fh = null;
        }
    }
}

/** Состояние инкрементальной загрузки: по файлу на сущность, запись атомарная. */
class State
{
    private $dir;

    public function __construct($dir)
    {
        $this->dir = $dir;
        if (!is_dir($dir)) mkdir($dir, 0775, true);
    }

    private function file($entity) { return $this->dir . '/' . $entity . '.json'; }

    public function load($entity)
    {
        $f = $this->file($entity);
        $s = is_file($f) ? json_decode(file_get_contents($f), true) : null;
        return array_merge(array(
            'last_id' => 0,          // фаза «новые»: максимальный загруженный ID
            'updated_since' => null, // фаза «изменённые»: момент начала прошлого полного прогона
            'upd_cursor' => 0,       // курсор внутри фазы «изменённые»
            'upd_max_id' => 0,       // верхняя граница ID для фазы «изменённые»
            'last_run' => null,
        ), is_array($s) ? $s : array());
    }

    public function save($entity, array $state)
    {
        $f = $this->file($entity);
        file_put_contents($f . '.tmp', json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        rename($f . '.tmp', $f);
    }

    public function reset($entity)
    {
        foreach (array($this->file($entity), $this->versionsFile($entity)) as $f) {
            if (is_file($f)) unlink($f);
        }
    }

    /** Версии записей (load.detect_changes): ключ → версия в источнике на момент последней загрузки. */
    private function versionsFile($entity) { return $this->dir . '/' . $entity . '.versions.json'; }

    public function loadVersions($entity)
    {
        $f = $this->versionsFile($entity);
        $v = is_file($f) ? json_decode(file_get_contents($f), true) : null;
        return is_array($v) ? $v : array();
    }

    public function saveVersions($entity, array $versions)
    {
        $f = $this->versionsFile($entity);
        file_put_contents($f . '.tmp', json_encode($versions, JSON_UNESCAPED_UNICODE));
        rename($f . '.tmp', $f);
    }
}

function arr_get($arr, $path, $default = null)
{
    foreach (explode('.', $path) as $k) {
        if (!is_array($arr) || !array_key_exists($k, $arr)) return $default;
        $arr = $arr[$k];
    }
    return $arr;
}

/** responsibleId → RESPONSIBLE_ID (задачи Битрикса отдают ключи в camelCase). */
function upper_snake($key)
{
    return strtoupper(preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', (string)$key));
}

function str_lower($s)
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

/** Нормализация названия для привязки старых записей. */
function norm_name($s, array $rules)
{
    $s = (string)$s;
    if (in_array('trim', $rules)) $s = trim(preg_replace('/\s+/u', ' ', $s));
    if (in_array('lower', $rules)) $s = str_lower($s);
    if (in_array('yo', $rules)) $s = str_replace(array('ё', 'Ё'), array('е', 'Е'), $s);
    return $s;
}
