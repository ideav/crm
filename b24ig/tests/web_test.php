<?php
/**
 * Запуск коннектора на сервере Интеграма: раскладка ideav/crm (tools/build-crm.sh), встроенный
 * веб-сервер PHP вместо Apache, реальная база spz, имитация Битрикса.
 * Проверяет запуск по URL и из командной строки для базы, секреты из secrets.json,
 * безопасность параметров URL, блокировку, очистку логов. Тестовые департаменты 99998x удаляет.
 *
 *   INTEGRAM_TOKEN=... php tests/web_test.php
 */
require __DIR__ . '/../b24ig.php';
require __DIR__ . '/helpers.php';
date_default_timezone_set('Europe/Moscow');

$root = dirname(__DIR__);
$web = "$root/tests/tmpweb";
$site = "$web/site";
$dbDir = "$site/templates/custom/spz/connector";
$token = getenv('INTEGRAM_TOKEN');
if (!$token) exit("нужен INTEGRAM_TOKEN\n");
$ig = new IntegramClient(array('base_url' => 'https://ideav.ru', 'db' => 'spz', 'token' => $token));
const PORT = 18080;

function http($query, $timeout = 300)
{
    $ctx = stream_context_create(array('http' => array('ignore_errors' => true, 'timeout' => $timeout)));
    $body = @file_get_contents('http://127.0.0.1:' . PORT . '/b24ig.php' . $query, false, $ctx);
    $code = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})(\s|$)/', $http_response_header[0], $m)) $code = (int)$m[1];
    return array($code, (string)$body);
}

function testDepartments(IntegramClient $ig)
{
    $t = table($ig, 2859);
    return findByPrefix($t, 'ID Битрикс', '99998');
}
function findByPrefix(array $t, $col, $prefix)
{
    $out = array();
    $pos = $t['schema']->column($col)['pos'];
    foreach ($t['rows'] as $id => $r) if (strpos((string)$r[$pos], $prefix) === 0) $out[$id] = $r;
    return $out;
}
function cleanupDepartments(IntegramClient $ig)
{
    for ($round = 0; $round < 3; $round++) {
        $left = testDepartments($ig);
        if (!$left) return true;
        foreach (array_keys($left) as $id) {
            try { $ig->mDel($id); } catch (Exception $e) { /* дочерний ещё ссылается — следующий круг */ }
        }
    }
    return !testDepartments($ig);
}

