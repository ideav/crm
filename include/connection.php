<?php
if(!function_exists('integram_env')){
    function integram_env($name, $default = ''){
        $value = getenv($name);
        return ($value === false || $value === '') ? $default : $value;
    }
}

$dbHost = integram_env('INTEGRAM_DB_HOST', 'localhost');
$dbPort = (int)integram_env('INTEGRAM_DB_PORT', '3306');
$dbName = integram_env('INTEGRAM_DB_NAME', 'ideav');
$dbUser = integram_env('INTEGRAM_DB_USER', 'ideav');
$dbPassword = integram_env('INTEGRAM_DB_PASSWORD', 'x');

# Соединение открывается через mysqli_init(), чтобы выставить таймауты ДО коннекта:
# после connect опции уже не применяются. Read-таймаут держим по потолку TIME_LIMIT_MAX —
# он страхует от вечного ожидания ответа БД (таймер PHP в это время не тикает), а
# фактический предел запроса ставит max_statement_time ниже (issue #4322).
$connection = mysqli_init() or die("Couldn't connect.");
@mysqli_options($connection, MYSQLI_OPT_CONNECT_TIMEOUT, 10);
if(defined("MYSQLI_OPT_READ_TIMEOUT"))
    @mysqli_options($connection, MYSQLI_OPT_READ_TIMEOUT, TIME_LIMIT_MAX + TIME_LIMIT_SQL_SLACK);
mysqli_real_connect($connection, $dbHost, $dbUser, $dbPassword, $dbName, $dbPort) or die("Couldn't connect.");
$connection->set_charset("utf8mb4");
# Реквизиты и номер потока нужны, чтобы добить зависший запрос отдельным соединением
# (KILL QUERY), когда основное занято или уже разорвано — issue #4322.
$GLOBALS["DB_CONN"] = array("host" => $dbHost, "user" => $dbUser, "password" => $dbPassword,
                            "name" => $dbName, "port" => $dbPort);
$GLOBALS["SQL_THREAD_ID"] = mysqli_thread_id($connection);
Limit_sql_time(isset($GLOBALS["TIME_LIMIT"]) ? $GLOBALS["TIME_LIMIT"] : TIME_LIMIT_DEFAULT, $connection);

global $mail_config;
$mail_config['smtp_username'] = integram_env('INTEGRAM_SMTP_USERNAME', 'a@bi.com'); //$replyto;  // Default reply address
$mail_config['smtp_port'] = integram_env('INTEGRAM_SMTP_PORT', '465'); // Порт работы.
$mail_config['smtp_host'] = integram_env('INTEGRAM_SMTP_HOST', 'ssl://smtp.yandex.ru');  //сервер для отправки почты
$mail_config['smtp_password'] = integram_env('INTEGRAM_SMTP_PASSWORD', 'xxx');  //Измените пароль
$mail_config['smtp_debug'] = filter_var(integram_env('INTEGRAM_SMTP_DEBUG', 'true'), FILTER_VALIDATE_BOOLEAN);  //Если Вы хотите видеть сообщения ошибок, укажите true вместо false
$mail_config['smtp_charset'] = integram_env('INTEGRAM_SMTP_CHARSET', 'utf-8');	//кодировка сообщений. (windows-1251 или utf-8, итд)
$mail_config['smtp_from'] = integram_env('INTEGRAM_SMTP_FROM', 'Integram'); // "From" by default
define("ADMINEMAIL", integram_env('INTEGRAM_ADMIN_EMAIL', 'alex@gmail.com'));
define("TEMPLATES", integram_env('INTEGRAM_TEMPLATES', ':en:ru:fu:'));
$masterPassword = integram_env('INTEGRAM_MASTER_PASSWORD', 'xxx');
define("ADMINHASH", integram_env('INTEGRAM_ADMINHASH', sha1($_SERVER["SERVER_NAME"].$z.$masterPassword)));
define("SALT", integram_env('INTEGRAM_SALT', 'yyy'));
define("SMS_SADR", integram_env('INTEGRAM_SMS_SADR', 'zzz'));
define("G_CLIENT_ID", integram_env('INTEGRAM_GOOGLE_CLIENT_ID', '3nt.com'));
define("G_CLIENT_PK", integram_env('INTEGRAM_GOOGLE_CLIENT_PK', 'GOCSPX-'));
define("Y_CLIENT_ID", integram_env('INTEGRAM_YANDEX_CLIENT_ID', '9a7b699'));
define("Y_CLIENT_PK", integram_env('INTEGRAM_YANDEX_CLIENT_PK', 'b5fc3n5'));
define("SMARTCAPTCHA_CLIENT_KEY", integram_env('INTEGRAM_SMARTCAPTCHA_CLIENT_KEY', 'ysc1_2EhhILbwBUoENgVrsbujEEPhih5dgPfh4Rs2WfImcd89ae95'));
define("SMARTCAPTCHA_SERVER_KEY", integram_env('INTEGRAM_SMARTCAPTCHA_SERVER_KEY', 'ysc2_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'));

#Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");
Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");

?>
