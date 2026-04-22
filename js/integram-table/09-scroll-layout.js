        getScrollContainer() {
            // The table container is the scroll context for vertical scrolling (issue #2083).
            // overflow-y:clip degrades to hidden when combined with overflow-x:auto (CSS spec),
            // so we give the container a computed max-height and make it scroll vertically.
            const tableContainer = this.container && this.container.querySelector('.integram-table-container');
            return tableContainer || document.querySelector('.app-content') || window;
        }

        /**
         * Set the max-height of .integram-table-container so it fills the remaining
         * vertical space inside .app-content, making position:sticky on <th> work
         * (the container itself becomes the vertical scroll container, issue #2083).
         */
        updateContainerHeight() {
            const tableContainer = this.container && this.container.querySelector('.integram-table-container');
            if (!tableContainer) return;

            const appContent = document.querySelector('.app-content');
            const scrollRoot = appContent || document.documentElement;

            // Distance from the top of the container to the bottom of the scroll root
            const containerRect = tableContainer.getBoundingClientRect();
            const rootRect = scrollRoot.getBoundingClientRect();

            // Available height = bottom of scroll root minus top of table container, minus a small gap
            const available = rootRect.bottom - containerRect.top - 4;

            // Apply only when there is a meaningful constraint (at least 100px)
            if (available > 100) {
                tableContainer.style.maxHeight = available + 'px';
            } else {
                tableContainer.style.maxHeight = '';
            }
        }

        attachScrollListener() {
            const tableWrapper = this.container.querySelector('.integram-table-wrapper');
            if (!tableWrapper) return;

            const scrollContainer = this.getScrollContainer();

            // Remove existing scroll listener if any
            if (this.scrollListener) {
                (this._scrollListenerContainer || window).removeEventListener('scroll', this.scrollListener);
            }

            this._scrollListenerContainer = scrollContainer;

            this.scrollListener = () => {
                const decision = this.getScrollLoadDecision(tableWrapper, 'scroll');
                this.traceScrollLoadDecision(decision);
                if (decision.shouldLoad) {
                    this.loadData(true);  // Append mode
                }
            };

            scrollContainer.addEventListener('scroll', this.scrollListener);
        }

        getScrollLoadDecision(tableWrapper, source) {
            const scrollContainer = this.getScrollContainer();
            const isWindow = scrollContainer === window;
            const scrollY = isWindow ? window.scrollY : scrollContainer.scrollTop;
            const viewportHeight = isWindow ? window.innerHeight : scrollContainer.clientHeight;
            const scrollHeight = isWindow ? document.documentElement.scrollHeight : scrollContainer.scrollHeight;

            const state = {
                source,
                isLoading: this.isLoading,
                hasMore: this.hasMore,
                loadedRecords: this.loadedRecords,
                pageSize: this.options.pageSize,
                scrollY,
                viewportHeight,
                scrollHeight,
                tableBottom: null,
                belowFold: null,
                threshold: viewportHeight / 2,
                reason: '',
                shouldLoad: false
            };

            if (this.isLoading) {
                state.reason = 'already-loading';
                return state;
            }
            if (!this.hasMore) {
                state.reason = 'no-more-records';
                return state;
            }
            if (!tableWrapper) {
                state.reason = 'missing-table-wrapper';
                return state;
            }

            const rect = tableWrapper.getBoundingClientRect();
            const containerBottom = isWindow ? window.innerHeight : scrollContainer.getBoundingClientRect().bottom;
            state.tableBottom = rect.bottom;
            state.belowFold = rect.bottom - containerBottom;

            if (state.belowFold < state.threshold) {
                state.reason = 'near-table-bottom';
                state.shouldLoad = true;
                return state;
            }

            state.reason = 'waiting-for-scroll';
            return state;
        }

        traceScrollLoadDecision(decision) {
            if (!window.INTEGRAM_DEBUG) return;
            console.log('[TRACE] Infinite scroll decision:', decision);
        }

        attachPlusKeyShortcut() {
            // Remove existing listener if any (issue #1532)
            if (this.plusKeyListener) {
                document.removeEventListener('keydown', this.plusKeyListener);
            }

            this.plusKeyListener = (e) => {
                // Only trigger when '+' is pressed and no input/textarea/select is focused
                if (e.key !== '+') return;
                const tag = document.activeElement && document.activeElement.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
                if (document.activeElement && document.activeElement.isContentEditable) return;

                // Try .column-add-btn.title-create-btn first, then any .column-add-btn (issue #1532)
                const btn = this.container.querySelector('.column-add-btn.title-create-btn')
                    || this.container.querySelector('.column-add-btn');
                if (btn) {
                    e.preventDefault();
                    btn.click();
                }
            };

            document.addEventListener('keydown', this.plusKeyListener);
        }

        checkAndLoadMore() {
            // Check if table fits entirely on screen and there are more records
            setTimeout(() => {
                // First check if container exists
                if (!this.container) return;
                const tableWrapper = this.container.querySelector('.integram-table-wrapper');
                const decision = this.getScrollLoadDecision(tableWrapper, 'post-render-check');
                this.traceScrollLoadDecision(decision);
                if (decision.shouldLoad) {
                    this.loadData(true);  // Append mode
                }
            }, 100);  // Small delay to ensure DOM is updated
        }

        /**
         * Attach a ResizeObserver so updateContainerHeight() is re-run whenever the
         * viewport or .app-content changes size (sidebar resize, window resize, etc.).
         */
        attachContainerHeightObserver() {
            if (this._containerHeightObserver) {
                this._containerHeightObserver.disconnect();
            }
            if (typeof ResizeObserver === 'undefined') {
                window.addEventListener('resize', () => this.updateContainerHeight());
                return;
            }
            this._containerHeightObserver = new ResizeObserver(() => this.updateContainerHeight());
            const appContent = document.querySelector('.app-content');
            if (appContent) this._containerHeightObserver.observe(appContent);
            const tableWrapper = this.container && this.container.querySelector('.integram-table-wrapper');
            if (tableWrapper) this._containerHeightObserver.observe(tableWrapper);
        }

        /**
         * Set sticky top offset for the filter row so it sticks below the column headers (issue #2079).
         * The column headers use position:sticky with top:0; the filter row needs top = total thead height
         * above it. Must be called after each render because smart-grouping can produce multiple header rows.
         */
        updateFilterRowStickyTop() {
            const thead = this.container.querySelector('.integram-table thead');
            if (!thead) return;
            const filterRow = thead.querySelector('.filter-row');
            if (!filterRow) return;

            // Sum the heights of all header rows that precede the filter row.
            let headerHeight = 0;
            const rows = thead.querySelectorAll('tr');
            for (const row of rows) {
                if (row === filterRow) break;
                headerHeight += row.getBoundingClientRect().height;
            }

            filterRow.querySelectorAll('td').forEach(td => {
                td.style.top = headerHeight + 'px';
            });
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

            const scrollContainer = this.getScrollContainer();

            // Remove existing listeners if any
            if (this.tableScrollListener) {
                tableContainer.removeEventListener('scroll', this.tableScrollListener);
            }
            if (this.stickyScrollListener) {
                stickyScrollbar.removeEventListener('scroll', this.stickyScrollListener);
            }
            if (this.stickyVisibilityListener) {
                (this._stickyScrollContainer || window).removeEventListener('scroll', this.stickyVisibilityListener);
                window.removeEventListener('resize', this.stickyVisibilityListener);
            }

            this._stickyScrollContainer = scrollContainer;

            // Attach listeners
            this.tableScrollListener = syncFromTable;
            this.stickyScrollListener = syncFromSticky;
            this.stickyVisibilityListener = () => {
                checkStickyVisibility();
                updateStickyWidth();
            };

            tableContainer.addEventListener('scroll', this.tableScrollListener);
            stickyScrollbar.addEventListener('scroll', this.stickyScrollListener);
            scrollContainer.addEventListener('scroll', this.stickyVisibilityListener);
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

            const updateScrollCounterOpacity = () => {
                // Make scroll-counter semi-transparent when table rows are beneath it (issue #1922)
                const tbody = this.container.querySelector('.integram-table tbody');
                if (!tbody) return;
                const counterRect = scrollCounter.getBoundingClientRect();
                const tbodyRect = tbody.getBoundingClientRect();
                // Rows are beneath the counter if tbody bottom is below counter top
                // and tbody top is above counter bottom (overlap in vertical axis)
                const overlaps = tbodyRect.bottom > counterRect.top && tbodyRect.top < counterRect.bottom;
                scrollCounter.classList.toggle('rows-beneath', overlaps);
            };

            const updateScrollCounterPosition = () => {
                // Use .app-content left edge instead of tableWrapper, so the counter stays
                // at a fixed viewport position when the table scrolls horizontally (issue #1010).
                const appContent = document.querySelector('.app-content');
                const anchorEl = appContent || tableWrapper;
                const rect = anchorEl.getBoundingClientRect();
                scrollCounter.style.left = (rect.left + 20) + 'px';
                updateScrollCounterOpacity();
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
