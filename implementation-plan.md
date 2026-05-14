# Implementation Plan — Claude Code Session Manager

## Фаза 1: Скелет и фундамент

**Цель:** инициализированный Electron + TypeScript проект, общие типы.

| # | Задача | Зависимость |
|---|--------|------------|
| 1.1 | Инициализация проекта: `npm init`, `electron`, `electron-builder`, TypeScript | — |
| 1.2 | `src/main/index.ts` — создание BrowserWindow, загрузка renderer | 1.1 |
| 1.3 | `src/preload/index.ts` — пустой contextBridge (заглушка) | 1.1 |
| 1.4 | `src/renderer/index.html` + `index.ts` — пустая страница «Hello» | 1.1 |
| 1.5 | `src/shared/types.ts` — все типы: `Project`, `Work`, `Settings`, `StreamEvent` | — |
| 1.6 | `src/shared/ipc-channels.ts` — константы всех каналов | — |

**Проверка:** приложение запускается, показывает окно с заглушкой.

---

## Фаза 2: Бэкенд — базовые модули

**Цель:** хранилище, git-операции, конфигурация Claude Code.

| # | Задача | Зависимость |
|---|--------|------------|
| 2.1 | `src/main/storage/store.ts` — `load()` / `save()` для `session-manager.json` | 1.5 |
| 2.2 | `src/main/git/git-service.ts` — все 8 методов + `GitError`-классы | 1.5 |
| 2.3 | `src/main/claude/claude-config.ts` — `ensure()`, `sync()`, `generateHookScript()` | 1.5 |
| 2.4 | Шаблоны `hooks/classify-bash.sh` и `hooks/approve-edits.sh` в resources | — |

**Проверка:** юнит-тесты (или ручная проверка) каждого модуля в изоляции.

---

## Фаза 3: Бэкенд — бизнес-логика

**Цель:** управление проектами и Work, сборка аргументов Claude Code.

| # | Задача | Зависимость |
|---|--------|------------|
| 3.1 | `src/main/project/project-manager.ts` — CRUD проектов | 2.1, 2.2, 2.3 |
| 3.2 | `src/main/work/work-manager.ts` — CRUD Work + статусная машина | 2.1, 2.2, 3.1 |
| 3.3 | `src/main/run/args-builder.ts` — сборка массива аргументов `claude -p` | 1.5, 2.3 |

**Статусная машина WorkManager (переходы):**
- `createWork()` → статус `AWAITING_INPUT` (первый Run стартует сразу)
- `startRun()` → `IN_PROGRESS` + запись PID
- `completeRun()` → `AWAITING_INPUT` + очистка PID + инкремент runCount
- `completeWork()` → `COMPLETED`
- `deleteWork()` → удаление JSONL + удаление из стора

**Проверка:** создание проекта и Work через программный вызов менеджеров, проверка статусных переходов.

---

## Фаза 4: RunProcess

**Цель:** запуск, мониторинг и остановка `claude -p`.

| # | Задача | Зависимость |
|---|--------|------------|
| 4.1 | `src/main/run/run-process.ts` — `spawn()` | 3.3 |
| 4.2 | Парсинг stream-json: `readline` на stdout, JSON.parse каждой строки | 4.1 |
| 4.3 | Watchdog: таймер бездействия → SIGTERM → 5s → SIGKILL | 4.1 |
| 4.4 | `cancel()`: ручная остановка (SIGTERM → 5s → SIGKILL) | 4.1 |
| 4.5 | Классификация exit-статуса: OK / ERROR / STOPPED / TIMEOUT | 4.1 |
| 4.6 | Запись stderr в `~/.claude/session-manager-logs/<workId>.log` | 4.1 |
| 4.7 | Интеграция с WorkManager: `onStarted`, `onEvent`, `onCompleted` колбэки | 3.2 |

**Проверка:** реальный запуск `claude -p` с простым prompt, отслеживание событий, успешное завершение.

---

## Фаза 5: IPC-слой

**Цель:** связь Main ↔ Renderer через типизированные контракты.

