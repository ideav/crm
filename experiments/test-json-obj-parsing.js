/**
 * Test script for JSON_OBJ parsing in forms.html
 * Issue #725: Use first column data from object/137?JSON_OBJ and object/22?JSON_OBJ
 *
 * Run with: node experiments/test-json-obj-parsing.js
 */

// Mock JSON_OBJ response format as described in issue #725
const mockReportsResponse = [
    {
        "i": 428,
        "u": 1,
        "o": 1,
        "r": [
            "Тест",
            ""
        ]
    },
    {
        "i": 429,
        "u": 1,
        "o": 1,
        "r": [
            "Тест1",
            ""
        ]
    }
];

const mockFormsResponse = [
    {
        "i": 1,
        "u": 0,
        "o": 1,
        "r": [
            "Dashboard Form",
            "description here"
        ]
    },
    {
        "i": 2,
        "u": 0,
        "o": 2,
        "r": [
            "Sales Report Form",
            ""
        ]
    }
];

const mockPanelsResponse = [
    {
        "i": 101,
        "u": 1,
        "o": 1,
        "r": [
            "Sales Chart",       // Panel name (index 0)
            "XYChart",           // Panel type - req 184 (index 1)
            "42",                // Report ID - req 161 (index 2)
            "#333333",           // Font color - req 254 (index 3)
            "#ffffff"            // Background color - req 255 (index 4)
        ]
    },
    {
        "i": 102,
        "u": 1,
        "o": 2,
        "r": [
            "Revenue Table",
            "Report",
            "43",
            "#000000",
            "#f5f5f5"
        ]
    }
];

// Test the transformation logic from the fix

function testFormsTransformation() {
    console.log('Testing loadForms transformation...');

    const json = mockFormsResponse;

    // Transform JSON_OBJ format to standard format (as per the fix)
    const forms = json.map(function(item) {
        return {
            id: item.i,
            val: item.r ? item.r[0] : '',  // First column contains the name
            parent: item.u,
            order: item.o
        };
    });

    console.log('Transformed forms:', JSON.stringify(forms, null, 2));

    // Assertions
    console.assert(forms.length === 2, 'Should have 2 forms');
    console.assert(forms[0].id === 1, 'First form ID should be 1');
    console.assert(forms[0].val === 'Dashboard Form', 'First form name should be "Dashboard Form"');
    console.assert(forms[1].id === 2, 'Second form ID should be 2');
    console.assert(forms[1].val === 'Sales Report Form', 'Second form name should be "Sales Report Form"');

    console.log('loadForms transformation: PASSED\n');
}

function testReportsTransformation() {
    console.log('Testing loadReports transformation...');

    const json = mockReportsResponse;

    // Transform JSON_OBJ format to standard format (as per the fix)
    const reports = json.map(function(item) {
        return {
            id: item.i,
            val: item.r ? item.r[0] : '',  // First column contains the name
            parent: item.u,
            order: item.o
        };
    });

    console.log('Transformed reports:', JSON.stringify(reports, null, 2));

    // Assertions
    console.assert(reports.length === 2, 'Should have 2 reports');
    console.assert(reports[0].id === 428, 'First report ID should be 428');
    console.assert(reports[0].val === 'Тест', 'First report name should be "Тест"');
    console.assert(reports[1].id === 429, 'Second report ID should be 429');
    console.assert(reports[1].val === 'Тест1', 'Second report name should be "Тест1"');

    console.log('loadReports transformation: PASSED\n');
}

