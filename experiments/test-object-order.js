/**
 * Test script to verify Object.entries() behavior with numeric keys
 * This demonstrates why dropdown options lose their order
 */

// Simulated server response with numeric IDs in specific order
// Server returns: [100, 5, 50, 1, 25] (some custom order)
const serverResponse = {
    "100": "Option A (ID 100)",
    "5": "Option B (ID 5)", 
    "50": "Option C (ID 50)",
    "1": "Option D (ID 1)",
    "25": "Option E (ID 25)"
};

console.log("Original object keys (iteration order):");
for (const key of Object.keys(serverResponse)) {
    console.log(`  ${key}: ${serverResponse[key]}`);
}

console.log("\nObject.entries() result:");
Object.entries(serverResponse).forEach(([id, text]) => {
    console.log(`  ${id}: ${text}`);
});

// Result: JavaScript sorts numeric string keys numerically
// Expected: 100, 5, 50, 1, 25 (server order)
// Actual: 1, 5, 25, 50, 100 (numeric ascending)

console.log("\n--- Solution: Use array of tuples to preserve order ---");

// Better approach: keep as array
const orderedResponse = [
    ["100", "Option A (ID 100)"],
    ["5", "Option B (ID 5)"],
    ["50", "Option C (ID 50)"],
    ["1", "Option D (ID 1)"],
    ["25", "Option E (ID 25)"]
];

console.log("Array of tuples (preserves order):");
orderedResponse.forEach(([id, text]) => {
    console.log(`  ${id}: ${text}`);
});
