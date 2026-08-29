# claus: Анализ функциональностей

> Проект **Session Manager** — desktop-приложение для управления сессиями Claude Code.

## 5. Функциональные возможности

### 5.1 Основные фичи

| Фича | Описание | Статус | Приоритет |
|------|----------|--------|-----------|
| Управление проектами | Создание (имя, путь, профиль, опциональный `git init`), список, выбор, удаление с подтверждением | ✅ реализовано | Высокий |
| Генерация Claude-конфига | `.claude/settings.json`, `.claude/settings.local.json` (+backup/restore), хук `classify-bash.sh`, `.gitignore` | ✅ реализовано | Высокий |
| Профили разрешений | `generic`, `android`, `frontend`, `python` — whitelist Bash-команд по профилю | ✅ реализовано | Высокий |
| Перечисление MCP-серверов | Чтение `~/.claude.json` → `mcpServers` + fallback-список → allow-правила | ✅ реализовано | Средний |
| Git-операции | Проверка dirty, discard изменений, проверка существования ветки, `git init` | ✅ частично (создание/переключение веток не подключено) | Средний |
| Управление Work (задачи) | Создание, список, просмотр, переименование, удаление, завершение | ✅ реализовано | Высокий |
| Создание Work из директории | find-or-create проекта по пути директории (контекст Active Works) | ✅ реализовано | Средний |
| Headless-запуск Claude Code | `claude -p` + `--output-format stream-json`, поток событий в реальном времени | ✅ реализовано | Высокий |
| Выбор команды запуска | Settings → Claude command: `claude` / `claude-sm` (враппер) / произвольный путь; `PATH` дочернего процесса расширяется типовыми каталогами CLI | ✅ реализовано | Средний |
| Resume сессии | Повторные запуски используют `--resume <sessionId>` при `runCount > 0` | ✅ реализовано | Высокий |
| События run | `run:started`, `run:event`, `run:completed`, `work:updated` в renderer | ✅ реализовано | Высокий |
| Watchdog-таймаут | Принудительная остановка «зависшего» run после N минут тишины | ✅ реализовано | Средний |
| Ручная остановка | Stop Run: SIGTERM → SIGKILL через 5 c | ✅ реализовано | Высокий |
| Восстановление зависших Work | При старте `IN_PROGRESS`/непустой pid → `AWAITING_INPUT` с пометкой | ✅ реализовано | Средний |
| Корректное завершение | При выходе — отмена всех run, пометка Work, restore локальных настроек | ✅ реализовано | Высокий |
| Настройки | Watchdog, Max Turns, профиль по умолчанию, фрагмент кастомного промпта, UI mode | ✅ реализовано | Средний |
| Переключатель UI (classic/new) | Персистентный `uiMode`; «new» — заглушка | ✅ частично | Низкий |
| Боковая панель Active Works | Все не-COMPLETED Work по всем проектам, клик для просмотра | ✅ реализовано | Средний |
| История диалога | Полный JSONL → пользовательские реплики + финальные ответы (tool_use, result, system; thinking скрыт) | ✅ реализовано | Средний |
| Slash-автодополнение | Автодополнение `/`-команд и скиллов в описании Work и поле ответа | ✅ реализовано | Средний |
| Сканирование скиллов | Global (`~/.claude/skills`) + project (`.claude/skills`), built-in команды (13 шт.) | ✅ реализовано | Средний |
| Диалоги ошибок | Git не найден, dirty repo (с Discard), ветка существует | ✅ реализовано | Средний |
| Файловое логирование | Лог приложения + лог каждого run | ✅ реализовано | Низкий |

### 5.2 CLI-команды / API endpoints

Приложение не имеет CLI-команд; его «API» — это IPC-каналы между renderer и main (полный перечень):

**IPC-каналы (Renderer → Main), `src/shared/ipc-channels.ts`:**

