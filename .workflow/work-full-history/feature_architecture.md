# Архитектура: Полная история диалога Work

## Обзор
Добавляем чтение полной истории из JSONL в main-процессе, передачу через IPC и отображение в renderer. Паттерн полностью повторяет существующий `getLastResult()` → `WORK_GET` → `renderWorkDetail()`, только вместо одного последнего результата возвращаем массив всех событий.

## Структура модулей
| Модуль | Тип | Назначение |
|--------|-----|------------|
| `src/main/work/work-manager.ts` | существующий | Добавить `getFullHistory()` |
| `src/shared/ipc-channels.ts` | существующий | Добавить `WORK_HISTORY` |
| `src/shared/types.ts` | существующий | Добавить `HistoryEntry` тип |
| `src/main/ipc/handlers/work.ts` | существующий | Зарегистрировать `work:history` |
| `src/preload/index.ts` | существующий | Добавить `workHistory` bridge |
| `src/renderer/api/ipc-client.ts` | существующий | Добавить тип `workHistory` |
| `src/renderer/app.js` | существующий | Изменить `renderWorkDetail()` |
| `src/renderer/index.html` | существующий | Добавить `#work-history` контейнер |
| `src/renderer/styles.css` | существующий | Стили для `.history-message` |

## Архитектурные слои

### Main Process (Data)
- **`getFullHistory(workId): HistoryEntry[]`** — читает JSONL, парсит построчно, возвращает массив. Битые строки — skip + warn.

### IPC (Transport)
- Канал `work:history` — `(id: string) => Promise<{ messages: HistoryEntry[] }>`

### Preload (Bridge)
- `workHistory(id: string): Promise<{ messages: HistoryEntry[] }>` — тонкая обёртка над `ipcRenderer.invoke`

### Renderer (Presentation)
- **`renderWorkDetail()`** — для статусов `AWAITING_INPUT` / `COMPLETED`: запрашивает историю через `api.workHistory()`, рендерит в `#work-history`
- **`renderHistoryEntry(entry)`** — диспетчер: по `type` вызывает соответствующий рендерер:
  - `user` → **`renderUserMessage()`** (новая)
  - `assistant` → **`renderStreamEvent()`** (существующая, переиспользуем)
  - `result` → **`renderResultSummary()`** (новая)
  - `system` → **`renderStreamEvent()`** (существующая)
- **`renderStreamEvent()`** — без изменений (уже умеет assistant/system)

## Точки интеграции
- **IPC:** Новый канал `work:history` в `registerWorkHandlers()`
- **Preload:** Новый метод `workHistory` в `contextBridge.exposeInMainWorld`
- **UI:** Блок `#work-history` внутри `#awaiting-input` (для AWAITING_INPUT) и отдельно для COMPLETED
- **Изменения в существующем коде:** `renderWorkDetail()` — замена показа `lastResult` на историю

## Зависимости
- **Внутренние:** Все изменения в рамках существующих модулей, новых зависимостей нет
- **Внешние:** `fs`, `path`, `os` — уже используются в `work-manager.ts`

## Риски и ограничения
- **Размер JSONL:** Длинные сессии могут давать JSONL в сотни КБ. На MVP грузим всё в память. Если станет проблемой — добавим виртуальный скролл или пагинацию.
- **Формат user-сообщений:** Точно не знаем структуру `user`-событий в JSONL (зависит от версии Claude Code). Делаем защитную обработку: пробуем `message.content` как массив и как строку.
