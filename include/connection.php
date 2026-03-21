<?php
$connection = mysqli_connect("localhost", "ideav", "x", "ideav") or die("Couldn't connect.");
$connection->set_charset("utf8mb4");

global $mail_config;
$mail_config['smtp_username'] = 'a@bi.com'; //$replyto;  // Default reply address
$mail_config['smtp_port'] = '465'; // Порт работы.
$mail_config['smtp_host'] =  'ssl://smtp.yandex.ru';  //сервер для отправки почты
$mail_config['smtp_password'] = 'xxx';  //Измените пароль
$mail_config['smtp_debug'] = true;  //Если Вы хотите видеть сообщения ошибок, укажите true вместо false
$mail_config['smtp_charset'] = 'utf-8';	//кодировка сообщений. (windows-1251 или utf-8, итд)
$mail_config['smtp_from'] = 'Integram'; // "From" by default
define("ADMINEMAIL", "alex@gmail.com");
define("TEMPLATES", ":en:ru:fu:");
define("ADMINHASH", sha1($_SERVER["SERVER_NAME"].$z."xxx"));
define("SALT", 'yyy');
define("SMS_SADR", "zzz");
define("G_CLIENT_ID", "3nt.com");
define("G_CLIENT_PK", "GOCSPX-");
define("Y_CLIENT_ID", "9a7b699");
define("Y_CLIENT_PK", "b5fc3n5");

#Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");
Exec_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'", "Set sql_mode");

?>
