<?php
/**
 * Живой тест на базе spz: настоящий Интеграм + имитация Битрикса (MockBitrix).
 * Пишет только тестовые записи (ключи 99993x–99997x, названия «ТЕСТ К …»), проверяет:
 * первую загрузку, повторный запуск без изменений, пробный запуск, изменения в источнике.
 * В конце всё удаляет и сверяет число записей с исходным.
 *
 *   INTEGRAM_TOKEN=... php tests/live_spz_test.php
 */
require __DIR__ . '/../b24ig.php';
require __DIR__ . '/helpers.php';
date_default_timezone_set('Europe/Moscow');

$root = dirname(__DIR__);
$tmp = "$root/tests/tmp";
$token = getenv('INTEGRAM_TOKEN');
if (!$token) exit("нужен INTEGRAM_TOKEN\n");

const T_DEP = 2859, T_TABEL = 2946, T_PB = 969767, T_LEAD = 482971, T_DEAL = 865423, T_TASK = 8903,
    T_STAGE = 865427, T_TSTATUS = 2685, T_SOURCE = 443068;

$ig = new IntegramClient(array('base_url' => 'https://ideav.ru', 'db' => 'spz', 'token' => $token));
function runConnector(array $extra = array())
{
    global $root, $tmp;
    $code = Runner::run(array_merge(array('config' => "$tmp/config.json"), $extra));
    return array($code, json_decode(file_get_contents("$tmp/logs/last-report.json"), true));
}

/** Удаление тестовых данных (и до, и после теста). */
function cleanup(IntegramClient $ig, array $created)
{
    $del = array();
    foreach (array(T_TASK => '99997', T_DEAL => '99996', T_LEAD => '99995') as $tid => $prefix) {
        foreach ($ig->readAll($tid) as $id => $r) if (strpos((string)$r[0], $prefix) === 0) $del[] = $id;
    }
    foreach ($ig->readAll(T_PB) as $id => $r) if (in_array((string)$r[0], array('999941', '58802'), true)) $del[] = $id;
    foreach ($ig->readAll(T_TABEL) as $id => $r) if (in_array((string)$r[0], array('999941', '123456789'), true)) $del[] = $id;
    foreach ($ig->readAll(T_LEAD) as $id => $r) if ((string)$r[0] === '5') $del[] = $id;
    $dep = table($ig, T_DEP);
    $keyPos = $dep['schema']->column('ID Битрикс')['pos'];
    foreach ($dep['rows'] as $id => $r) if (strpos((string)$r[$keyPos], '99993') === 0 || strpos((string)$r[0], 'ТЕСТ К ') === 0) $del[] = $id;
    foreach ($ig->readAll(T_STAGE) as $id => $r) if ((string)$r[0] === 'ТЕСТ К стадия') $del[] = $id;
    foreach ($ig->readAll(T_SOURCE) as $id => $r) if ((string)$r[0] === 'UNKNOWN_SRC') $del[] = $id;
    $del = array_merge($del, $created);
    for ($round = 0; $round < 3 && $del; $round++) {
        $left = array();
        foreach (array_unique($del) as $id) {
            try { $ig->mDel($id); } catch (Exception $e) { $left[] = $id; }
        }
        $del = $left;
    }
    return $del;
}

// ============================================================ подготовка
echo "Подготовка\n";
rrmdir($tmp);
mkdir("$tmp/fixtures", 0775, true);
$left = cleanup($ig, array());
$initial = array();
foreach (array(T_DEP, T_TABEL, T_PB, T_LEAD, T_DEAL, T_TASK, T_STAGE, T_TSTATUS, T_SOURCE) as $tid) $initial[$tid] = count($ig->readAll($tid));
echo '  исходные записи: ' . json_encode($initial) . "\n";
$hadRejectedStatus = false;
foreach ($ig->readAll(T_TSTATUS) as $r) if ((string)$r[0] === 'Отклонена') $hadRejectedStatus = true;
$tabel58802 = null;
foreach ($ig->readAll(T_TABEL) as $id => $r) if ((string)$r[0] === '58802') $tabel58802 = array($id, $r);

