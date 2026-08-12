# Детальный план: Этап 1 — Полная реализация

## Сложность
**M** (6 коммитов)

## Обзор
Реализация полной истории диалога: от чтения JSONL до отображения в UI.

---

## Коммиты

### Коммит 1: `getFullHistory()` в work-manager.ts + тип HistoryEntry
- **Что:** 
  - Добавить `HistoryEntry` тип в `types.ts`
  - Добавить `getFullHistory(workId): HistoryEntry[]` в `work-manager.ts`
  - Читает JSONL построчно, парсит JSON, битые строки — skip + warn
  - Возвращает массив в хронологическом порядке
- **Файлы:** `src/shared/types.ts`, `src/main/work/work-manager.ts`
- **Проверка:** `npx tsc --noEmit`

### Коммит 2: IPC-канал `work:history`
- **Что:**
  - Добавить `WORK_HISTORY: 'work:history'` в `ipc-channels.ts`
  - Зарегистрировать handler в `handlers/work.ts`
- **Файлы:** `src/shared/ipc-channels.ts`, `src/main/ipc/handlers/work.ts`
- **Проверка:** `npx tsc --noEmit`

### Коммит 3: Preload bridge + ipc-client тип
- **Что:**
  - Добавить `workHistory(id)` в `preload/index.ts`
  - Добавить тип `workHistory` в `ipc-client.ts`
- **Файлы:** `src/preload/index.ts`, `src/renderer/api/ipc-client.ts`
- **Проверка:** `npx tsc --noEmit`

### Коммит 4: HTML-контейнер для истории
- **Что:**
  - Добавить `#work-history` контейнер в `#work-detail` (рядом с `#stream-events`)
  - Для `AWAITING_INPUT`: заменить `#last-result` на `#work-history`
  - Для `COMPLETED`: аналогично
- **Файлы:** `src/renderer/index.html`
- **Проверка:** визуально — контейнер на месте

### Коммит 5: CSS-стили для истории
- **Что:**
  - Стили для `.history-message`, `.history-user`, `.history-result`
  - Скроллируемый контейнер `#work-history`
  - Отступы, разделители между сообщениями
- **Файлы:** `src/renderer/styles.css`
- **Проверка:** визуально — стили применяются

### Коммит 6: JS-логика отображения истории
- **Что:**
  - `renderWorkDetail()`: для AWAITING_INPUT/COMPLETED вызывать `api.workHistory()` и рендерить историю
  - `renderHistoryEntry(entry)`: диспетчер по `type`:
    - `user` → `renderUserMessage(entry)`
    - `assistant` → `renderStreamEvent(entry)`
    - `result` → `renderResultSummary(entry)`
    - `system` → `renderStreamEvent(entry)`
  - `renderUserMessage(entry)`: простой блок «You: <текст>»
  - `renderResultSummary(entry)`: блок «📊 Turns: N · Cost: $X»
  - Обработка краевых случаев: нет JSONL → «(no history yet)»
- **Файлы:** `src/renderer/app.js`
- **Проверка:** ручное тестирование всех сценариев

---

## Порядок выполнения
1. Коммит 1 → `npx tsc --noEmit`
2. Коммит 2 → `npx tsc --noEmit`
3. Коммит 3 → `npx tsc --noEmit`
4. Коммит 4 → визуальная проверка
5. Коммит 5 → визуальная проверка
6. Коммит 6 → ручное тестирование

## Итоговая проверка этапа
- [ ] `npx tsc --noEmit` — без ошибок
- [ ] Приложение запускается
- [ ] История показывается для AWAITING_INPUT
- [ ] История показывается для COMPLETED
- [ ] Live-режим не сломан
- [ ] Нет JSONL → «(no history yet)»
- [ ] Готов к MR
