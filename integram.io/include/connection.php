<?
# Шаблон include/connection.php хоста integram.io: перед выкладкой заменить <…> реальными значениями.
$connection = mysqli_connect("localhost", "<db_user>", "<db_password>", "<db_name>") or die("Couldn't connect.");
$connection->set_charset("utf8mb4");

if(!mysqli_query($connection, "SELECT 1 FROM $z LIMIT 1") && ($z !== "auth.asp")){
    header("HTTP/1.0 404 Not found");
    die("$z does not exist");
}

global $mail_config;
$mail_config['smtp_username'] = '<smtp_user>@integram.io'; //$replyto;  // Default reply address
$mail_config['smtp_port'] = '25'; // Порт работы.
$mail_config['smtp_host'] =  'mail.integram.io';  //сервер для отправки почты
$mail_config['smtp_password'] = '<smtp_password>';  //Измените пароль
$mail_config['smtp_debug'] = false;  //Если Вы хотите видеть сообщения ошибок, укажите true вместо false
$mail_config['smtp_charset'] = 'utf-8';	//кодировка сообщений. (windows-1251 или utf-8, итд)
$mail_config['smtp_from'] = 'Integram'; // "From" by default
define("ADMINEMAIL", "<admin_email>");
define("TEMPLATES", ":en:ru:fu:");
define("ADMINHASH", sha1($_SERVER["SERVER_NAME"].$z."<master_password>"));
define("SALT", '<salt>');
define("SMS_SADR", "<sms_sender>");
define("SMS_OP", "http://gateway.api.sc/get/?user=<sms_user>&pwd=<sms_password>");
define("G_CLIENT_ID", "<google_client_id>");
define("G_CLIENT_PK", "<google_client_secret>");
define("Y_CLIENT_ID", "<yandex_client_id>");
define("Y_CLIENT_PK", "<yandex_client_secret>");

#Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");

?>