$cfg = json_decode(file_get_contents("$root/config/sportzania-spz.json"), true);
$cfg['sources']['b24'] = array('type' => 'bitrix24', 'transport' => 'mock', 'fixtures_dir' => 'tests/tmp/fixtures', 'timezone' => 'Europe/Moscow');
$cfg['runtime'] = array('state_dir' => 'tests/tmp/state', 'log_dir' => 'tests/tmp/logs', 'lock_file' => 'tests/tmp/state/run.lock', 'timezone' => 'Europe/Moscow');
$cfg['notify']['enabled'] = false;
file_put_contents("$tmp/config.json", json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

// «старый» департамент без ключа — должен привязаться, а не задублироваться
$ig->mNew(T_DEP, array('t' . T_DEP => 'ТЕСТ К Старый отдел'));
$legacy = one(table($ig, T_DEP), '@name', 'ТЕСТ К Старый отдел')[0];
$createdExtra = array();

$fx = array(
    'departments' => array(
        array('ID' => '999931', 'NAME' => 'ТЕСТ К Отдел 1', 'SORT' => '100', 'UF_HEAD' => '58802'),
        array('ID' => '999932', 'NAME' => 'ТЕСТ К Дубль', 'SORT' => '200', 'PARENT' => '999931'),
        array('ID' => '999933', 'NAME' => 'ТЕСТ К Дубль', 'SORT' => '300'),
        array('ID' => '999934', 'NAME' => 'ТЕСТ К Дочерний', 'SORT' => '400', 'PARENT' => '999932'),
        array('ID' => '999935', 'NAME' => 'ТЕСТ К Старый отдел', 'SORT' => '500'),
    ),
    'users' => array(
        array('ID' => '999941', 'ACTIVE' => true, 'NAME' => 'Тест', 'LAST_NAME' => 'Коннекторов', 'SECOND_NAME' => 'Иванович', 'EMAIL' => 'k@example.test',
            'WORK_PHONE' => '', 'PERSONAL_MOBILE' => '+7 900 000-00-41', 'WORK_POSITION' => 'Тестировщик', 'UF_DEPARTMENT' => array(999931, 999932),
            'LAST_LOGIN' => '2026-09-14T10:00:00+03:00', 'DATE_REGISTER' => '2026-01-10T09:00:00+03:00'),
        array('ID' => '58802', 'ACTIVE' => false, 'NAME' => 'Ксения', 'LAST_NAME' => 'Битриксова', 'SECOND_NAME' => '', 'EMAIL' => 'x@example.test',
            'WORK_PHONE' => '', 'PERSONAL_MOBILE' => '', 'WORK_POSITION' => 'Менеджер', 'UF_DEPARTMENT' => array(999933),
            'LAST_LOGIN' => '', 'DATE_REGISTER' => '2020-01-01T00:00:00+03:00'),
    ),
    'leads' => array(
        array('ID' => '999951', 'DATE_CREATE' => '2026-09-01T10:00:00+03:00', 'DATE_MODIFY' => '2026-09-01T10:00:00+03:00', 'TITLE' => 'ТЕСТ К лид 1',
            'NAME' => 'Лид', 'SECOND_NAME' => '', 'LAST_NAME' => 'Первый', 'COMPANY_TITLE' => 'ООО Тест', 'SOURCE_ID' => 'CALL', 'SOURCE_DESCRIPTION' => '',
            'STATUS_ID' => 'CONVERTED', 'STATUS_SEMANTIC_ID' => 'S', 'OPPORTUNITY' => '1500.50', 'IS_MANUAL_OPPORTUNITY' => 'N', 'OPENED' => 'Y',
            'COMMENTS' => "строка1\nстрока2; с разделителем \\ и слэшем", 'HAS_PHONE' => 'Y', 'HAS_EMAIL' => 'Y', 'HAS_IMOL' => 'N',
            'ASSIGNED_BY_ID' => '999941', 'CREATED_BY_ID' => '58802', 'MODIFY_BY_ID' => '58802', 'MOVED_BY_ID' => '', 'CONTACT_ID' => '',
            'IS_RETURN_CUSTOMER' => 'N', 'ORIGINATOR_ID' => '', 'ORIGIN_ID' => '', 'UTM_SOURCE' => 'yandex', 'UTM_MEDIUM' => 'cpc', 'UTM_CAMPAIGN' => '',
            'UTM_CONTENT' => '', 'UTM_TERM' => '', 'LAST_ACTIVITY_BY' => '58802', 'LAST_COMMUNICATION_TIME' => '2026-09-02T11:00:00+03:00',
            'PHONE' => array(array('VALUE' => '+7 900 111-11-11', 'VALUE_TYPE' => 'WORK'), array('VALUE' => '+7 900 222-22-22', 'VALUE_TYPE' => 'MOBILE')),
            'EMAIL' => array(array('VALUE' => 'lead@example.test')), 'WEB' => array(), 'IM' => array(), 'UF_CRM_1648027063964' => array('4800', '2082')),
        array('ID' => '999952', 'DATE_CREATE' => '2026-09-01T12:00:00+03:00', 'DATE_MODIFY' => '2026-09-01T12:00:00+03:00', 'TITLE' => 'ТЕСТ К лид 2',
            'NAME' => '', 'SECOND_NAME' => '', 'LAST_NAME' => '', 'COMPANY_TITLE' => '', 'SOURCE_ID' => 'UNKNOWN_SRC', 'SOURCE_DESCRIPTION' => '',
            'STATUS_ID' => 'NEW', 'STATUS_SEMANTIC_ID' => 'P', 'OPPORTUNITY' => '0', 'IS_MANUAL_OPPORTUNITY' => 'N', 'OPENED' => 'Y', 'COMMENTS' => '',
            'HAS_PHONE' => 'N', 'HAS_EMAIL' => 'N', 'HAS_IMOL' => 'N', 'ASSIGNED_BY_ID' => '123456789', 'CREATED_BY_ID' => '', 'MODIFY_BY_ID' => '',
            'MOVED_BY_ID' => '', 'CONTACT_ID' => '', 'IS_RETURN_CUSTOMER' => 'N', 'ORIGINATOR_ID' => '', 'ORIGIN_ID' => '', 'UTM_SOURCE' => '',
            'UTM_MEDIUM' => '', 'UTM_CAMPAIGN' => '', 'UTM_CONTENT' => '', 'UTM_TERM' => '', 'LAST_ACTIVITY_BY' => '', 'LAST_COMMUNICATION_TIME' => '',
            'PHONE' => array(), 'EMAIL' => array(), 'WEB' => array(), 'IM' => array(), 'UF_CRM_1648027063964' => array()),
    ),
    'deals' => array(
        array('ID' => '999961', 'TITLE' => 'ТЕСТ К сделка 1', 'LEAD_ID' => '999951', 'STAGE_ID' => 'C16:WON', 'OPPORTUNITY' => '1500.50', 'CURRENCY_ID' => 'RUB',
            'DATE_CREATE' => '2026-09-03T10:00:00+03:00', 'DATE_MODIFY' => '2026-09-03T10:00:00+03:00', 'ASSIGNED_BY_ID' => '999941', 'CLOSED' => 'Y', 'COMMENTS' => ''),
        array('ID' => '999962', 'TITLE' => 'ТЕСТ К сделка 2', 'LEAD_ID' => '5', 'STAGE_ID' => 'C99:TEST', 'OPPORTUNITY' => '0', 'CURRENCY_ID' => 'RUB',
            'DATE_CREATE' => '2026-09-03T11:00:00+03:00', 'DATE_MODIFY' => '2026-09-03T11:00:00+03:00', 'ASSIGNED_BY_ID' => '58802', 'CLOSED' => 'N', 'COMMENTS' => ''),
    ),
    'tasks' => array(
        array('ID' => '999971', 'TITLE' => 'ТЕСТ К задача 1', 'DESCRIPTION' => 'описание', 'STATUS' => '5', 'PRIORITY' => '1', 'RESPONSIBLE_ID' => '999941',
            'CREATED_BY' => '58802', 'DEADLINE' => '2026-09-20T18:00:00+03:00', 'CREATED_DATE' => '2026-09-04T10:00:00+03:00', 'CHANGED_DATE' => '2026-09-04T10:00:00+03:00',
            'CLOSED_DATE' => '', 'GROUP_ID' => '0', 'PARENT_ID' => '0', 'TIME_ESTIMATE' => '3600', 'ALLOW_CHANGE_DEADLINE' => 'Y', 'TAGS' => array('b3x', 'тест')),
        array('ID' => '999972', 'TITLE' => 'ТЕСТ К задача 2', 'DESCRIPTION' => '', 'STATUS' => '7', 'PRIORITY' => '2', 'RESPONSIBLE_ID' => '58279',
            'CREATED_BY' => '999941', 'DEADLINE' => '', 'CREATED_DATE' => '2026-09-04T11:00:00+03:00', 'CHANGED_DATE' => '2026-09-04T11:00:00+03:00',
            'CLOSED_DATE' => '', 'GROUP_ID' => '0', 'PARENT_ID' => '999971', 'TIME_ESTIMATE' => '0', 'ALLOW_CHANGE_DEADLINE' => 'N', 'TAGS' => array()),
    ),
    'statuses' => array(
        array('ENTITY_ID' => 'DEAL_STAGE_16', 'STATUS_ID' => 'C16:WON', 'NAME' => 'Сделка успешна'),
        array('ENTITY_ID' => 'DEAL_STAGE_99', 'STATUS_ID' => 'C99:TEST', 'NAME' => 'ТЕСТ К стадия'),
        array('ENTITY_ID' => 'SOURCE', 'STATUS_ID' => 'CALL', 'NAME' => 'Маркетинг - Сайт - Входящий звонок'),
        array('ENTITY_ID' => 'STATUS', 'STATUS_ID' => 'CONVERTED', 'NAME' => 'Сконвертирован'),
    ),
    'lead_direction' => array(array('ID' => '4800', 'VALUE' => 'Онлайн-школа'), array('ID' => '2082', 'VALUE' => 'Траектория развития')),
);

$exit = 0;
try {
    // ======================================================== запуск 1: первая загрузка
    echo "\nЗапуск 1: первая загрузка\n";
    writeFixtures("$tmp/fixtures", $fx);
    list($code, $rep) = runConnector(array('allow_mass_create' => true));
    check('код выхода 0 и нет ошибок', $code === 0 && !$rep['errors'], json_encode($rep['errors'], JSON_UNESCAPED_UNICODE));

    $dep = table($ig, T_DEP);
    $d = array();
    foreach (array('999931', '999932', '999933', '999934', '999935') as $k) $d[$k] = one($dep, 'ID Битрикс', $k)[0];
    check('департаменты: 5 записей по ключам, без дублей', !in_array(null, $d, true));
    check('старый отдел привязан, а не задублирован', $d['999935'] === $legacy && count(findBy($dep, '@name', 'ТЕСТ К Старый отдел')) === 1);
    check('родитель по ключу: 999932 → 999931', TableSchema::refIds(val($dep, $dep['rows'][$d['999932']], 'Родительский')) === array($d['999931']));
    check('неоднозначное имя родителя: 999934 → 999932, не 999933',
        TableSchema::refIds(val($dep, $dep['rows'][$d['999934']], 'Родительский')) === array($d['999932']));
    check('сортировка и руководитель', val($dep, $dep['rows'][$d['999931']], 'Сортировка') === '100' && val($dep, $dep['rows'][$d['999931']], 'Руководитель (ID)') === '58802');

    $tab = table($ig, T_TABEL);
    list($t41, $t41row) = one($tab, '@name', '999941');
    check('Табельный: новый сотрудник добавлен с ФИО', $t41 && val($tab, $t41row, 'ФИО') === 'Коннекторов Тест Иванович' && val($tab, $t41row, 'Фамилия') === 'Коннекторов');
    check('Табельный: существующий 58802 не изменён', $tabel58802 && $tab['rows'][$tabel58802[0]] === $tabel58802[1]);
    check('Табельный: заглушка для 123456789 не создана', !findBy($tab, '@name', '123456789'));

    $pb = table($ig, T_PB);
    list($p41, $p41row) = one($pb, '@name', '999941');
    list($p02, $p02row) = one($pb, '@name', '58802');
    check('Пользователь Битрикс → Табельный по ключу', $p41 && TableSchema::refIds(val($pb, $p41row, 'Табельный')) === array($t41)
        && TableSchema::refIds(val($pb, $p02row, 'Табельный')) === array($tabel58802[0]));
    $ids = TableSchema::refIds(val($pb, $p41row, 'Департамент'));
    sort($ids);
    $want = array($d['999931'], $d['999932']);
    sort($want);
    check('мультиссылка на департаменты по ключам', $ids === $want && val($pb, $p41row, 'Департаменты (ID)') === '999931,999932');
    check('Активен Y/N из булевых', val($pb, $p41row, 'Активен') === 'Y' && val($pb, $p02row, 'Активен') === 'N');

    $lead = table($ig, T_LEAD);
    list($l1, $l1row) = one($lead, '@name', '999951');
    list($l2, $l2row) = one($lead, '@name', '999952');
    check('лиды загружены', $l1 && $l2);
    check('лид: ответственный → Табельный', TableSchema::refIds(val($lead, $l1row, 'Табельный')) === array($t41));
    check('лид: источник через справочник', strpos(val($lead, $l1row, 'Источник лида'), ':Маркетинг - Сайт - Входящий звонок') !== false);
    check('лид: направление через справочник', val($lead, $l1row, 'Направление') === 'Онлайн-школа, Траектория развития');
    check('лид: мультиполе телефонов', val($lead, $l1row, 'Телефоны') === '+7 900 111-11-11, +7 900 222-22-22');
    check('лид: ; \\ и перенос в тексте', val($lead, $l1row, 'Комментарий') === 'строка1 строка2; с разделителем \\ и слэшем', val($lead, $l1row, 'Комментарий'));
    check('лид: дата с часовым поясом', (int)val($lead, $l1row, 'Дата создания') === strtotime('2026-09-01T10:00:00+03:00'));
    check('лид: сумма и новая колонка «Компания»', val($lead, $l1row, 'Сумма') === '1500.50' && val($lead, $l1row, 'Компания') === 'ООО Тест');
    check('лид с неизвестным ответственным: поле пустое', val($lead, $l2row, 'Табельный') === '');
    check('лид «5» (заглушка от сделки) не создан', !findBy($lead, '@name', '5'));
    check('в отчёте учтены пропущенные ссылки', !empty($rep['entities']['leads']['missing_refs']['Табельный']));

    $deal = table($ig, T_DEAL);
    list($s1, $s1row) = one($deal, '@name', '999961');
    list($s2, $s2row) = one($deal, '@name', '999962');
    check('сделка → лид по ключу', $s1 && TableSchema::refIds(val($deal, $s1row, 'Лид')) === array($l1));
    check('сделка: стадия через справочник', strpos(val($deal, $s1row, 'Стадия'), ':Сделка успешна') !== false);
    check('сделка: неизвестный лид — поле пустое', val($deal, $s2row, 'Лид') === '');
    check('сделка: новая стадия создана', strpos(val($deal, $s2row, 'Стадия'), ':ТЕСТ К стадия') !== false);

    $task = table($ig, T_TASK);
    list($z1, $z1row) = one($task, '@name', '999971');
    list($z2, $z2row) = one($task, '@name', '999972');
    check('задачи: статус через справочник', strpos(val($task, $z1row, 'Статус задачи'), ':Завершена') !== false && strpos(val($task, $z2row, 'Статус задачи'), ':Отклонена') !== false);
    check('задачи: исполнитель и автор (две ссылки на Табельный)', TableSchema::refIds(val($task, $z1row, 'Исполнитель')) === array($t41)
        && TableSchema::refIds(val($task, $z1row, 'Автор')) === array($tabel58802[0]) && TableSchema::refIds(val($task, $z2row, 'Автор')) === array($t41));
    check('задачи: теги, оценка, родительская', val($task, $z1row, 'Теги') === 'b3x,тест' && val($task, $z1row, 'Оценка времени') === '3600' && val($task, $z2row, 'Родительская задача') === '999971');

    $afterRun1 = array();
    foreach ($initial as $tid => $_) $afterRun1[$tid] = count($ig->readAll($tid));

    // ======================================================== запуск 2: без изменений
    echo "\nЗапуск 2: повторный, источник не менялся\n";
    list($code, $rep) = runConnector();
    check('код выхода 0', $code === 0, json_encode($rep['errors'], JSON_UNESCAPED_UNICODE));
    $newTotal = 0;
    $refsTotal = 0;
    foreach ($rep['entities'] as $s) {
        $newTotal += $s['new'];
        $refsTotal += $s['refs_set'];
    }
    check('новых записей нет', $newTotal === 0);
    check('второй проход ничего не меняет', $refsTotal === 0);
    check('инкрементальные сущности ничего не отправили', $rep['entities']['leads']['rows'] === 0 && $rep['entities']['deals']['rows'] === 0 && $rep['entities']['tasks']['rows'] === 0);
    $same = true;
    foreach ($initial as $tid => $_) if (count($ig->readAll($tid)) !== $afterRun1[$tid]) $same = false;
    check('число записей во всех таблицах не изменилось', $same);

    // ======================================================== изменения в источнике
    $fx['departments'][0]['NAME'] = 'ТЕСТ К Отдел 1 (переименован)';
    $fx['users'][0]['UF_DEPARTMENT'] = array(999933);
    $fx['leads'][0]['TITLE'] = 'ТЕСТ К лид 1 изменён';
    $fx['leads'][0]['DATE_MODIFY'] = date('c', time() + 120);
    $new = $fx['leads'][1];
    $new['ID'] = '999953';
    $new['TITLE'] = 'ТЕСТ К лид 3 новый';
    $new['ASSIGNED_BY_ID'] = '58802';
    $new['DATE_CREATE'] = $new['DATE_MODIFY'] = date('c');
    $fx['leads'][] = $new;
    $fx['deals'][0]['STAGE_ID'] = 'C99:TEST';
    $fx['deals'][0]['DATE_MODIFY'] = date('c', time() + 120);
    writeFixtures("$tmp/fixtures", $fx);

    echo "\nПробный запуск (--dry-run) с изменениями\n";
    $stateBefore = file_get_contents("$tmp/state/leads.json");
    list($code, $rep) = runConnector(array('dry_run' => true, 'bki_dir' => "$tmp/bki"));
    $files = glob("$tmp/bki/*.bki");
    $content = '';
    $allHaveHeader = (bool)$files;
    foreach ($files as $f) {
        $c = file_get_contents($f);
        if (strpos($c, "DATA\n") !== 0) $allHaveHeader = false;
        $content .= substr($c, 5);
    }
    // новые и изменённые лиды — разные фазы, поэтому разные файлы
    check('пробный запуск: файлы импорта собраны', $code === 0 && $allHaveHeader && count(glob("$tmp/bki/leads-*.bki")) === 2
        && strpos($content, 'ТЕСТ К лид 1 изменён') !== false && strpos($content, 'ТЕСТ К лид 3 новый') !== false);
    check('пробный запуск: каждая строка заканчивается «;»', $content !== '' && !preg_match('/[^;]\n/u', $content));
    $leadNow = table($ig, T_LEAD);
    check('пробный запуск: в Интеграме ничего не изменилось', val($leadNow, $leadNow['rows'][$l1], 'Название') === 'ТЕСТ К лид 1' && !findBy($leadNow, '@name', '999953'));
    check('пробный запуск: состояние не сдвинулось', file_get_contents("$tmp/state/leads.json") === $stateBefore);

    echo "\nЗапуск 3: изменения в источнике\n";
    list($code, $rep) = runConnector();
    check('код выхода 0', $code === 0, json_encode($rep['errors'], JSON_UNESCAPED_UNICODE));
    $dep = table($ig, T_DEP);
    check('переименование департамента: та же запись', one($dep, 'ID Битрикс', '999931')[0] === $d['999931']
        && $dep['rows'][$d['999931']][0] === 'ТЕСТ К Отдел 1 (переименован)');
    check('департаментов с тестовыми ключами по-прежнему 5', count(array_filter($dep['rows'], function ($r) use ($dep) {
        return strpos(val($dep, $r, 'ID Битрикс'), '99993') === 0;
    })) === 5);
    $pb = table($ig, T_PB);
    check('мультиссылка заменена, а не дописана', TableSchema::refIds(val($pb, $pb['rows'][$p41], 'Департамент')) === array($d['999933']));
    $lead = table($ig, T_LEAD);
    check('изменённый лид обновлён в той же записи', one($lead, '@name', '999951')[0] === $l1 && $lead['rows'][$l1][0] === '999951'
        && val($lead, $lead['rows'][$l1], 'Название') === 'ТЕСТ К лид 1 изменён');
    check('новый лид добавлен', one($lead, '@name', '999953')[0] !== null);
    check('лиды: 1 новый и 1 изменённый', $rep['entities']['leads']['new'] === 1 && $rep['entities']['leads']['existing'] === 1,
        json_encode(array($rep['entities']['leads']['new'], $rep['entities']['leads']['existing'])));
    $deal = table($ig, T_DEAL);
    check('стадия сделки обновлена', strpos(val($deal, $deal['rows'][$s1], 'Стадия'), ':ТЕСТ К стадия') !== false);
} catch (Exception $e) {
    check('тест завершился без исключения', false, get_class($e) . ': ' . $e->getMessage());
} finally {
    echo "\nУборка\n";
    if (!$hadRejectedStatus) {
        foreach ($ig->readAll(T_TSTATUS) as $id => $r) if ((string)$r[0] === 'Отклонена') $createdExtra[] = $id;
    }
    // задачи и сделки ссылаются на стадии/статусы — удаляем их первыми внутри cleanup
    $notDeleted = cleanup($ig, array());
    if ($createdExtra) $notDeleted = array_merge($notDeleted, cleanup($ig, $createdExtra));
    check('все тестовые записи удалены', !$notDeleted, 'не удалены: ' . implode(', ', $notDeleted));
    $diff = array();
    foreach ($initial as $tid => $n) {
        $now = count($ig->readAll($tid));
        if ($now !== $n) $diff[] = "$tid: было $n, стало $now";
    }
    check('число записей вернулось к исходному', !$diff, implode('; ', $diff));
    $failed = count(array_filter($results, function ($r) { return !$r[1]; }));
    echo "\n" . ($failed ? "ПРОВАЛЕНО $failed из " . count($results) : 'OK: ' . count($results) . ' проверок') . "\n";
    $exit = $failed ? 1 : 0;
}
exit($exit);