| Канал | Вход | Поведение | Выход |
|-------|------|-----------|-------|
| `project:list` | — | `listProjects()` | `Project[]` |
| `project:get` | `{ id }` | `getProject(id)` | `Project` |
| `project:create` | `{ name, path, profile?, initRepo? }` | `createProject()` + `syncClaudeConfig()` | `Project` |
| `project:delete` | `{ id }` | `deleteProject(id)` | `void` |
| `project:check-dirty` | `{ id }` | `isDirty(path)` | `{ isDirty, files }` |
| `project:discard` | `{ id }` | `discardChanges(path)` | `void` |
| `project:check-branch` | `{ id, branchName }` | `branchExists(path, name)` | `{ exists }` |
| `work:list` | `{ projectId? }` | `listWorks(projectId)` | `Work[]` |
| `work:get` | `{ id }` | `getWork(id)` + `getLastResult(id)` | `{ work, lastResult }` |
| `work:create` | `{ projectId?, name?, description, directory? }` | `createWork()` + `spawnRun()` | `Work` |
| `work:delete` | `{ id }` | `cancelRun(id)` + `deleteWork(id)` | `void` |
| `work:complete` | `{ id }` | `completeWork(id)` | `void` |
| `work:respond` | `{ id, message }` | `markRunStarted(id, 0)` + `spawnRun(id, message)` | `void` |
| `work:cancel` | `{ id }` | `cancelRun(id)` + `markRunCompleted(…, 'остановлено пользователем')` | `void` |
| `work:restart-run` | `{ id }` | `spawnRun(id, work.description)` | `void` |
| `work:rename` | `{ id, name }` | `renameWork(id, name)` | `void` |
| `work:history` | `{ id }` | `getFullHistory(id)` | `{ messages: HistoryEntry[] }` |
| `settings:get` | — | `load().settings` | `Settings` |
| `settings:update` | `Partial<Settings>` | merge + save; при смене `defaultProfile` — re-sync всех проектов | `Settings` |
| `skills:list` | `{ projectPath? }` | `scanSkills(projectPath)` | `{ skills, builtIn }` |

**События (Main → Renderer):** `run:event`, `run:started`, `run:completed`, `work:updated`.

**Аргументы, собираемые для запуска `claude` (`args-builder.ts`):**

| Аргумент | Когда | Описание |
|----------|-------|----------|
| `--resume <sessionId>` | повторный run | Возобновление сессии |
| `--session-id <sessionId>` | первый run | Явный id сессии |
| `-p <prompt>` | всегда | Промпт (с префиксом `customPromptFragment`) |
| `--output-format stream-json` | всегда | Потоковый JSON-вывод |
| `--verbose` | всегда | Требуется для stream-json |
| `--max-turns <N>` | если `defaultMaxTurns > 0` | Лимит ходов |

### 5.3 Конфигурация

**Параметры настроек приложения (`Settings` в `types.ts`, дефолты из `store.ts`):**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `watchdogTimeoutMinutes` | number | `10` | Таймаут тишины stdout перед принудительной остановкой |
| `defaultMaxTurns` | number | `25` | Лимит ходов (`--max-turns`), 0 = без лимита |
| `defaultProfile` | string | `'generic'` | Профиль разрешений по умолчанию |
| `customPromptFragment` | string | `''` | Фрагмент, добавляемый к каждому промпту |
| `uiMode` | `'classic' \| 'new'` | `'classic'` | Режим интерфейса |

**Пути к конфигурации и данным:**

| Путь | Формат | Назначение |
|------|--------|-----------|
| `~/.claude/session-manager.json` | JSON (`AppData`, version 1) | Состояние приложения (projects, works, settings); атомарная запись `.tmp`+rename |
| `<project>/.claude/settings.json` | JSON | Права Claude Code (allow: MCP + Read/Glob/Grep/Edit/Write; deny: `.env`, `rm -rf`, `git push --force`) |
| `<project>/.claude/settings.local.json` (+ `.backup`) | JSON | Локальные права (добавляет `Bash`), backup/restore по refcount |
| `<project>/.claude/hooks/classify-bash.sh` | Bash | PreToolUse-хук — классификатор Bash-команд (whitelist/deny) |
| `~/.claude/session-manager-logs/app.log` | text | Лог приложения |
| `~/.claude/session-manager-logs/<workId>.log` | text | Лог конкретного run |
| `~/.claude/projects/<slug>/<workId>.jsonl` | JSONL | Сессия Claude Code (только чтение) |
| `~/.claude.json` | JSON | Источник имён MCP-серверов (`mcpServers`) |
| `~/.claude/skills/<skill>/SKILL.md` | Markdown | Глобальные скиллы |
| `<project>/.claude/skills/<skill>/SKILL.md` | Markdown | Проектные скиллы (переопределяют глобальные) |

**Профили разрешений (`PROFILE_WHITELIST` в `claude-config.ts`):**

| Профиль | Разрешённые Bash-команды |
|---------|--------------------------|
| `android` | `gradlew`*, `./gradlew`*, `adb`* |
| `frontend` | `npm`*, `npx`*, `yarn`*, `pnpm`* |
| `python` | `pip`*, `pytest`*, `poetry`*, `python`*, `python3`* |
| `generic` | (пусто) |
