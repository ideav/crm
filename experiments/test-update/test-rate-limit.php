<?php
/**
 * Test to check what happens when GitHub API returns non-200 responses
 * Specifically, simulating what the production server might be seeing
 */

// Simulate a 403 Forbidden response (rate limit)
$simulatedRateLimitResponse = '{
  "message": "API rate limit exceeded for 1.2.3.4. (But here\'s the good news: Authenticated requests get a higher rate limit. Check out the documentation for more details.)",
  "documentation_url": "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting"
}';

$items = json_decode($simulatedRateLimitResponse, true);
echo "Is array: " . (is_array($items) ? "yes" : "no") . "\n";
// This would return an array because it IS a valid JSON array
// But it has a 'message' key, not an array of file objects

// The existing code checks: if (!is_array($items)) { return []; }
// But when rate-limited, the response IS a valid JSON object (not array)
// So the check passes and we iterate over it
echo "json_decode type: " . gettype($items) . "\n";

// What does the foreach do with this?
$files = [];
foreach ($items as $item) {
    echo "Item: " . print_r($item, true) . "\n";
    // $item['type'] would not equal 'file', so nothing gets added
    // But there's no error handling here - it just returns empty array
}

echo "Files found: " . count($files) . "\n";
echo "\nConclusion: When rate limited, the code silently returns [] which leads to 'Could not list directory' error\n";

// Also test what happens with a connection refused (allow_url_fopen disabled)
echo "\n=== Testing with allow_url_fopen disabled (simulated) ===\n";
echo "When allow_url_fopen is disabled, file_get_contents on http:// URLs returns false\n";
echo "The current code uses @file_get_contents which suppresses the error\n";
echo "This means: the error is suppressed and we get 'Could not list directory'\n";
echo "There is no way for the user to know WHY it failed\n";
