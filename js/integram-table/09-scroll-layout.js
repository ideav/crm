        getScrollContainer() {
            return document.querySelector('.app-content') || window;
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

        /**
         * Toggles `.sticky` on `.integram-table-header` and `.sticky-header` on the wrapper
         * when the user has scrolled the header past the top of the scroll container.
         * Adjusts `top` offsets of `<th>` and filter-row cells to account for the pinned
         * header height. (issue #2051, fixed in #2055)
         */
        attachStickyHeader() {
            const tableWrapper = this.container.querySelector('.integram-table-wrapper');
            const header = this.container.querySelector('.integram-table-header');
            const tableContainer = this.container.querySelector('.integram-table-container');

            if (!tableWrapper || !header || !tableContainer) return;

            if (this._stickyHeaderScrollListener) {
                (this._stickyHeaderScrollContainer || window).removeEventListener('scroll', this._stickyHeaderScrollListener);
            }
            if (this._stickyHeaderTableScrollListener) {
                tableContainer.removeEventListener('scroll', this._stickyHeaderTableScrollListener);
            }
            if (this._stickyHeaderResizeObserver) {
                this._stickyHeaderResizeObserver.disconnect();
            }
            // Remove previous clone if any
            if (this._stickyTheadClone) {
                this._stickyTheadClone.remove();
                this._stickyTheadClone = null;
            }

            const scrollContainer = this.getScrollContainer();
            this._stickyHeaderScrollContainer = scrollContainer;

            // Cancellation token: each attachStickyHeader() call increments _stickyGeneration.
            // Async callbacks (RAF, setTimeout) capture their generation at creation time and
            // bail out if it no longer matches — this prevents stale closures from a previous
            // render() call from corrupting clone position or visibility after infinite scroll
            // triggers a new render() within the 160ms CSS-transition window (issue #2072).
            if (!this._stickyGeneration) this._stickyGeneration = 0;
            const myGeneration = ++this._stickyGeneration;
            const isCancelled = () => this._stickyGeneration !== myGeneration;

            // Build a fixed-position clone of the thead to display when the real thead
            // scrolls above the toolbar. CSS position:sticky on <th> cannot work here
            // because .integram-table-container has overflow-x:auto which implicitly sets
            // overflow-y:auto too, making it the sticky scroll container instead of
            // .app-content — so the th never sticks during vertical scroll (issue #2065).
            const theadRow = tableWrapper.querySelector('.integram-table thead tr');
            const filterRow = tableWrapper.querySelector('.integram-table .filter-row');

            const buildClone = () => {
                if (isCancelled()) return;
                if (this._stickyTheadClone) this._stickyTheadClone.remove();

                const originalThs = theadRow
                    ? Array.from(theadRow.querySelectorAll('th'))
                    : [];
                const originalFilterTds = filterRow
                    ? Array.from(filterRow.querySelectorAll('td'))
                    : [];

                if (originalThs.length === 0) return;

                const clone = document.createElement('div');
                clone.className = 'integram-sticky-thead-clone';
                clone.style.cssText = 'position:fixed;z-index:109;overflow:hidden;display:none;pointer-events:none;box-sizing:border-box;';

                const cloneTable = document.createElement('table');
                cloneTable.className = 'integram-table compact';
                cloneTable.style.cssText = 'border-collapse:collapse;table-layout:fixed;';

                const cloneThead = document.createElement('thead');
                const cloneTr = document.createElement('tr');
                originalThs.forEach(th => cloneTr.appendChild(th.cloneNode(true)));
                cloneThead.appendChild(cloneTr);
                cloneTable.appendChild(cloneThead);

                if (originalFilterTds.length > 0) {
                    const cloneFilterTr = document.createElement('tr');
                    cloneFilterTr.className = 'filter-row';
                    originalFilterTds.forEach(td => cloneFilterTr.appendChild(td.cloneNode(true)));
                    cloneThead.appendChild(cloneFilterTr);
                }

                clone.appendChild(cloneTable);
                document.body.appendChild(clone);
                this._stickyTheadClone = clone;
            };

            buildClone();

            const syncClone = () => {
                if (isCancelled()) return;
                const clone = this._stickyTheadClone;
                if (!clone) return;

                const containerRect = tableContainer.getBoundingClientRect();
                const headerBottom = header.getBoundingClientRect().bottom;
                const table = tableWrapper.querySelector('.integram-table');

                clone.style.top = headerBottom + 'px';
                clone.style.left = containerRect.left + 'px';
                clone.style.width = containerRect.width + 'px';

                const cloneTable = clone.querySelector('table');
                if (table && cloneTable) {
                    cloneTable.style.width = table.scrollWidth + 'px';
                }

                // Sync column widths from the real thead
                const originalThs = theadRow ? Array.from(theadRow.querySelectorAll('th')) : [];
                const cloneThs = Array.from(clone.querySelectorAll('thead tr:first-child th'));
                originalThs.forEach((th, i) => {
                    if (cloneThs[i]) {
                        const w = th.getBoundingClientRect().width;
                        cloneThs[i].style.width = w + 'px';
                        cloneThs[i].style.minWidth = w + 'px';
                    }
                });

                // Sync horizontal scroll
                clone.scrollLeft = tableContainer.scrollLeft;
            };

            let isStickyThead = false;

            const updateStickyThead = () => {
                if (isCancelled()) return;
                const clone = this._stickyTheadClone;
                if (!clone || !theadRow) return;

                const theadRect = theadRow.getBoundingClientRect();
                const headerBottom = header.getBoundingClientRect().bottom;
                const shouldBeSticky = theadRect.bottom <= headerBottom + 1;

                if (shouldBeSticky !== isStickyThead) {
                    isStickyThead = shouldBeSticky;
                    clone.style.display = shouldBeSticky ? 'block' : 'none';
                }

                if (isStickyThead) syncClone();
            };

            const updateStickyState = () => {
                if (isCancelled()) return;
                const headerRect = header.getBoundingClientRect();
                const containerTop = scrollContainer === window
                    ? 0
                    : scrollContainer.getBoundingClientRect().top;
                const isSticky = headerRect.top <= containerTop + 1;

                const wasSticky = header.classList.contains('sticky');
                if (isSticky !== wasSticky) {
                    header.classList.toggle('sticky', isSticky);
                    tableWrapper.classList.toggle('sticky-header', isSticky);
                    // Rebuild clone after transition to pick up padding changes (issue #2063)
                    setTimeout(() => { buildClone(); updateStickyThead(); }, 160);
                }

                updateStickyThead();
            };

            // Sync clone horizontal scroll when the table container scrolls
            this._stickyHeaderTableScrollListener = () => {
                if (!isCancelled() && isStickyThead && this._stickyTheadClone) {
                    this._stickyTheadClone.scrollLeft = tableContainer.scrollLeft;
                }
            };
            tableContainer.addEventListener('scroll', this._stickyHeaderTableScrollListener);

            this._stickyHeaderScrollListener = updateStickyState;
            scrollContainer.addEventListener('scroll', this._stickyHeaderScrollListener);

            if (typeof ResizeObserver !== 'undefined') {
                this._stickyHeaderResizeObserver = new ResizeObserver(() => {
                    if (isCancelled()) return;
                    updateStickyState();
                    if (isStickyThead) syncClone();
                });
                this._stickyHeaderResizeObserver.observe(header);
                this._stickyHeaderResizeObserver.observe(tableContainer);
            }

            requestAnimationFrame(updateStickyState);
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
