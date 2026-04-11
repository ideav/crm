
// Global registry for all IntegramTable instances
if (typeof window !== 'undefined') {
    window._integramTableInstances = window._integramTableInstances || [];
}

/**
 * Global function to reload all IntegramTable instances
 * Reloads all table components with their current filter parameters
 * This function is globally accessible and can be called from anywhere on the page
 *
 * @example
 * // Reload all tables on the page
 * reloadAllIntegramTables();
 */
function reloadAllIntegramTables() {
    if (typeof window !== 'undefined' && window._integramTableInstances) {
        window._integramTableInstances.forEach(instance => {
            if (instance && typeof instance.reload === 'function') {
                instance.reload();
            }
        });
    }
}

// Make the function globally accessible
if (typeof window !== 'undefined') {
    window.reloadAllIntegramTables = reloadAllIntegramTables;
}

/**
 * Global function to open a record creation form from anywhere on the page.
 * This function can be called independently of any IntegramTable instance.
 *
 * @param {number|string} tableTypeId - Required. ID of the table in which to create the record.
 * @param {number|string} parentId - Required. Parent ID to pass in the "up" parameter when creating the record.
 * @param {Object} [fieldValues={}] - Optional. Object with field values to pre-fill on the form.
 *                                    Keys should be in format "t{fieldId}", e.g. {'t3888': 357, 't3886': 'Отказались'}.
 *
 * @example
 * // Open form to create a record in table 3596 with parent 1
 * openCreateRecordForm(3596, 1);
 *
 * @example
 * // Open form with pre-filled field values
 * openCreateRecordForm(3596, 1, {'t3888': 357, 't3886': 'Отказались'});
 */
async function openCreateRecordForm(tableTypeId, parentId, fieldValues = {}) {
    if (!tableTypeId) {
        console.error('openCreateRecordForm: tableTypeId is required');
        return;
    }
    if (!parentId && parentId !== 0) {
        console.error('openCreateRecordForm: parentId is required');
        return;
    }

    try {
        // Determine API base from current page URL
        const pathParts = window.location.pathname.split('/');
        let apiBase = '';
        if (pathParts.length >= 2 && pathParts[1]) {
            apiBase = window.location.origin + '/' + pathParts[1];
        }

        if (!apiBase) {
            console.error('openCreateRecordForm: Could not determine API base URL');
            return;
        }

        // Fetch metadata for the table type
        // Use globalMetadata from an existing IntegramTable instance if available (issue #783)
        let metadata = null;
        if (window._integramTableInstances && window._integramTableInstances.length > 0) {
            for (const inst of window._integramTableInstances) {
                if (inst && inst.globalMetadata) {
                    const cached = inst.globalMetadata.find(item => item.id === tableTypeId || item.id === Number(tableTypeId));
                    if (cached) {
                        metadata = cached;
                        break;
                    }
                }
            }
        }

        if (!metadata) {
            const metadataUrl = `${apiBase}/metadata/${tableTypeId}`;
            const metadataResponse = await fetch(metadataUrl);

            if (!metadataResponse.ok) {
                throw new Error(`Failed to fetch metadata: ${metadataResponse.statusText}`);
            }

            metadata = await metadataResponse.json();
        }

        // Convert fieldValues to recordData format for pre-filling
        // Input: {'t3888': 357, 't3886': 'Отказались'}
        // Output: {obj: {val: ''}, reqs: {3888: {value: 357}, 3886: {value: 'Отказались'}}}
        const recordData = {
            obj: { val: '', parent: parentId },
            reqs: {}
        };

        // Check if main field (t{tableTypeId}) is in fieldValues
        const mainFieldKey = `t${tableTypeId}`;
        if (fieldValues[mainFieldKey] !== undefined) {
            recordData.obj.val = fieldValues[mainFieldKey];
        }

        // Process other field values
        for (const [key, value] of Object.entries(fieldValues)) {
            // Match t{fieldId} format
            const match = key.match(/^t(\d+)$/);
            if (match) {
                const fieldId = match[1];
                // Skip main field as it's handled separately
                if (fieldId !== String(tableTypeId)) {
                    recordData.reqs[fieldId] = { value: value };
                }
            }
        }

        // Fetch parent info if parentId is not 1 (root)
        let parentInfo = null;
        if (String(parentId) !== '1') {
            try {
                // Find parent type by searching globalMetadata for a type that has
                // arr_id === tableTypeId in its reqs (metadata.up is 0 for all table types)
                let parentTypeId = null;
                const globalMetadata = window._integramTableInstances &&
                    window._integramTableInstances.find(inst => inst && inst.globalMetadata);
                const allMeta = globalMetadata ? globalMetadata.globalMetadata : null;
                if (Array.isArray(allMeta)) {
                    const parentMeta = allMeta.find(t => t.reqs &&
                        t.reqs.some(req => String(req.arr_id) === String(tableTypeId)));
                    if (parentMeta) {
                        parentTypeId = String(parentMeta.id);
                    }
                }
                if (parentTypeId) {
                    const parentUrl = `${apiBase}/object/${parentTypeId}/?JSON_OBJ&t${parentTypeId}=@${parentId}`;
                    const parentResponse = await fetch(parentUrl);
                    if (parentResponse.ok) {
                        const parentData = await parentResponse.json();
                        if (Array.isArray(parentData) && parentData.length > 0) {
                            const item = parentData[0];
                            parentInfo = {
                                id: item.i,
                                val: item.r ? (item.r[0] || '') : '',
                                typ_name: ''
                            };
                        }
                    }
                }
            } catch (parentError) {
                // Silently fail - parent info is optional, form should still work
                console.warn('openCreateRecordForm: Could not fetch parent info:', parentError);
            }
        }

        // Create the modal using a minimal helper class instance
        // This reuses the existing form rendering logic from IntegramTable
        const helper = new IntegramCreateFormHelper(apiBase, tableTypeId, parentId);
        helper.renderCreateFormModal(metadata, recordData, fieldValues, parentInfo);

    } catch (error) {
        console.error('openCreateRecordForm: Error opening form:', error);
        // Show error toast if available
        if (typeof showToast === 'function') {
            showToast(`Ошибка: ${error.message}`, 'error');
        } else {
            console.error(`Ошибка: ${error.message}`);
        }
    }
}

/**
 * Helper class for rendering create form modals independently of IntegramTable instances.
 * This allows openCreateRecordForm to work without requiring an existing table on the page.
 */
