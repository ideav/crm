<?php
function assertIssue2505($condition, $message){
    if(!$condition){
        fwrite(STDERR, $message."\n");
        exit(1);
    }
}

function t9n($value){
    return $value;
}

function extractFunctionSourceIssue2505($source, $name, $required = true){
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

function resetGoogleProjectEnvIssue2505(){
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
    eval(extractFunctionSourceIssue2505($indexPhp, $functionName));
}

resetGoogleProjectEnvIssue2505();
$provider = getDefaultAiProviderConfig("gemini");
$provider["id"] = "gemini";

try {
    $endpoint = prepareAiProviderEndpoint($provider, array());
} catch(Exception $exception) {
    fwrite(STDERR, "Gemini endpoint should use the configured default project number\n".$exception->getMessage()."\n");
    exit(1);
} finally {
    resetGoogleProjectEnvIssue2505();
}

assertIssue2505(
    strpos($endpoint, "/projects/944712482341/") !== false,
    "Gemini endpoint should use project number 944712482341 by default\nEndpoint: ".$endpoint
);
assertIssue2505(
    strpos($endpoint, "{project_id}") === false,
    "Gemini endpoint should not keep the project_id placeholder"
);

echo "ok - issue 2505 Gemini uses default project number 944712482341\n";
