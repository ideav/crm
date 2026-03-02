# crm

## Правила разработки

### Запрещено использовать `alert()`, `confirm()`, `prompt()`

Никогда не используй нативные диалоги браузера (`alert()`, `confirm()`, `prompt()`).
Вместо них используй модальные окна:

- Для подтверждения удаления — метод `showDeleteConfirmModal(message)` (в `MainAppController`)
  или `showDeleteConfirmModal()` (в `IntegTable`)
- Для вывода ошибок — метод `showErrorModal(message)` (в `MainAppController`)
  или `showWarningModal(message)` (в `IntegTable`)

Нативные диалоги блокируют поток выполнения, плохо выглядят и не поддаются стилизации.