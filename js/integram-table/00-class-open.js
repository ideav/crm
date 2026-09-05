/**
 * IntegramTable Component
 * Standalone JS module for displaying Integram API data tables with infinite scroll
 *
 * Features:
 * - Automatic column hiding for ID and Style suffix columns
 * - Infinite scroll instead of pagination
 * - Dynamic filtering with 13+ filter operators
 * - Drag & drop column reordering
 * - Column visibility settings
 * - Cookie-based state persistence
 * - Custom cell styling via style columns
 * - Clickable "?" to fetch total record count
 */

const itModalEscapeState = {
    stack: [],
    keydownHandler: null,
    cleanupByModal: new WeakMap(),
    nextLabelId: 1
};

function itAddModalDocumentListener(modal, type, handler, options) {
    if (!itIsModalConnected(modal)) return () => {};
    document.addEventListener(type, handler, options);
    const cleanup = () => document.removeEventListener(type, handler, options);
    const cleanups = itModalEscapeState.cleanupByModal.get(modal) || [];
    cleanups.push(cleanup);
    itModalEscapeState.cleanupByModal.set(modal, cleanups);
    return cleanup;
}

function itIsModalConnected(modal) {
    if (!modal) return false;
    if (typeof modal.isConnected === 'boolean') return modal.isConnected;
    return !!(document.documentElement && document.documentElement.contains(modal));
}

/**
 * Register a modal in the shared Escape stack and return an idempotent close
 * function. A single document listener serves every table instance, so closing
 * a modal by a button, backdrop, save action, or DOM removal cannot leave a
 * stale global keydown listener behind.
 */
function itCreateModalCloseHandler(modal, closeCallback, owner = null) {
    let active = true;
    let observer = null;
    const entry = { modal, close: null, unregister: null };
    const previouslyFocused = document.activeElement;
    const dialogSelector = '.edit-form-modal, .column-settings-modal, .grouping-settings-modal, .form-field-settings-modal, .integram-modal, .col-edit-modal, [role="dialog"]';
    const dialog = modal.matches && modal.matches(dialogSelector)
        ? modal
        : (modal.querySelector ? modal.querySelector(dialogSelector) : null);

    entry.dialog = dialog;
    if (dialog) {
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        const heading = dialog.querySelector('h1, h2, h3, .modal-title');
        if (heading) {
            if (!heading.id) {
                heading.id = `integram-modal-title-${ itModalEscapeState.nextLabelId++ }`;
            }
            dialog.setAttribute('aria-labelledby', heading.id);
        } else if (!dialog.hasAttribute('aria-label')) {
            dialog.setAttribute('aria-label', 'Диалоговое окно');
        }
    }
    if (document.body && document.body.classList && typeof document.body.classList.add === 'function') {
        document.body.classList.add('integram-modal-open');
    }

    const unregister = () => {
        if (!active) return;
        active = false;
        if (observer) observer.disconnect();
        const cleanups = itModalEscapeState.cleanupByModal.get(modal) || [];
        cleanups.forEach(cleanup => cleanup());
        itModalEscapeState.cleanupByModal.delete(modal);
        if (owner && owner._modalCloseHandlers) owner._modalCloseHandlers.delete(close);
        const index = itModalEscapeState.stack.indexOf(entry);
        if (index !== -1) itModalEscapeState.stack.splice(index, 1);
        if (itModalEscapeState.stack.length === 0) {
            if (itModalEscapeState.keydownHandler) {
                document.removeEventListener('keydown', itModalEscapeState.keydownHandler);
                itModalEscapeState.keydownHandler = null;
            }
            if (document.body && document.body.classList && typeof document.body.classList.remove === 'function') {
                document.body.classList.remove('integram-modal-open');
            }
        }
    };

    const close = (...args) => {
        if (!active) return;
        unregister();
        const result = closeCallback(...args);
        const restoreFocus = () => {
            if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') {
                try {
                    previouslyFocused.focus({ preventScroll: true });
                } catch (error) {
                    previouslyFocused.focus();
                }
            }
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreFocus);
        else if (typeof setTimeout === 'function') setTimeout(restoreFocus, 0);
        else restoreFocus();
        return result;
    };

    if (owner) {
        if (!(owner._modalCloseHandlers instanceof Set)) owner._modalCloseHandlers = new Set();
        owner._modalCloseHandlers.add(close);
    }

    entry.close = close;
    entry.unregister = unregister;
    itModalEscapeState.stack.push(entry);

    if (!itModalEscapeState.keydownHandler) {
        itModalEscapeState.keydownHandler = (event) => {
            if (event.defaultPrevented) return;
            while (itModalEscapeState.stack.length > 0) {
                const top = itModalEscapeState.stack[itModalEscapeState.stack.length - 1];
                if (!itIsModalConnected(top.modal)) {
                    top.unregister();
                    continue;
                }

                if (event.key === 'Escape') {
                    if (typeof event.preventDefault === 'function') event.preventDefault();
                    top.close();
                    return;
                }

                if (event.key === 'Tab') {
                    const dialogElement = top.dialog || top.modal;
                    const candidates = Array.from(dialogElement.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                        .filter(element => !element.disabled && element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);
                    if (candidates.length === 0) {
                        if (typeof event.preventDefault === 'function') event.preventDefault();
                        if (typeof dialogElement.focus === 'function') dialogElement.focus();
                        return;
                    }
                    const first = candidates[0];
                    const last = candidates[candidates.length - 1];
                    if (event.shiftKey && (document.activeElement === first || !dialogElement.contains(document.activeElement))) {
                        if (typeof event.preventDefault === 'function') event.preventDefault();
                        last.focus();
                    } else if (!event.shiftKey && (document.activeElement === last || !dialogElement.contains(document.activeElement))) {
                        if (typeof event.preventDefault === 'function') event.preventDefault();
                        first.focus();
                    }
                    return;
                }
                return;
            }
        };
        document.addEventListener('keydown', itModalEscapeState.keydownHandler);
    }

    const focusDialog = () => {
        if (!active || !dialog || !itIsModalConnected(modal) || dialog.contains(document.activeElement)) return;
        const autofocus = dialog.querySelector('[autofocus]');
        const target = autofocus || dialog;
        if (typeof target.focus === 'function') {
            try {
                target.focus({ preventScroll: true });
            } catch (error) {
                target.focus();
            }
        }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusDialog);
    else if (typeof setTimeout === 'function') setTimeout(focusDialog, 0);
    else focusDialog();

    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
        observer = new MutationObserver(() => {
            if (!itIsModalConnected(modal)) unregister();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    return close;
}

class IntegramTable{
