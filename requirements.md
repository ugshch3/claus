# Claude Code Session Manager — Requirements

## Overview

Desktop-приложение для управления сессиями Claude Code в разных проектах. Позволяет создавать, отслеживать и продолжать работы (Work) по задачам разработки, запуская Claude Code как headless-подпроцесс.

## Терминология

| Термин | Значение | Аналог в Claude Code |
|--------|----------|---------------------|
| **Проект** | Git-репозиторий, в котором ведётся работа | `{sanitized-cwd}` в `~/.claude/projects/` |
| **Work** | Логическая сущность, объединяющая всю работу над одной фичей/задачей. Имеет описание, статус, историю | Сессия (`session_id`) |
| **Run** | Один запуск `claude -p`. Work состоит из цепочки Run'ов | Одно выполнение `claude -p` или `claude --resume -p` |

## Статусная модель Work

```
IN_PROGRESS     — claude -p запущен, идёт чтение stream-json
AWAITING_INPUT  — процесс завершился, ожидает ответа пользователя
COMPLETED       — пользователь отметил Work как завершённый
```

Переходы:
- `IN_PROGRESS → AWAITING_INPUT`: процесс claude завершился
- `AWAITING_INPUT → IN_PROGRESS`: пользователь отправил ответ → spawn `claude --resume -p`
- `AWAITING_INPUT → COMPLETED`: пользователь пометил Work как выполненный
- Любой статус → удалён (пользователь удаляет Work)

## Функциональные требования

### F1. Управление проектами

- F1.1. Выбор проекта из списка существующих
- F1.2. Создание нового проекта из URL удалённого репозитория (git clone)
- F1.3. Создание нового проекта как пустого репозитория (git init)
- F1.4. В MVP: одна активная задача (Work) на проект
- F1.5. В будущем: несколько параллельных Work в одном проекте

### F2. Управление Work

- F2.1. Создание Work: выбор проекта + текстовое описание задачи
- F2.2. При создании Work генерируется UUID (session_id)
- F2.3. Первый Run: `claude -p "<описание>" --output-format stream-json --session-id <uuid>` в директории проекта
- F2.4. Отображение прогресса в реальном времени (чтение stream-json)
- F2.5. По завершении процесса — переход в AWAITING_INPUT
- F2.6. Ответ пользователя: `claude --resume <session_id> -p "<ответ>" --output-format stream-json`
- F2.7. Пометка Work как COMPLETED вручную
- F2.8. Удаление Work

### F3. Просмотр сессий

- F3.1. Список активных Work с отображением статуса
- F3.2. Для Work в статусе AWAITING_INPUT — просмотр последнего сообщения/результата
- F3.3. Просмотр полной истории диалога Work (чтение JSONL с диска)
- F3.4. Возможность ответить на AWAITING_INPUT Work

### F4. Интеграция с Claude Code

- F4.1. Запуск Claude Code в headless-режиме (`-p`) как subprocess
- F4.2. Использование `--output-format stream-json` для потокового получения событий
- F4.3. Продолжение сессий через `--resume <session_id>`
- F4.4. Чтение истории сессий из `~/.claude/projects/<slug>/<uuid>.jsonl`
- F4.5. Работа без TTY, через stdin/stdout pipe

## За пределами MVP (post-MVP)

- P1. Android-приложение для удалённого управления сессиями
- P2. Интеграция с Jira: создание Work по ссылке на задачу
- P3. Push-уведомления при переходе в AWAITING_INPUT
- P4. Несколько параллельных Work в одном проекте (каждый на своей ветке)
- P5. Автоматическое создание MR (Merge Request) по завершении Work
- P6. Настраиваемая базовая ветка на проект (develop, main, master)
- P7. Autogenerate имени ветки из описания задачи через Claude

## Результаты технического исследования

Исследование выполнимости проведено, детали в [research-questions.md](research-questions.md).

Ключевые выводы:
- Claude Code в режиме `-p` не требует TTY, работает через pipe
- `--resume` позволяет продолжить сессию новым запуском с полным контекстом
- Сессии хранятся в `~/.claude/projects/<slug>/<uuid>.jsonl` в формате JSONL
- `stream-json` даёт построчный JSONL с событиями в реальном времени
- Никакого pty/эмуляции терминала не требуется

## Обработка ошибок и завершения Run (Блок A)

### Каналы наблюдения за подпроцессом

Desktop-приложение отслеживает три канала:

