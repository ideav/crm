        attachScrollListener() {
            const tableWrapper = this.container.querySelector('.integram-table-wrapper');
            if (!tableWrapper) return;

            // Remove existing scroll listener if any
            if (this.scrollListener) {
                window.removeEventListener('scroll', this.scrollListener);
            }

            this.scrollListener = () => {
                if (this.isLoading || !this.hasMore) return;

                const rect = tableWrapper.getBoundingClientRect();
                const scrollThreshold = 200;  // Load more when 200px from bottom

                // Check if user scrolled near the bottom of the table
                if (rect.bottom - window.innerHeight < scrollThreshold) {
                    this.loadData(true);  // Append mode
                }
            };

            window.addEventListener('scroll', this.scrollListener);
        }

        checkAndLoadMore() {
            // Check if table fits entirely on screen and there are more records
            setTimeout(() => {
                // First check if container exists
                if (!this.container) return;
                const tableWrapper = this.container.querySelector('.integram-table-wrapper');
                if (!tableWrapper || this.isLoading || !this.hasMore) return;

                const rect = tableWrapper.getBoundingClientRect();
                // If table bottom is above viewport bottom (table fits on screen), load more
                if (rect.bottom < window.innerHeight - 50) {
                    this.loadData(true);  // Append mode
                }
            }, 100);  // Small delay to ensure DOM is updated
        }

        attachStickyScrollbar() {
            const tableContainer = this.container.querySelector('.integram-table-container');
            const stickyScrollbar = document.getElementById(`${this.container.id}-sticky-scrollbar`);
            const stickyContent = stickyScrollbar?.querySelector('.integram-table-sticky-scrollbar-content');

            if (!tableContainer || !stickyScrollbar || !stickyContent) return;

            // Set sticky scrollbar content width to match table width
            const updateStickyWidth = () => {
                const table = tableContainer.querySelector('.integram-table');
                if (table) {
                    stickyContent.style.width = table.scrollWidth + 'px';
                }
            };

            // Sync scroll positions
            const syncFromTable = () => {
                if (!this.isSyncingScroll) {
                    this.isSyncingScroll = true;
                    stickyScrollbar.scrollLeft = tableContainer.scrollLeft;
                    this.isSyncingScroll = false;
                }
            };

            const syncFromSticky = () => {
                if (!this.isSyncingScroll) {
                    this.isSyncingScroll = true;
                    tableContainer.scrollLeft = stickyScrollbar.scrollLeft;
                    this.isSyncingScroll = false;
                }
            };

            // Show/hide sticky scrollbar based on table container visibility
            const checkStickyVisibility = () => {
                const rect = tableContainer.getBoundingClientRect();
                const tableBottom = rect.bottom;
                const viewportHeight = window.innerHeight;

                // Show sticky scrollbar if table scrollbar is below viewport
                if (tableBottom > viewportHeight && tableContainer.scrollWidth > tableContainer.clientWidth) {
                    stickyScrollbar.style.display = 'block';
                } else {
                    stickyScrollbar.style.display = 'none';
                }
            };

            // Remove existing listeners if any
            if (this.tableScrollListener) {
                tableContainer.removeEventListener('scroll', this.tableScrollListener);
            }
            if (this.stickyScrollListener) {
                stickyScrollbar.removeEventListener('scroll', this.stickyScrollListener);
            }
            if (this.stickyVisibilityListener) {
                window.removeEventListener('scroll', this.stickyVisibilityListener);
                window.removeEventListener('resize', this.stickyVisibilityListener);
            }

            // Attach listeners
            this.tableScrollListener = syncFromTable;
            this.stickyScrollListener = syncFromSticky;
            this.stickyVisibilityListener = () => {
                checkStickyVisibility();
                updateStickyWidth();
            };

            tableContainer.addEventListener('scroll', this.tableScrollListener);
            stickyScrollbar.addEventListener('scroll', this.stickyScrollListener);
            window.addEventListener('scroll', this.stickyVisibilityListener);
            window.addEventListener('resize', this.stickyVisibilityListener);

            // Initial setup
            updateStickyWidth();
            checkStickyVisibility();
        }

        /**
         * Position scroll counter relative to the table wrapper (issue #656)
         * This ensures the counter stays within the table area and doesn't overlap with sidebar menu.
         * Uses .app-content left edge to remain stable during horizontal table scroll (issue #1010).
         */
        attachScrollCounterPositioning() {
            const tableWrapper = this.container.querySelector('.integram-table-wrapper');
            const scrollCounter = this.container.querySelector('.scroll-counter');

            if (!tableWrapper || !scrollCounter) return;

            const updateScrollCounterPosition = () => {
                // Use .app-content left edge instead of tableWrapper, so the counter stays
                // at a fixed viewport position when the table scrolls horizontally (issue #1010).
                const appContent = document.querySelector('.app-content');
                const anchorEl = appContent || tableWrapper;
                const rect = anchorEl.getBoundingClientRect();
                scrollCounter.style.left = (rect.left + 20) + 'px';
            };

            // Remove existing listeners if any
            if (this.scrollCounterResizeListener) {
                window.removeEventListener('resize', this.scrollCounterResizeListener);
            }
            if (this.scrollCounterScrollListener) {
                window.removeEventListener('scroll', this.scrollCounterScrollListener, true);
            }
            if (this.scrollCounterResizeObserver) {
                this.scrollCounterResizeObserver.disconnect();
            }

            // Store the listener reference for cleanup
            this.scrollCounterResizeListener = updateScrollCounterPosition;
            this.scrollCounterScrollListener = updateScrollCounterPosition;

            // Attach resize listener
            window.addEventListener('resize', this.scrollCounterResizeListener);

            // Attach scroll listener (capture phase to catch all scroll events including sidebar resize)
            window.addEventListener('scroll', this.scrollCounterScrollListener, true);

            // Use ResizeObserver to detect sidebar resize and other layout changes
            if (typeof ResizeObserver !== 'undefined') {
                this.scrollCounterResizeObserver = new ResizeObserver(updateScrollCounterPosition);
                // Observe the parent container that includes the sidebar
                const appContent = document.querySelector('.app-content');
                if (appContent) {
                    this.scrollCounterResizeObserver.observe(appContent);
                }
                // Also observe the table wrapper itself
                this.scrollCounterResizeObserver.observe(tableWrapper);
            }

            // Initial position update
            updateScrollCounterPosition();
        }

        attachColumnResizeHandlers() {
            const resizeHandles = this.container.querySelectorAll('.column-resize-handle');

            resizeHandles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const columnId = handle.dataset.columnId;
                    const th = handle.parentElement;
                    const startX = e.pageX;
                    const startWidth = th.offsetWidth;

                    const onMouseMove = (e) => {
                        const diff = e.pageX - startX;
                        const newWidth = Math.max(50, startWidth + diff);  // Min width 50px

                        th.style.width = newWidth + 'px';
                        th.style.minWidth = newWidth + 'px';
                        this.columnWidths[columnId] = newWidth;
                    };

                    const onMouseUp = () => {
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                        this.saveColumnState();
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });
            });
        }