| # | Задача | Зависимость |
|---|--------|------------|
| 5.1 | `src/main/ipc/handlers/project.ts` — обработчики project:* | 3.1 |
| 5.2 | `src/main/ipc/handlers/work.ts` — обработчики work:* | 3.2, 4.7 |
| 5.3 | `src/main/ipc/handlers/settings.ts` — обработчики settings:* | 2.1 |
| 5.4 | `src/main/ipc/register.ts` — регистрация всех `ipcMain.handle` + `webContents.send` для событий | 5.1–5.3 |
| 5.5 | `src/preload/index.ts` — `contextBridge.exposeInMainWorld('electronAPI', {...})` | 1.6, 5.4 |
| 5.6 | `src/renderer/api/ipc-client.ts` — типизированная обёртка `window.electronAPI` | 1.6 |

**Проверка:** вызов команды из консоли renderer → ответ от main → вывод в консоль.

---

## Фаза 6: UI

**Цель:** полностью рабочий интерфейс.

| # | Задача | Зависимость |
|---|--------|------------|
| 6.1 | `ProjectListView` — список проектов, кнопка «Создать» | 5.6 |
| 6.2 | `ProjectCreateView` — форма: имя, путь/URL, профиль | 5.6 |
| 6.3 | `WorkListView` — список Work проекта, фильтр по статусу | 5.6 |
| 6.4 | `WorkDetailView` — просмотр выполняющегося Run (stream-json карточки) | 5.6 |
| 6.5 | `WorkDetailView` — просмотр AWAITING_INPUT (последний result + поле ответа) | 5.6 |
| 6.6 | `SettingsView` — форма глобальных настроек | 5.6 |
| 6.7 | `WorkStatusBadge` — цветовая индикация статуса | — |
| 6.8 | `StreamEventCard` — отрисовка одного события stream-json | — |
| 6.9 | Обработка событий: `run:event`, `run:started`, `run:completed`, `work:updated` | 5.6 |
| 6.10 | Подписка на `beforeunload` → подтверждение выхода, если есть активные Run'ы | 5.6 |

**Проверка:** полный пользовательский сценарий: создать проект → создать Work → наблюдать выполнение → ответить → завершить.

---

## Фаза 7: Полировка и крайние случаи

**Цель:** обработка ошибок и нештатных ситуаций.

| # | Задача | Зависимость |
|---|--------|------------|
| 7.1 | Shutdown: `app.on('before-quit')` → остановка всех активных Run | 4.4 |
| 7.2 | Восстановление после перезапуска: Work с `currentRunPid != null` → AWAITING_INPUT + пометка | 3.2 |
| 7.3 | Dirty-репозиторий: диалог Discard / Отмена перед созданием Work | 6.1 |
| 7.4 | Конфликт имени ветки: ошибка с предложением другого имени | 6.1 |
| 7.5 | Обработка `GitNotFoundError` — git не установлен | 2.2 |
| 7.6 | Логирование действий приложения (не Claude Code) — `~/.claude/session-manager-logs/app.log` | — |

---
## Фаза 8: Доработки по результатам тестирования

**Цель:** фичи, выявленные при живом тестировании.

| # | Задача | Зависимость |
|---|--------|------------|
| 8.1 | Удаление проекта: кнопка × в боковой панели, диалог подтверждения | 6.1 |
| 8.2 | Отображение working directory проекта в заголовке (правой панели) | 6.1 |
| 8.3 | Обёртка `claude-deepseek-v4` → `~/.local/bin/claude-sm` | 4.1 |
| 8.4 | Добавление `.claude/` в `.gitignore` при создании проекта + фильтр в `isDirty()` | 2.3, 2.2 |
| 8.5 | Исправление порядка инициализации: bind до загрузки данных | 6.1 |
| 8.6 | Standalone `.hidden` CSS-правило + `#stream-events` placeholder | 6.4 |
| 8.7 | Восстановление строки `const api = window.electronAPI` | 6.1 |

---

## Порядок выполнения

```
Фаза 1 ──▶ Фаза 2 ──▶ Фаза 3 ──▶ Фаза 4 ──▶ Фаза 5 ──▶ Фаза 6 ──▶ Фаза 7 ──▶ Фаза 8
                                            │
                                            └── (Фазу 6 можно начать
                                                 после Фазы 3, UI без
                                                 реальных Run'ов)
```

**Самый рискованный этап:** Фаза 4 (RunProcess) — spawn + stream-json. Рекомендуется провести проверку в начале фазы 4: запустить `claude -p "скажи привет" --output-format stream-json` вручную и убедиться, что формат соответствует ожидаемому.

**Оценка трудозатрат:** 2–3 недели на все фазы при работе одного разработчика.