| Канал | Что даёт |
|-------|---------|
| `exit` event | Код возврата (0 = успех, ≠ 0 = ошибка) |
| `stdout` stream | Поток stream-json — последнее событие перед выходом объясняет причину |
| Watchdog-таймер | Если stdout молчит дольше N секунд — вероятно, зависание |

### Сценарии завершения

| Сценарий | exit code | stream-json | Нужен таймаут? |
|----------|-----------|-------------|-----------------|
| Нормальное завершение | 0 | `type: "result"` | Нет |
| Превышение бюджета | ≠ 0 (предп.) | `type: "error"` (предп.) | Нет |
| Превышение лимита ходов | ≠ 0 (предп.) | `type: "system"` (предп.) | Нет |
| Крах процесса | ≠ 0 | Обрыв потока без result | Нет |
| Зависание | Не приходит | Молчит | **Да** |

Точный формат событий для бюджета и лимита ходов требует экспериментальной проверки (research questions 7-9).

### Матрица реакций

| Сценарий | Статус Work | Действие пользователя |
|----------|------------|----------------------|
| Норма (задача сделана) | AWAITING_INPUT | Ответить или COMPLETED |
| Бюджет превышен | AWAITING_INPUT + пометка «бюджет» | Увеличить бюджет → перезапустить Run |
| Лимит ходов | AWAITING_INPUT + пометка «лимит» | Ответить (новый Run с `--resume`) |
| Крах | AWAITING_INPUT + пометка «ошибка» | Перезапустить Run или удалить Work |
| Зависание | AWAITING_INPUT + пометка «завис» | Принудительно убить процесс → перезапустить |

### Требования

- F5.1. Приложение отслеживает exit code подпроцесса и классифицирует сценарий завершения
- F5.2. Приложение логирует последние N строк stream-json перед завершением (для диагностики)
- F5.3. Watchdog-таймер: если stdout молчит > N минут — процесс считается зависшим, пользователю показывается предупреждение
- F5.4. Пользователь может принудительно завершить Run (SIGTERM → SIGKILL)
- F5.5. Во всех нештатных сценариях Work переходит в AWAITING_INPUT с соответствующей пометкой о причине
- F5.6. Пользователь может перезапустить последний Run (повторный spawn с теми же параметрами)

## Управление разрешениями (Блок B)

### Модель разрешений

Приложение управляет двумя слоями разрешений Claude Code:

**Слой 1 — `permissions` в settings.json** (грубый allow/deny):
```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "Bash(gradlew *)", "Bash(npm run *)"],
    "deny": ["Bash(rm -rf *)", "Bash(git push --force *)", "Read(.env*)"]
  }
}
```

**Слой 2 — PreToolUse hook** (тонкая классификация):
- Хук-скрипт классифицирует команду Bash по белому списку
- Возвращает allow/deny/ask для каждого вызова

### Целевая политика для MVP

| Инструмент / Команда | Поведение |
|----------------------|-----------|
| Read, Glob, Grep | Авто-разрешено всегда |
| Edit, Write | Авто-разрешено |
| Bash(gradlew *) | Авто-разрешено |
| Bash(npm run *) | Авто-разрешено |
| Bash(npx *) | Авто-разрешено |
| Bash(git status/diff/log *) | Авто-разрешено |
| Bash(git commit *) | Авто-разрешено |
| Bash(git push *) | Спрашивать |
| Bash(rm *) | Запрещено |
| Bash(curl *) | Спрашивать |
| Весь остальной Bash | Спрашивать |

### Профили разрешений по типам проектов

Приложение предоставляет преднастроенные профили, которые можно кастомизировать:

- **Android:** `Bash(gradlew *)`, `Bash(adb *)`
- **Frontend (Node.js):** `Bash(npm *)`, `Bash(npx *)`, `Bash(yarn *)`
- **Python:** `Bash(pip *)`, `Bash(pytest *)`, `Bash(poetry *)`, `Bash(python *)`
- **Generic:** Только Read/Glob/Grep авто, всё остальное спрашивать

### Иерархия настроек

- Глобальная настройка: `~/.claude/settings.json` (для всех проектов)
- Проектная настройка: `.claude/settings.json` в репозитории (переопределяет глобальную)
- Приложение управляет обоими файлами через UI

### Требования

