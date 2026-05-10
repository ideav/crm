<?php
function assert_true($condition, $message){
    if(!$condition)
        throw new Exception($message);
}

function t9n($value){
    return $value;
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false)
        throw new Exception("Function not found: ".$name);

    $brace = strpos($source, "{", $start);
    if($brace === false)
        throw new Exception("Function body not found: ".$name);

    $depth = 0;
    $length = strlen($source);
    for($i = $brace; $i < $length; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }

    throw new Exception("Function body is not closed: ".$name);
}

function reset_google_project_env(){
    foreach(array(
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_PROJECT_ID",
        "GCLOUD_PROJECT",
        "GCP_PROJECT",
        "CLOUDSDK_CORE_PROJECT",
        "GOOGLE_CLOUD_PROJECT_NUMBER",
        "GOOGLE_PROJECT_NUMBER",
        "GCP_PROJECT_NUMBER",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON"
    ) as $name){
        putenv($name);
    }
}

function assert_project_endpoint($provider, $expectedProjectId, $message){
    $endpoint = prepareAiProviderEndpoint($provider, array());
    assert_true(
        strpos($endpoint, "/projects/".$expectedProjectId."/") !== false,
        $message
    );
    assert_true(
        strpos($endpoint, "{project_id}") === false,
        "Gemini endpoint should not keep the project_id placeholder"
    );
}

$root = dirname(__DIR__);
$indexPhp = file_get_contents($root."/index.php");
foreach(array(
    "getDefaultAiProviderConfig",
    "prepareAiProviderEndpoint",
    "getAiProviderProjectId",
    "getGoogleApplicationDefaultProjectId",
    "getGoogleCredentialsProjectId",
    "getGoogleMetadataProjectId",
    "aiConfigValue"
) as $functionName){
    eval(extract_function_source($indexPhp, $functionName));
}

$provider = getDefaultAiProviderConfig("gemini");
$provider["id"] = "gemini";

reset_google_project_env();
$directProvider = $provider;
$directProvider["projectId"] = "direct-gemini-project";
assert_project_endpoint(
    $directProvider,
    "direct-gemini-project",
    "Gemini endpoint should use projectId from merged provider settings"
);

reset_google_project_env();
putenv("GOOGLE_APPLICATION_CREDENTIALS_JSON=".json_encode(array(
    "type" => "service_account",
    "project_id" => "demo-gemini-project",
    "client_email" => "demo@example.iam.gserviceaccount.com",
    "private_key" => "unused"
)));
assert_project_endpoint(
    $provider,
    "demo-gemini-project",
    "Gemini endpoint should use project_id from GOOGLE_APPLICATION_CREDENTIALS_JSON"
);

reset_google_project_env();
$credentialsPath = tempnam(sys_get_temp_dir(), "issue2499-gemini-");
file_put_contents($credentialsPath, json_encode(array(
    "type" => "authorized_user",
    "quota_project_id" => "quota-gemini-project"
)));
putenv("GOOGLE_APPLICATION_CREDENTIALS=".$credentialsPath);
try {
    assert_project_endpoint(
        $provider,
        "quota-gemini-project",
        "Gemini endpoint should use quota_project_id from GOOGLE_APPLICATION_CREDENTIALS"
    );
} finally {
    unlink($credentialsPath);
    reset_google_project_env();
}

echo "ok - issue 2499 Gemini project id is discovered from ADC credentials\n";
