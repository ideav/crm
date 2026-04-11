        parseUnixTimestamp(value) {
            if (!value && value !== 0) return null;
            const str = String(value).trim();
            // Match digits with optional decimal part (no sign — timestamps are positive)
            if (!/^\d+(\.\d+)?$/.test(str)) return null;
            const num = parseFloat(str);
            if (isNaN(num)) return null;
            // Require at least 1e9 to distinguish from YYYYMMDD (8 digits) and other numbers.
            // Unix timestamps for years 2001+ are >= 1e9.
            if (num < 1e9) return null;
            // Heuristic: if the value is >= 1e12 treat as milliseconds (JS timestamp),
            // otherwise treat as Unix seconds.
            const ms = num >= 1e12 ? num : num * 1000;
            const date = new Date(ms);
            // Sanity check: year must be reasonable (2001–2100)
            const year = date.getFullYear();
            if (year < 2001 || year > 2100) return null;
            return date;
        }

        // Helper method to parse date format from API (supports both DD.MM.YYYY and YYYYMMDD)
        parseDDMMYYYY(dateStr) {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const trimmed = dateStr.trim();

            // Try numeric timestamp (Unix seconds or JS milliseconds)
            const tsDate = this.parseUnixTimestamp(trimmed);
            if (tsDate) return tsDate;

            // Try YYYYMMDD format first (exactly 8 digits)
            if (/^\d{8}$/.test(trimmed)) {
                const year = parseInt(trimmed.substring(0, 4), 10);
                const month = parseInt(trimmed.substring(4, 6), 10);
                const day = parseInt(trimmed.substring(6, 8), 10);

                if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

                // Validate month and day ranges
                if (month < 1 || month > 12 || day < 1 || day > 31) return null;

                // Month is 0-indexed in JavaScript Date
                return new Date(year, month - 1, day);
            }

            // Try DD.MM.YYYY format
            const parts = trimmed.split('.');
            if (parts.length !== 3) return null;
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);
            if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day);
        }

        // Helper method to parse DD.MM.YYYY HH:MM:SS datetime format from API
        parseDDMMYYYYHHMMSS(datetimeStr) {
            if (!datetimeStr || typeof datetimeStr !== 'string') return null;

            // Try numeric timestamp first (Unix seconds or JS milliseconds)
            const tsDate = this.parseUnixTimestamp(datetimeStr.trim());
            if (tsDate) return tsDate;

            const parts = datetimeStr.trim().split(' ');
            if (parts.length !== 2) return this.parseDDMMYYYY(datetimeStr); // Fallback to date-only

            const dateParts = parts[0].split('.');
            const timeParts = parts[1].split(':');

            if (dateParts.length !== 3 || timeParts.length !== 3) return null;

            const day = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10);
            const year = parseInt(dateParts[2], 10);
            const hour = parseInt(timeParts[0], 10);
            const minute = parseInt(timeParts[1], 10);
            const second = parseInt(timeParts[2], 10);

            if (isNaN(day) || isNaN(month) || isNaN(year) ||
                isNaN(hour) || isNaN(minute) || isNaN(second)) return null;

            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day, hour, minute, second);
        }

        // Helper method to parse YYYYMMDD date format from API
        parseYYYYMMDD(dateStr) {
            if (!dateStr || typeof dateStr !== 'string') return null;
            const trimmed = dateStr.trim();

            // Check if it matches YYYYMMDD format (exactly 8 digits)
            if (!/^\d{8}$/.test(trimmed)) return null;

            const year = parseInt(trimmed.substring(0, 4), 10);
            const month = parseInt(trimmed.substring(4, 6), 10);
            const day = parseInt(trimmed.substring(6, 8), 10);

            if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

            // Validate month and day ranges
            if (month < 1 || month > 12 || day < 1 || day > 31) return null;

            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day);
        }

        // Format Date object for display as DD.MM.YYYY
        formatDateDisplay(dateObj) {
            if (!dateObj || isNaN(dateObj.getTime())) return '';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            return `${ day }.${ month }.${ year }`;
        }

        // Format Date object for display as DD.MM.YYYY hh:mm:ss
        formatDateTimeDisplay(dateObj) {
            if (!dateObj || isNaN(dateObj.getTime())) return '';
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const hours = String(dateObj.getHours()).padStart(2, '0');
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const seconds = String(dateObj.getSeconds()).padStart(2, '0');
            return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
        }