- F6.1. Приложение позволяет выбрать профиль разрешений при создании проекта
- F6.2. Приложение управляет `settings.json` (глобальным и проектным)
- F6.3. Приложение генерирует и размещает хук-скрипт классификации Bash
- F6.4. Пользователь может редактировать белые/чёрные списки Bash-команд через UI
- F6.5. Пользователь может импортировать/экспортировать профиль разрешений
- F6.6. Приложение предупреждает о конфликтах: allow переопределяет ask (ловушка Claude Code)

### Что не делаем в MVP

- Не используем режим `auto` (AI-классификатор) — поведение недостаточно изучено
- Не пишем кастомные агенты-классификаторы — используем статический белый список + command-хук

## Git-интеграция и ветки (Блок C)

### Создание ветки при старте Work

- При создании Work пользователь вводит имя ветки
- Приложение создаёт ветку от `main` (в MVP — хардкод; post-MVP — настраиваемая базовая ветка на проект)
- Autogenerate имени ветки из описания — post-MVP
- Имя ветки сохраняется в метаданных Work

### Проверка при старте Work

**Грязный репозиторий.** Перед созданием Work приложение проверяет наличие незакоммиченных изменений. Если есть — блокирует создание. Варианты:

| Действие | Что делает |
|----------|-----------|
| Discard | `git checkout -- . && git clean -fd` (с подтверждением) |
| Отмена | Work не создаётся |

**Конфликт имени ветки.** Проверка только локальных веток. Если ветка с таким именем уже существует — ошибка с предложением другого имени.

### Проверка перед каждым Run

Перед каждым запуском `claude -p` приложение:
- Проверяет, что репозиторий переключён на ветку Work'а
- Если нет — переключает (`git checkout <branch>`)

### После завершения Work

- Ветка остаётся как есть
- Пользователь сам создаёт MR/PR через привычный инструмент
- Автоматическое создание MR — post-MVP (P6)

### Требования

- F7.1. При создании Work приложение запрашивает имя git-ветки
- F7.2. Приложение создаёт ветку от основной (`main`/`master`, в MVP — первый найденный из списка)
- F7.3. Приложение проверяет репозиторий на незакоммиченные изменения и блокирует создание Work
- F7.4. При блокировке пользователь может Discard или отменить создание
- F7.5. Приложение проверяет уникальность имени ветки среди локальных веток
- F7.6. Приложение сохраняет имя ветки в метаданных Work
- F7.7. Перед каждым Run приложение проверяет и переключает рабочую директорию на ветку Work'а

## Данные приложения (Блок D)

### Хранилище: JSON-файл

В MVP состояние приложения хранится в `~/.claude/session-manager.json`. Один файл, полная загрузка в память при старте, запись при изменениях.

```json
{
  "version": 1,
  "projects": [
    {
      "id": "uuid",
      "name": "My App",
      "path": "/Users/me/my-app",
      "slug": "-Users-me-my-app",
      "profile": "android",
      "createdAt": "2026-05-09T..."
    }
  ],
  "works": [
    {
      "id": "session-uuid",
      "projectId": "project-uuid",
      "description": "Добавить авторизацию",
      "branch": "feature/auth",
      "status": "AWAITING_INPUT",
      "currentRunPid": null,
      "createdAt": "...",
      "completedAt": null
    }
  ],
  "settings": {
    "watchdogTimeoutMinutes": 10,
    "defaultMaxTurns": 25,
    "defaultMaxBudgetUsd": null,
    "defaultProfile": "generic"
  }
}
```

### Авто-обнаружение проектов

- Post-MVP. В MVP проекты добавляются только вручную (F1.1–F1.3).
- В будущем: сканирование `~/.claude/projects/`, восстановление путей из slug, предложение добавить найденные проекты.

### Требования

- F8.1. Приложение хранит список проектов, Work и настройки в `~/.claude/session-manager.json`
- F8.2. Приложение загружает состояние при старте и пишет при каждом изменении
- F8.3. При создании Work приложение генерирует UUID (session_id) и сохраняет все метаданные
- F8.4. При запуске Run приложение записывает PID текущего процесса
- F8.5. При завершении Run приложение обновляет статус Work и очищает PID
- F8.6. При удалении Work приложение удаляет соответствующий JSONL-файл сессии (`~/.claude/projects/<slug>/<uuid>.jsonl`)

## Бюджет и ограничения (Блок E)

### Ограничения на Run

| Параметр | Значение в MVP |
|----------|---------------|
| `--max-turns` | Глобальная настройка (по умолчанию 25) |
| `--max-budget-usd` | Не используется в MVP |
| Лимит по времени | Не используется в MVP |
| Одновременные Run'ы | Не ограничены глобально, но **не более 1 Run на проект** одновременно |

