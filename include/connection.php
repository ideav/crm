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

$connection = mysqli_connect($dbHost, $dbUser, $dbPassword, $dbName, $dbPort) or die("Couldn't connect.");
$connection->set_charset("utf8mb4");

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
# VK ID и Telegram — соцвход для публичных приложений (#3946). Реальные значения
# задаются переменными окружения на сервере; в репозитории — пустые заглушки,
# секреты в git не попадают (тот же приём, что и для Yandex/Google выше).
define("VK_CLIENT_ID", integram_env('INTEGRAM_VK_CLIENT_ID', ''));   # ID приложения VK ID
define("VK_CLIENT_PK", integram_env('INTEGRAM_VK_CLIENT_PK', ''));   # Защищённый ключ VK ID
define("TG_BOT_TOKEN", integram_env('INTEGRAM_TG_BOT_TOKEN', ''));   # Токен бота из @BotFather
define("TG_BOT_NAME",  integram_env('INTEGRAM_TG_BOT_NAME', ''));    # Публичный username бота (для Login Widget)

#Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");
Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");

?>