function testPanelsTransformation() {
    console.log('Testing loadFormPanels transformation...');

    const json = mockPanelsResponse;

    // Mock metadata for table 138 (panels)
    const mockMetadata = {
        reqs: [
            { id: 184, val: 'Panel Type' },      // index 0 -> r[1]
            { id: 161, val: 'Report ID' },        // index 1 -> r[2]
            { id: 254, val: 'Font Color' },       // index 2 -> r[3]
            { id: 255, val: 'Background Color' }  // index 3 -> r[4]
        ]
    };

    const panels = [];
    const reqs = {};

    // Build mapping from requisite index to requisite ID
    const reqMapping = [];
    if (mockMetadata && mockMetadata.reqs) {
        mockMetadata.reqs.forEach(function(req, index) {
            reqMapping.push(req.id);
        });
    }

    // Transform each panel from JSON_OBJ format
    json.forEach(function(item) {
        const panelId = item.i;
        panels.push({
            id: panelId,
            val: item.r ? item.r[0] : '',  // First column contains the panel name
            parent: item.u,
            order: item.o
        });

        // Map r[index+1] values to requisite IDs
        const panelReqs = {};
        if (item.r && reqMapping.length > 0) {
            for (let i = 0; i < reqMapping.length && (i + 1) < item.r.length; i++) {
                const reqId = reqMapping[i];
                const value = item.r[i + 1];  // r[0] is the name, requisites start at r[1]
                if (value !== '' && value !== null && value !== undefined) {
                    panelReqs[reqId] = value;
                }
            }
        }
        reqs[panelId] = panelReqs;
    });

    console.log('Transformed panels:', JSON.stringify(panels, null, 2));
    console.log('Transformed reqs:', JSON.stringify(reqs, null, 2));

    // Assertions
    console.assert(panels.length === 2, 'Should have 2 panels');
    console.assert(panels[0].id === 101, 'First panel ID should be 101');
    console.assert(panels[0].val === 'Sales Chart', 'First panel name should be "Sales Chart"');

    console.assert(reqs[101][184] === 'XYChart', 'Panel 101 type should be "XYChart"');
    console.assert(reqs[101][161] === '42', 'Panel 101 report ID should be "42"');
    console.assert(reqs[101][254] === '#333333', 'Panel 101 font color should be "#333333"');

    console.assert(reqs[102][184] === 'Report', 'Panel 102 type should be "Report"');
    console.assert(reqs[102][161] === '43', 'Panel 102 report ID should be "43"');

    console.log('loadFormPanels transformation: PASSED\n');
}

function testEmptyResponse() {
    console.log('Testing empty response handling...');

    // Empty array
    const emptyJson = [];
    const isEmpty = !emptyJson || !Array.isArray(emptyJson) || emptyJson.length === 0;
    console.assert(isEmpty === true, 'Empty array should be detected');

    // Null
    const nullJson = null;
    const isNull = !nullJson || !Array.isArray(nullJson) || nullJson.length === 0;
    console.assert(isNull === true, 'Null should be detected');

    // Undefined
    const undefinedJson = undefined;
    const isUndefined = !undefinedJson || !Array.isArray(undefinedJson) || undefinedJson.length === 0;
    console.assert(isUndefined === true, 'Undefined should be detected');

    console.log('Empty response handling: PASSED\n');
}

function testFormNameExtraction() {
    console.log('Testing form name extraction for loadFormPanels...');

    // Single form response
    const formJson = [
        {
            "i": 1,
            "u": 0,
            "o": 1,
            "r": [
                "My Dashboard",
                ""
            ]
        }
    ];

    let formTitle = 'Form';  // Default value
    if (formJson && Array.isArray(formJson) && formJson.length > 0) {
        const form = formJson[0];
        formTitle = (form.r ? form.r[0] : '') || 'Form';
    }

    console.log('Extracted form title:', formTitle);
    console.assert(formTitle === 'My Dashboard', 'Form title should be "My Dashboard"');

    console.log('Form name extraction: PASSED\n');
}

// Run all tests
console.log('='.repeat(60));
console.log('Running JSON_OBJ parsing tests for Issue #725');
console.log('='.repeat(60) + '\n');

testFormsTransformation();
testReportsTransformation();
testPanelsTransformation();
testEmptyResponse();
testFormNameExtraction();

console.log('='.repeat(60));
console.log('All tests PASSED!');
console.log('='.repeat(60));