### Принудительная остановка

- Пользователь может вручную остановить Run в любой момент
- При остановке: SIGTERM → ждать 5 сек → SIGKILL
- Work переходит в AWAITING_INPUT с пометкой «остановлено пользователем»

### Требования

- F9.1. `--max-turns` задаётся глобально в настройках приложения, используется при каждом spawn
- F9.2. Приложение не запускает новый Run в проекте, если в этом проекте уже есть активный Run
- F9.3. Приложение не ограничивает количество параллельных Run'ов в разных проектах
- F9.4. Пользователь может вручную остановить выполняющийся Run (SIGTERM → таймаут 5с → SIGKILL)
- F9.5. После ручной остановки Work переходит в AWAITING_INPUT с пометкой «остановлено»

## UX отображения (Блок F)

### Прогресс выполняющегося Run

`stream-json` события отображаются структурированно:

| Тип события | Отображение |
|------------|-------------|
| `assistant` / thinking | Сворачиваемый блок «Думает...» |
| `tool_use` (Read, Grep, Glob) | Иконка + имя файла |
| `tool_use` (Edit, Write) | Иконка + имя файла + дифф |
| `tool_use` (Bash) | Иконка + команда |
| `tool_result` | Сворачиваемый блок с выводом |
| `result` | Основной блок с итоговым ответом |

### История Work

- В MVP при просмотре AWAITING_INPUT показывается **последнее сообщение** (итоговый `result` последнего Run)
- Полный диалог доступен через чтение JSONL с диска (задел на post-MVP)

### Список Work'ов

Каждая строка показывает:
- Описание задачи
- Статус (с цветовой индикацией)
- Проект (имя)
- Время последней активности
- Количество Run'ов

### Требования

- F10.1. Приложение парсит stream-json и отображает события в структурированном виде
- F10.2. Thinking-блоки по умолчанию свёрнуты, tool_result свёрнуты
- F10.3. Для Work в статусе AWAITING_INPUT показывается последний result
- F10.4. Список Work'ов отображает: описание, статус, проект, время последней активности, количество Run'ов
- F10.5. Статус AWAITING_INPUT подсвечивается визуально (требует внимания)

## Открытые вопросы

- Детальный UI/UX

## Архитектурные решения

### Технология: Electron

- Main Process: Node.js — spawn, fs, git, управление состоянием
- Renderer Process: Web-интерфейс (HTML/CSS/JS)
- IPC: `contextBridge` + `ipcRenderer.invoke` (команды) / `webContents.send` (события)
- `contextIsolation: true`, `nodeIntegration: false`

### Изоляция данных приложения и Claude Code

- Данные приложения (`session-manager.json`) хранятся отдельно от данных Claude Code (`~/.claude/projects/`)
- Приложение не отслеживает внешние изменения в `~/.claude/projects/` — оно единственный источник правды о своих Work
- Сессии, созданные вне приложения (через терминал), не отображаются. Разрешение конфликтов — на пользователе.

### IPC-контракты

**Команды** (Renderer → Main, `ipcRenderer.invoke` / `ipcMain.handle`):

| Канал | Параметры | Возврат |
|-------|-----------|---------|
| `project:list` | — | `Project[]` |
| `project:get` | `{id}` | `Project` |
| `project:create` | `{name, path?, remoteUrl?}` | `Project` |
| `project:delete` | `{id}` | `void` |
| `project:check-dirty` | `{id}` | `{isDirty, files}` |
| `project:discard` | `{id}` | `void` |
| `project:check-branch` | `{id, branchName}` | `{exists}` |
| `work:list` | `{projectId?}` | `Work[]` |
| `work:get` | `{id}` | `{work, lastResult?}` |
| `work:create` | `{projectId, description, branchName}` | `Work` |
| `work:delete` | `{id}` | `void` |
| `work:complete` | `{id}` | `void` |
| `work:respond` | `{id, message}` | `void` (стартует Run) |
| `work:cancel` | `{id}` | `void` (останавливает Run) |
| `work:restart-run` | `{id}` | `void` |
| `settings:get` | — | `Settings` |
| `settings:update` | `Partial<Settings>` | `Settings` |

**События** (Main → Renderer, `webContents.send`):

| Канал | Payload | Когда |
|-------|---------|-------|
| `run:event` | `{workId, event}` | Каждая строка stream-json |
| `run:started` | `{workId}` | Run начался |
| `run:completed` | `{workId, exitCode, reason}` | Run завершился |
| `work:updated` | `{work}` | Изменился Work |

