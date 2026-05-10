<?php
function assertIssue2501($condition, $message){
    if(!$condition){
        fwrite(STDERR, $message."\n");
        exit(1);
    }
}

function t9n($value){
    return $value;
}

function extractFunctionSourceIssue2501($source, $name, $required = true){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false){
        if($required)
            throw new Exception("Function not found: ".$name);
        return "";
    }

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

function resetGoogleProjectEnvIssue2501(){
    foreach(array(
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_PROJECT_ID",
        "GCLOUD_PROJECT",
        "GCP_PROJECT",
        "CLOUDSDK_CORE_PROJECT",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_APPLICATION_CREDENTIALS_JSON"
    ) as $name){
        putenv($name);
    }
}

function assertGeminiProjectEndpointIssue2501($provider, $expectedProjectId, $message){
    try {
        $endpoint = prepareAiProviderEndpoint($provider, array());
    } catch(Exception $exception) {
        fwrite(STDERR, $message."\n".$exception->getMessage()."\n");
        exit(1);
    }
    assertIssue2501(
        strpos($endpoint, "/projects/".$expectedProjectId."/") !== false,
        $message."\nEndpoint: ".$endpoint
    );
    assertIssue2501(
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
    "aiConfigValue"
) as $functionName){
    eval(extractFunctionSourceIssue2501($indexPhp, $functionName));
}
foreach(array(
    "getGoogleApplicationDefaultProjectId",
    "getGoogleCredentialsProjectId",
    "getGoogleMetadataProjectId"
) as $functionName){
    $source = extractFunctionSourceIssue2501($indexPhp, $functionName, false);
    if($source !== "")
        eval($source);
}

$provider = getDefaultAiProviderConfig("gemini");
$provider["id"] = "gemini";

resetGoogleProjectEnvIssue2501();
$directProvider = $provider;
$directProvider["projectId"] = "direct-gemini-project";
assertGeminiProjectEndpointIssue2501(
    $directProvider,
    "direct-gemini-project",
    "Gemini endpoint should use projectId from merged provider settings"
);

resetGoogleProjectEnvIssue2501();
putenv("CLOUDSDK_CORE_PROJECT=cloudsdk-gemini-project");
assertGeminiProjectEndpointIssue2501(
    $provider,
    "cloudsdk-gemini-project",
    "Gemini endpoint should use CLOUDSDK_CORE_PROJECT"
);

resetGoogleProjectEnvIssue2501();
putenv("GOOGLE_APPLICATION_CREDENTIALS_JSON=".json_encode(array(
    "type" => "service_account",
    "project_id" => "demo-gemini-project",
    "client_email" => "demo@example.iam.gserviceaccount.com",
    "private_key" => "unused"
)));
assertGeminiProjectEndpointIssue2501(
    $provider,
    "demo-gemini-project",
    "Gemini endpoint should use project_id from GOOGLE_APPLICATION_CREDENTIALS_JSON"
);

resetGoogleProjectEnvIssue2501();
$credentialsPath = tempnam(sys_get_temp_dir(), "issue2501-gemini-");
file_put_contents($credentialsPath, json_encode(array(
    "type" => "authorized_user",
    "quota_project_id" => "quota-gemini-project"
)));
putenv("GOOGLE_APPLICATION_CREDENTIALS=".$credentialsPath);
try {
    assertGeminiProjectEndpointIssue2501(
        $provider,
        "quota-gemini-project",
        "Gemini endpoint should use quota_project_id from GOOGLE_APPLICATION_CREDENTIALS"
    );
} finally {
    unlink($credentialsPath);
    resetGoogleProjectEnvIssue2501();
}

echo "ok - issue 2501 Gemini project id is discovered from provider and ADC credentials\n";