$server = null;
$exit = 1;
try {
    echo "Подготовка: раскладка сайта\n";
    rrmdir($web);
    exec('bash ' . escapeshellarg("$root/tools/build-crm.sh") . ' ' . escapeshellarg($site), $buildOut, $rc);
    check('сборка раскладки ideav/crm', $rc === 0 && is_file("$site/b24ig.php") && is_file("$site/include/b24ig/Runner.php"), implode("\n", $buildOut));
    mkdir("$site/tests", 0775, true);
    copy("$root/tests/MockBitrix.php", "$site/tests/MockBitrix.php");   // только для теста: транспорт-имитация
    cleanupDepartments($ig);
    $depCount = count($ig->readAll(2859));

    mkdir("$web/fixtures", 0775, true);
    writeFixtures("$web/fixtures", array('departments' => array(
        array('ID' => '999981', 'NAME' => 'ТЕСТ W Отдел 1', 'SORT' => '10'),
        array('ID' => '999982', 'NAME' => 'ТЕСТ W Отдел 2', 'SORT' => '20', 'PARENT' => '999981'),
        array('ID' => '999983', 'NAME' => 'ТЕСТ W Отдел 3', 'SORT' => '30'),
    )));
    $project = json_decode(file_get_contents("$root/config/sportzania-spz.json"), true);
    $cfg = array(
        'version' => 1, 'project' => 'web-test',
        'sources' => array('b24' => array('type' => 'bitrix24', 'transport' => 'mock', 'fixtures_dir' => "$web/fixtures", 'timezone' => 'Europe/Moscow')),
        'target' => array('type' => 'integram', 'base_url' => 'https://ideav.ru', 'db' => 'spz', 'token' => '${INTEGRAM_TOKEN}'),
        'runtime' => array('timezone' => 'Europe/Moscow', 'state_dir' => 'state/web-test', 'log_dir' => 'logs/web-test', 'lock_file' => 'state/web-test/run.lock', 'log_keep_days' => 7),
        'safety' => $project['safety'],
        'order' => array('departments'),
        'entities' => array('departments' => $project['entities']['departments']),
    );
    mkdir($dbDir, 0775, true);
    file_put_contents("$dbDir/web-test.json", json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    $other = $cfg;
    $other['target']['db'] = 'other';
    file_put_contents("$dbDir/other-db.json", json_encode($other, JSON_UNESCAPED_UNICODE));
    file_put_contents("$dbDir/secrets.json", json_encode(array('INTEGRAM_TOKEN' => $token)));
    mkdir("$dbDir/logs/web-test", 0775, true);
    file_put_contents("$dbDir/logs/web-test/2026-01-01.log", "старый лог\n");
    touch("$dbDir/logs/web-test/2026-01-01.log", time() - 30 * 86400);

    // сервер без INTEGRAM_TOKEN в окружении: токен должен прийти из secrets.json
    $server = proc_open('exec php -S 127.0.0.1:' . PORT . ' -t ' . escapeshellarg($site),
        array(1 => array('file', "$web/server.log", 'a'), 2 => array('file', "$web/server.log", 'a')),
        $pipes, $site, array('PATH' => getenv('PATH')));
    for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', PORT); $i++) usleep(100000);

    echo "\nПараметры URL\n";
    list($code, $body) = http('');
    check('без db и config → 400', $code === 400, "$code $body");
    list($code, $body) = http('?db=..%2F..%2Fetc&config=passwd');
    check('обход каталога в имени базы → 400', $code === 400 && strpos($body, 'имя базы') !== false, "$code $body");
    list($code, $body) = http('?db=spz&config=..%2Fsecrets');
    check('обход каталога в имени конфига → 400', $code === 400 && strpos($body, 'имя конфига') !== false, "$code $body");
    list($code, $body) = http('?db=spz&config=nope');
    check('нет конфига → 400 «не найден»', $code === 400 && strpos($body, 'не найден') !== false, "$code $body");
    list($code, $body) = http('?db=spz&config=other-db');
    check('target.db не совпадает с базой → 400', $code === 400 && strpos($body, 'не совпадает') !== false, "$code $body");

    echo "\nПроверка схем по URL\n";
    list($code, $body) = http('?db=spz&config=web-test&check&JSON');
    $rep = json_decode($body, true);
    check('check → 200, без ошибок', $code === 200 && is_array($rep) && !$rep['errors'], "$code " . substr($body, 0, 300));
    check('токен из secrets.json не попадает в ответ', strpos($body, $token) === false);

    echo "\nМассовое создание по URL запрещено\n";
    list($code, $body) = http('?db=spz&config=web-test&JSON&allow_mass_create=1&reset=departments');
    $rep = json_decode($body, true);
    check('allow_mass_create из URL игнорируется: защита остановила загрузку (500)', $code === 500 && isset($rep['errors'][0]['kind']) && $rep['errors'][0]['kind'] === 'safety', "$code " . substr($body, 0, 300));
    check('в Интеграме ничего не создано', !testDepartments($ig));

    echo "\nПервая загрузка из командной строки для базы\n";
    exec('env -i PATH=' . escapeshellarg(getenv('PATH')) . ' php ' . escapeshellarg("$site/b24ig.php") . ' --db=spz --config=web-test --allow-mass-create 2>&1', $cliOut, $rc);
    check('CLI --db --config: код 0', $rc === 0, implode("\n", array_slice($cliOut, -5)));
    check('департаменты созданы', count(testDepartments($ig)) === 3);
    check('состояние и логи — в папке базы', is_file("$dbDir/state/web-test/departments.json") && is_file("$dbDir/logs/web-test/" . date('Y-m-d') . '.log'));
    check('старый лог удалён (log_keep_days)', !is_file("$dbDir/logs/web-test/2026-01-01.log"));

    echo "\nПовторный запуск по URL\n";
    list($code, $body) = http('?db=spz&config=web-test');
    check('текстовый ответ 200 со сводкой по сущности', $code === 200 && strpos($body, 'departments: получено') !== false, "$code " . substr($body, -300));
    check('подробный лог (имена записей) в ответ по URL не попадает', strpos($body, 'привязана существующая запись') === false && strpos($body, 'ТЕСТ W Отдел') === false);
    check('.htaccess закрывает папку базы от веб-сервера', is_file("$dbDir/.htaccess") && strpos(file_get_contents("$dbDir/.htaccess"), 'denied') !== false);
    list($code, $body) = http('?db=spz&config=web-test&JSON');
    $rep = json_decode($body, true);
    check('JSON-отчёт: новых 0, существующих 3', $code === 200 && $rep['entities']['departments']['new'] === 0 && $rep['entities']['departments']['existing'] === 3, "$code " . substr($body, 0, 300));
    check('дублей нет', count(testDepartments($ig)) === 3 && count($ig->readAll(2859)) === $depCount + 3);

    echo "\nБлокировка\n";
    $fh = fopen("$dbDir/state/web-test/run.lock", 'c');
    flock($fh, LOCK_EX);
    list($code, $body) = http('?db=spz&config=web-test&JSON');
    flock($fh, LOCK_UN);
    fclose($fh);
    $rep = json_decode($body, true);
    check('предыдущий запуск идёт → 409', $code === 409 && !empty($rep['busy']), "$code " . substr($body, 0, 200));
    exec('env -i PATH=' . escapeshellarg(getenv('PATH')) . ' php ' . escapeshellarg("$site/b24ig.php") . ' --db=spz --config=web-test --only=departments --dry-run 2>&1', $o2, $rc2);
    check('после снятия блокировки запускается снова', $rc2 === 0, implode("\n", array_slice($o2, -3)));
    $exit = 0;
} catch (Exception $e) {
    check('тест без исключения', false, get_class($e) . ': ' . $e->getMessage());
} finally {
    echo "\nУборка\n";
    if ($server) proc_terminate($server);
    check('тестовые департаменты удалены', cleanupDepartments($ig) && count($ig->readAll(2859)) === (isset($depCount) ? $depCount : -1));
    rrmdir($web);   // там secrets.json с токеном
    check('временная раскладка с secrets.json удалена', !is_dir($web));
    exit(summary());
}