### Модель процессов (RunProcess)

**Жизненный цикл Run:**

```
IDLE → SPAWNING → RUNNING ─┬─→ exit(0) → OK ──────┐
                            ├─→ exit(N) → ERROR ───┤
                            └─→ watchdog/cancel ───┘
                                          │
                                    CLEANING → AWAITING_INPUT
```

**Управление процессом:**

- `child_process.spawn('claude', [...args])` с `stdio: ['pipe', 'pipe', 'pipe']`
- stdout: `readline` построчно, парсинг JSONL, каждое событие → IPC `run:event`
- stderr: пишется в `~/.claude/session-manager-logs/<workId>.log`
- watchdog-таймер: если stdout молчит > N минут → SIGTERM → ждать 5 сек → SIGKILL

**Concurrency:**
- Глобально: количество Run'ов не ограничено
- На проект: не более 1 активного Run одновременно
- WorkManager.spawnRun() проверяет отсутствие активных Run'ов в проекте перед spawn

**Shutdown приложения:**
- Закрытие окна = выход из приложения
- Все активные Run'ы: SIGTERM → 5 сек → SIGKILL
- Сохранение `session-manager.json` перед выходом
- При следующем старте: Work с `currentRunPid != null` → AWAITING_INPUT + пометка «приложение было закрыто»

**Буферизация stream-json:**
- Не буферизируем: каждое stream-json событие шлётся в UI как отдельный IPC `run:event`

### Структура проекта

```
session-manager/
├── package.json
├── electron-builder.yml
├── tsconfig.json
│
├── src/
│   ├── main/                     # Main Process (Node.js)
│   │   ├── index.ts              # Точка входа: окно, регистрация IPC
│   │   ├── storage/
│   │   │   └── store.ts          # session-manager.json
│   │   ├── project/
│   │   │   └── project-manager.ts
│   │   ├── work/
│   │   │   └── work-manager.ts   # CRUD Work, статусная машина
│   │   ├── run/
│   │   │   ├── run-process.ts    # spawn, stream, watchdog
│   │   │   └── args-builder.ts   # Аргументы claude -p
│   │   ├── claude/
│   │   │   └── claude-config.ts  # settings.json + hooks
│   │   ├── git/
│   │   │   └── git-service.ts
│   │   └── ipc/
│   │       ├── register.ts       # ipcMain.handle регистрация
│   │       └── handlers/
│   │           ├── project.ts
│   │           ├── work.ts
│   │           └── settings.ts
│   │
│   ├── preload/
│   │   └── index.ts              # contextBridge API
│   │
│   ├── renderer/                 # Web UI
│   │   ├── index.html
│   │   ├── index.ts
│   │   ├── App.ts                # Корень + роутинг
│   │   ├── api/
│   │   │   └── ipc-client.ts     # Типизированный ipcRenderer.invoke
│   │   ├── views/
│   │   │   ├── ProjectListView.ts
│   │   │   ├── ProjectCreateView.ts
│   │   │   ├── WorkListView.ts
│   │   │   ├── WorkDetailView.ts # Прогресс + история
│   │   │   └── SettingsView.ts
│   │   ├── components/
│   │   │   ├── WorkStatusBadge.ts
│   │   │   ├── StreamEventCard.ts
│   │   │   └── ...
│   │   └── styles/
│   │       └── main.css
│   │
│   └── shared/
│       ├── types.ts              # Project, Work, Settings, StreamEvent
│       └── ipc-channels.ts       # Константы имён каналов
│
├── resources/
│   └── icon.png
│
└── hooks/                        # Шаблоны (копируются ClaudeConfig)
    ├── classify-bash.sh
    └── approve-edits.sh
```

**Соглашения:**
- `shared/` — типы и константы, импортируются и main, и preload
- `ipc/handlers/` — тонкие, делегируют в модули (project-manager, work-manager)
- `renderer/api/ipc-client.ts` — единственное место вызова `window.electronAPI.*`
- UI-фреймворк не фиксируется на уровне архитектуры (выбирается на этапе реализации)

### GitService

Модуль `src/main/git/git-service.ts` — все git-операции через `execSync` с таймаутом.

**Методы:**

