<?php

class Http
{
    /** @return array{code:int, body:string, error:string} */
    public static function request($method, $url, array $headers = array(), $body = null, $timeout = 60)
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_FOLLOWLOCATION => false,
        ));
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        $resp = curl_exec($ch);
        $out = array(
            'code' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE),
            'body' => $resp === false ? '' : (string)$resp,
            'error' => (string)curl_error($ch),
        );
        curl_close($ch);
        return $out;
    }
}
