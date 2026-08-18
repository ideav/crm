<?php
// #4794: повторная регистрация НЕподтверждённого адреса выдавала «Этот email уже
// зарегистрирован [errMailExists]» — тупик, потому что письмо-подтверждение не
// доходит (#4639), а перезапросить его нельзя. Проверка уникальности email в
// index.php теперь различает подтверждённого владельца (у него создана база —
// запись t=DATABASE, см. createDb) и неподтверждённого (базы нет): первому —
// прежний errMailExists, второму — понятное «проверьте почту и спам» [errMailPending].
//
// Тест — точное зеркало проверки из index.php внутри namespace со стабами mysqli_*,
// поэтому обходится без реальной БД. Запуск:  php experiments/register-unconfirmed-4794.test.php
//
// КРАСНЫМ он был на дореформенном коде: одна строка
//   if(mysqli_fetch_array(Exec_sql("SELECT 1 FROM $z WHERE val='$email' AND t=".EMAIL...)))
//     my_die(... errMailExists);
// возвращала errMailExists и для неподтверждённого адреса → падал случай 2.

namespace Test4794;

const EMAIL = 41;
const DATABASE = 271;

// Фикстура: email => состояние. confirmed=true эмулирует наличие базы (t=DATABASE).
$GLOBALS['EMAILS'] = [
    'unconfirmed@example.org' => ['confirmed' => false],
    'confirmed@example.org'   => ['confirmed' => true],
    // 'new@example.org' отсутствует намеренно
];

// Зеркало запроса из index.php:
//   SELECT db.id dbid FROM my email
//     LEFT JOIN my db ON db.up=email.up AND db.t=271
//    WHERE email.val='<email>' AND email.t=41 LIMIT 1
function mysqli_query($connection, $sql){
    if(!preg_match("/email\.val='([^']*)'/", $sql, $m)) return false;
    $email = stripslashes($m[1]);
    if(!isset($GLOBALS['EMAILS'][$email])) return false;     // адреса нет — строк нет
    $rec = $GLOBALS['EMAILS'][$email];
    // LEFT JOIN: строка есть всегда (email нашёлся); dbid заполнен только у подтверждённого.
    return ['dbid' => $rec['confirmed'] ? 1000 : null];
}
function mysqli_fetch_array($res){ return is_array($res) ? $res : false; }

// ---- Зеркало проверки уникальности email из index.php (ветка register) ----
// Возвращает решение вместо вызова my_die(), чтобы тест мог его проверить.
function checkEmail($email){
    global $connection;
    $z = 'my';
    if($row = mysqli_fetch_array(mysqli_query($connection, "SELECT db.id dbid FROM $z email"
            ." LEFT JOIN $z db ON db.up=email.up AND db.t=".DATABASE
            ." WHERE email.val='".addslashes($email)."' AND email.t=".EMAIL." LIMIT 1"))){
        if($row["dbid"]) return 'errMailExists';   // подтверждённый — законно занят
        else             return 'errMailPending';  // не подтверждён — письмо не дошло
    }
    return 'proceed';                              // адреса нет — регистрируем
}

function assertEq($got, $exp, $name){
    if($got === $exp){ echo "  ok: $name\n"; return; }
    fwrite(STDERR, "  FAIL: $name — ждали '$exp', получили '$got'\n");
    $GLOBALS['FAILED'] = true;
}

$GLOBALS['FAILED'] = false;

// 1. Новый адрес — регистрация продолжается
assertEq(checkEmail('new@example.org'), 'proceed', 'новый адрес регистрируется');

// 2. Неподтверждённый существующий — понятное «ждёт подтверждения», НЕ errMailExists (суть #4794)
assertEq(checkEmail('unconfirmed@example.org'), 'errMailPending', 'неподтверждённый → errMailPending, не тупик');

// 3. Подтверждённый (есть база) — прежнее «уже зарегистрирован»
assertEq(checkEmail('confirmed@example.org'), 'errMailExists', 'подтверждённый → errMailExists');

if($GLOBALS['FAILED']){ fwrite(STDERR, "register-unconfirmed-4794: FAILED\n"); exit(1); }
echo "register-unconfirmed-4794 test passed\n";