| Метод | Команда | Возврат |
|-------|---------|---------|
| `isDirty(path)` | `git status --porcelain` | `{isDirty, files[]}` |
| `discardChanges(path)` | `git checkout -- . && git clean -fd` | `void` |
| `branchExists(path, name)` | `git branch --list <name>` | `boolean` |
| `createBranch(path, name, base)` | `git checkout -b <name> <base>` | `void` |
| `checkout(path, name)` | `git checkout <name>` | `void` |
| `getCurrentBranch(path)` | `git branch --show-current` | `string` |
| `getDefaultBranch(path)` | `git branch -a` + поиск main/master | `string` |
| `getRemotes(path)` | `git remote -v` | `string[]` |

**Обработка ошибок — типизированные исключения:**

```
GitError
├── DirtyRepoError    (при создании Work)
├── BranchExistsError (конфликт имени)
├── CheckoutError     (не удалось переключить)
└── GitNotFoundError  (git не установлен)
```

Каждое исключение содержит `message` для показа пользователю и `code` для программной обработки.

**Базовый класс:**

```typescript
class GitError extends Error {
  code: string;        // 'DIRTY_REPO' | 'BRANCH_EXISTS' | ...
  userMessage: string; // Локализованное сообщение для UI
}
```

**Особые случаи:**

- `getDefaultBranch()` — ищет `main`, затем `master` в списке локальных веток. Если нет ни того, ни другого — ошибка. В post-MVP замена на настройку проекта.
- `discardChanges()` — выполняется только после явного подтверждения пользователя. Перед выполнением делается `git stash` в фон (на случай, если пользователь передумает — post-MVP).
- Все команды выполняются с `cwd: projectPath` и таймаутом 30 секунд.

### ClaudeConfig

Модуль `src/main/claude/claude-config.ts` — генерация разрешений Claude Code для проекта.

**Два слоя, которые создаёт приложение:**

```
.claude/
├── settings.json          # allow/deny базовые
└── hooks/
    └── classify-bash.sh   # Классификатор Bash-команд
```

**Слой 1: `settings.json`**

Отвечает за не-Bash инструменты. Генерируется при создании проекта, не зависит от профиля:

```json
{
  "permissions": {
    "allow": ["Read", "Glob", "Grep", "Edit", "Write"],
    "deny": ["Read(.env*)", "Bash(rm -rf *)", "Bash(git push --force *)"]
  },
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": ".claude/hooks/classify-bash.sh"
      }]
    }]
  }
}
```

**Слой 2: `classify-bash.sh`**

Единственная точка классификации Bash. Получает команду через stdin, возвращает JSON с `permissionDecision`:

```bash
#!/bin/bash
# Читает команду из stdin → классифицирует → allow/deny/ask
COMMAND=$(cat)

# Whitelist (общий + из профиля)
case "$COMMAND" in
  # Общий безопасный whitelist
  "git status"*|"git diff"*|"git log"*|"git commit"*|"git add"*)
    DECISION="allow" ;;
  # Профиль-специфичный whitelist (подставляется при генерации)
  {{PROFILE_WHITELIST}}
  # Blacklist
  "rm -rf"*|"git push --force"*|"curl"*"| bash"*)
    DECISION="deny" ;;
  *)
    DECISION="ask" ;;
esac

jq -n --arg d "$DECISION" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: $d
  }
}'
```

**Профили и их whitelist:**

| Профиль | Дополнительные Bash-команды |
|---------|---------------------------|
| `android` | `Bash(gradlew *)`, `Bash(adb *)` |
| `frontend` | `Bash(npm *)`, `Bash(npx *)`, `Bash(yarn *)` |
| `python` | `Bash(pip *)`, `Bash(pytest *)`, `Bash(poetry *)`, `Bash(python *)` |
| `generic` | Нет дополнительных |

**Методы ClaudeConfig:**

| Метод | Действие |
|-------|---------|
| `ensure(projectPath, profile)` | Создаёт `.claude/settings.json` и `hooks/classify-bash.sh`, если их нет. Не перезаписывает, если уже существуют (пользователь мог вручную поправить) |
| `sync(projectPath, profile)` | Принудительно обновляет файлы из шаблонов (по запросу пользователя) |
| `generateHookScript(profile)` | Генерирует `classify-bash.sh` с whitelist'ом профиля |

**Особые случаи:**
- Если `.claude/settings.json` уже существует → `ensure()` не трогает его (уважаем ручные правки)
- Если hook-скрипт уже существует → аналогично
- При смене профиля в настройках проекта → `sync()` перезаписывает hook-скрипт с новым whitelist'ом
