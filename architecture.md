# Session Manager — Architecture Reference

## 1. Обзор слоёв

```
┌─────────────────────────────────────────────────────────────────┐
│                     Renderer Process                             │
│  index.html  ←→  app.js  ←→  api/ipc-client.ts                  │
│            slash-autocomplete.js  (autocomplete /-команд)        │
│                        │ IPC (invoke + events)                    │
├────────────────────────┼────────────────────────────────────────┤
│                     Preload                                      │
│              contextBridge.exposeInMainWorld                     │
│                        │                                         │
├────────────────────────┼────────────────────────────────────────┤
│                    Main Process                                  │
│                        │                                         │
│  ┌─────────────────────┼──────────────────────┐                 │
│  │  ipc/register.ts  ←─┼─  Orchestration       │                 │
│  │  ipc/handlers/     ←┼─  (project/work/settings/skills)│      │
│  └─────────┬───────────┼──────────────────────┘                 │
│            │                                                      │
│  ┌─────────┼──────────┬──────────────┬──────────┬────────┐      │
│  │ project/│  work/   │   run/       │ claude/  │ skills/│      │
│  │ manager │  manager │   process    │ config   │ scanner│      │
│  └────┬────┴────┬─────┴──────┬───────┴────┬─────┴────┬───┘      │
│       │         │            │            │          │           │
│  ┌────┴─────────┴────────────┴────────────┴──────────┴───┐      │
│  │  storage/store.ts  │  git/git-service.ts  │ utils/logger│     │
│  └────────────────────┴──────────────────────┴─────────────┘     │
│                        │                                         │
│  ┌─────────────────────┼──────────────────────┐                 │
│  │  ~/.claude/session-manager.json             │                 │
│  │  ~/.claude/projects/<slug>/<uuid>.jsonl     │                 │
│  │  ~/.claude/skills/<skill>/SKILL.md          │                 │
│  │  <project>/.claude/settings.json            │                 │
│  │  <project>/.claude/settings.local.json (+.backup)            │
│  │  <project>/.claude/hooks/classify-bash.sh   │                 │
│  └─────────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

**Принцип:** Main Process владеет всей логикой. Renderer — тонкий, только отображение. Связь через типизированные IPC-контракты. `contextIsolation: true`, `nodeIntegration: false`.

---

## 2. Слой хранения — `storage/store.ts`

**Файл:** `~/.claude/session-manager.json`
**Формат:** один JSON с полной загрузкой в память при каждом обращении, атомарная запись (tmp + rename) при каждом изменении.

### Публичные методы

| Метод | Сигнатура | Описание |
|-------|-----------|---------|
| `load()` | `() => AppData` | Загружает данные из файла. Если файла нет — возвращает default (version=1, projects=[], works=[], settings=defaults). При несовпадении версии вызывает `migrate()` |
| `save(data)` | `(data: AppData) => void` | Атомарно пишет данные во временный файл, затем переименовывает в целевой |
| `getProjects()` | `() => Project[]` | Shortcut: `load().projects` |
| `getWorks()` | `() => Work[]` | Shortcut: `load().works` |
| `getSettings()` | `() => Settings` | Shortcut: `load().settings` |

### Сущности (shared/types.ts)

```typescript
interface AppData {
  version: number;           // схема версии (сейчас 1)
  projects: Project[];
  works: Work[];
  settings: Settings;
}

interface Project {
  id: string;                // UUID
  name: string;
  path: string;              // абсолютный путь (раскрытый ~)
  slug: string;              // slugifyPath(path)
  profile: Profile;          // 'android' | 'frontend' | 'python' | 'generic'
  createdAt: string;         // ISO 8601
}

interface Settings {
  watchdogTimeoutMinutes: number;  // default 10
  defaultMaxTurns: number;         // default 25
  defaultProfile: string;          // 'android' | 'frontend' | 'python' | 'generic'
  customPromptFragment: string;    // default '' — добавляется в начало каждого промпта
  uiMode: 'classic' | 'new';       // default 'classic'
}

interface StreamEvent {
  type: string;
  [key: string]: any;
}

interface HistoryEntry {
  type: string;
  [key: string]: any;
}

type RunReason = 'ok' | 'error' | 'timeout' | 'stopped' | 'config';
// 'config' — обёртка/окружение сломаны (напр. claude-sm вышел с кодом 127,
// command not found). Отличаем от обычной ошибки Claude.

interface RunResult {
  exitCode: number;
  reason: RunReason;
  errorDetail?: string;      // хвост stderr для reason 'error' | 'config'
}
```

### Инварианты
- Один файл — один источник правды о проектах, Work и настройках
- `load()` вызывается при каждом обращении (данные не кэшируются в памяти между вызовами)
- При сохранении всегда пишется полный `AppData`, а не частичные изменения

---

## 3. Слой Git — `git/git-service.ts`

Все git-операции через `execSync` с `cwd: projectPath` и таймаутом 30 секунд. Перед каждой операцией `checkGitAvailable()` кидает `GitNotFoundError`, если git не установлен.

### Публичные методы

| Метод | Сигнатура | Возврат |
|-------|-----------|---------|
| `isDirty(path)` | `(path: string)` | `{ isDirty: boolean, files: string[] }` |
| `discardChanges(path)` | `(path: string)` | `void` |
| `branchExists(path, name)` | `(path: string, name: string)` | `boolean` |
| `createBranch(path, name, base)` | `(path: string, name: string, base: string)` | `void` |
| `checkout(path, name)` | `(path: string, name: string)` | `void` |
| `getCurrentBranch(path)` | `(path: string)` | `string` |
| `getDefaultBranch(path)` | `(path: string)` | `string` |
| `getRemotes(path)` | `(path: string)` | `string[]` |
| `initRepo(path)` | `(path: string)` | `void` |

### Иерархия ошибок

```
GitError (code: string, userMessage: string)
├── DirtyRepoError    (code: 'DIRTY_REPO', files: string[])
├── BranchExistsError (code: 'BRANCH_EXISTS')
├── CheckoutError     (code: 'CHECKOUT_ERROR')
└── GitNotFoundError  (code: 'GIT_NOT_FOUND')
```

### Особенности реализации
- `isDirty()` фильтрует `.claude/` — незакоммиченные изменения в `.claude/` не считаются «грязным» репозиторием (файлы конфигурации приложения)
- `getDefaultBranch()` ищет `main`, затем `master`. Если нет ни того ни другого — `GitError('NO_DEFAULT_BRANCH')`
- `discardChanges()` выполняет `git checkout -- . && git clean -fd`
- `createBranch()` перед созданием ветки пытается `git fetch origin` (игнорирует ошибку, если remote нет)

---

## 4. Слой Claude Code конфигурации — `claude/claude-config.ts`

Управляет артефактами в директории проекта: `settings.json` (разрешения), `settings.local.json` (временные permissive-разрешения на время Run) и `hooks/classify-bash.sh` (классификатор Bash).

### Типы

```typescript
type Profile = 'android' | 'frontend' | 'python' | 'generic';
```

### Публичные методы

| Метод | Сигнатура | Описание |
|-------|-----------|---------|
| `sync(projectPath, profile)` | `(path: string, profile: Profile) => void` | Создаёт `.claude/` + `hooks/`, дополняет `.gitignore` (`.claude/`), **всегда перезаписывает** `settings.json` и `classify-bash.sh` |
| `generateHookScript(profile)` | `(profile: Profile) => string` | Генерирует тело `classify-bash.sh` с учётом профиля |
| `acquireLocalSettings(projectPath)` | `(path: string) => void` | Reference-counted: на первом активном Run в проекте бэкапит `settings.local.json` (если есть), затем пишет permissive-версию. Безопасен при конкурентных Run |
| `releaseLocalSettings(projectPath)` | `(path: string) => void` | Уменьшает счётчик; при последнем Run восстанавливает оригинал `settings.local.json` |
| `releaseAllLocalSettings()` | `() => void` | Восстанавливает оригинал для всех проектов (при shutdown) |
| `restoreLocalSettings(projectPath)` | `(path: string) => void` | Восстанавливает `settings.local.json` из `.backup` (используется при recovery после падения) |

### Артефакты, создаваемые модулем

**`.claude/settings.json`** (через `generateSettingsJson`):
```json
{
  "permissions": {
    "allow": ["mcp__generic_allure", "mcp__generic_jira", "...", "Read", "Glob", "Grep", "Edit", "Write"],
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

**`.claude/settings.local.json`** (через `generateLocalSettingsJson`): то же самое, но с добавлением `'Bash'` в `allow` — временно расширенные права на время Run.

**MCP-правила (`getMcpAllowRules`)**: Claude Code не разворачивает `mcp__*` (символ `*` в позиции сервера не матчится), поэтому серверы перечисляются явно. Имена читаются из `~/.claude.json` (`mcpServers`); если файл не читается — используется статический fallback (`generic_allure`, `generic_apptracer`, `generic_confluence`, `generic_gitlab`, `generic_jira`, `vkws`). Имена с `:` нормализуются в `_` (`generic:jira` → `mcp__generic_jira`).

**`.claude/hooks/classify-bash.sh`:** shell-скрипт, классифицирующий Bash-команду через `case`. Возвращает JSON с `permissionDecision: "allow" | "deny" | "ask"`.

### Профили и whitelist в хуке

| Профиль | Дополнительный allow в case |
|---------|---------------------------|
| `android` | `gradlew`, `adb` |
| `frontend` | `npm`, `npx`, `yarn`, `pnpm` |
| `python` | `pip`, `pytest`, `poetry`, `python`, `python3` |
| `generic` | Нет дополнительных |

### Инварианты
- `sync()` вызывается при создании проекта (`project:create`), авто-создании проекта из `work:create` (directory) и при смене `defaultProfile` в `settings:update` (пересинхронизация всех проектов)
- Всегда общий safe-whitelist (`git status`, `git diff`, `git log`, `git commit`, `git add`, `git branch`) плюс профильный
- Blacklist: `rm -rf`, `git push --force`, `git push -f`, `curl ... | bash/sh`
- Бэкап `settings.local.json` хранится в `settings.local.json.backup`; при отсутствии бэкапа permissive-файл остаётся на месте (безвреден до следующего `sync()`)

---

## 5. Слой проектов — `project/project-manager.ts`

### Публичные методы

| Метод | Сигнатура | Возврат | Побочные эффекты |
|-------|-----------|---------|-----------------|
| `createProject(params)` | `({ name, path, profile?, initRepo? })` | `Project` | Генерирует UUID, раскрывает `~`/относительный путь, проверяет уникальность пути, при `initRepo` — создаёт директорию и `git init`, добавляет в store |
| `listProjects()` | `() => Project[]` | Массив проектов | — |
| `getProject(id)` | `(id: string) => Project \| undefined` | Проект или undefined | — |
| `findProjectByPath(rawPath)` | `(path: string) => Project \| undefined` | Проект с совпадающим путём | — |
| `generateUniqueName(baseName)` | `(name: string) => string` | Уникальное имя | Добавляет `-1`, `-2`, … при коллизии |
| `deleteProject(id)` | `(id: string) => void` | — | Блокирует, если в проекте есть Work со статусом `!== 'COMPLETED'`. Удаляет из store |

### Правила валидации
- `path` должен быть уникальным среди всех проектов (сравнение по раскрытому пути)
- Нельзя удалить проект, в котором есть хотя бы один незавершённый Work (`status !== 'COMPLETED'`)
- `slug` = path с заменой всех не-алфанумерик символов на `-` (`/Users/me/my-app` → `-Users-me-my-app`)

---

## 6. Слой Work — `work/work-manager.ts`

Центральный модуль бизнес-логики. Управляет жизненным циклом Work.

### Публичные методы

| Метод | Сигнатура | Возврат | Описание |
|-------|-----------|---------|---------|
| `createWork(params)` | `({ projectId?, name?, description, directory? })` | `Work` | Если передан `directory` — находит/авто-создаёт проект и синкает его конфиг. Записывает **текущую** ветку (git-ветка НЕ создаётся). Статус: `IN_PROGRESS` |
| `listWorks(projectId?)` | `(projectId?: string)` | `Work[]` | Все Work'и или фильтр по проекту |
| `getWork(id)` | `(id: string) => Work \| undefined` | Work или undefined | Поиск по ID |
| `getLastResult(workId)` | `(workId: string) => string \| null` | Текст или null | Читает JSONL с диска, проходит от конца к началу в поисках последнего `result` или `assistant` |
| `getFullHistory(workId)` | `(workId: string) => HistoryEntry[]` | Массив записей | Читает весь JSONL сессии (для `work:history`) |
| `sessionFileExists(workId)` | `(workId: string) => boolean` | Есть ли файл сессии | Используется для определения resume |
| `markRunStarted(workId, pid)` | `(workId: string, pid: number) => void` | — | Статус → `IN_PROGRESS`, запись PID, очистка `lastError` |
| `markRunCompleted(workId, statusNote?, errorDetail?)` | `(workId: string, statusNote?: string, errorDetail?: string) => void` | — | Статус → `AWAITING_INPUT`, очистка PID, инкремент `runCount`, запись `statusNote`/`lastError` |
| `completeWork(workId)` | `(workId: string) => void` | — | Статус → `COMPLETED`, запись `completedAt` |
| `renameWork(workId, name)` | `(workId: string, name: string) => void` | — | Переименование Work (`name`) |
| `deleteWork(workId)` | `(workId: string) => void` | — | Убивает процесс по PID если жив, удаляет JSONL с диска, удаляет из store |
| `updateWorkDirect(workId, updater)` | `(workId: string, updater: (Work) => void) => void` | — | Прямая мутация Work (для register.ts: shutdown/recovery) |

### Статусная машина

```
         createWork()
              │
              ▼
        IN_PROGRESS  ←──────────────────────┐
              │                              │
   markRunCompleted()                   spawnRun()
   (причина: ok/error/                    (resume)
    timeout/stopped/config)                 │
              │                              │
              ▼                              │
       AWAITING_INPUT ──────────────────────┘
              │
     completeWork()
              │
              ▼
         COMPLETED
```

### Особенности createWork()
1. При `directory` — `findProjectByPath()`; если проекта нет, авто-создание с `profile: 'generic'` + `syncClaudeConfig()`
2. Обязателен либо `projectId`, либо `directory`
3. `branch` = текущая ветка проекта (git-ветка **не** создаётся и **не** переключается — решает Claude Code)
4. Если проект не git-репозиторий — `branch` остаётся пустым, git-проверки пропускаются

### Сущность Work

```typescript
interface Work {
  id: string;              // UUID = session_id Claude Code
  projectId: string;       // → Project.id
  name?: string;           // короткое имя; при отсутствии в UI используется description
  description: string;     // Описание задачи / prompt первого Run
  branch: string;          // Текущая ветка на момент создания
  status: 'IN_PROGRESS' | 'AWAITING_INPUT' | 'COMPLETED';
  statusNote?: string;     // Пометка причины: «ошибка», «таймаут», «остановлено», «восстановлен»
  lastError?: string;      // Хвост stderr упавшего Run (показывается в UI)
  currentRunPid: number | null;
  runCount: number;
  lastActiveAt: string;    // ISO 8601
  createdAt: string;
  completedAt: string | null;
}
```

---

## 7. Слой Run — `run/run-process.ts` + `run/args-builder.ts`

### 7.1 ArgsBuilder

| Метод | Сигнатура | Описание |
|-------|-----------|---------|
| `buildArgs(sessionId, prompt, settings, isResume)` | `(string, string, Settings, boolean) => string[]` | Собирает массив аргументов для `claude -p` |

**Результат для первого Run:**
```
--session-id <uuid> -p "<prompt>" --output-format stream-json --verbose --max-turns <N>
```

**Результат для resume Run:**
```
--resume <uuid> -p "<prompt>" --output-format stream-json --verbose --max-turns <N>
```

**Особенности:**
- Если задан `settings.customPromptFragment` — он добавляется в начало промпта (`fragment + '\n\n' + prompt`)
- `--max-turns` добавляется только при `defaultMaxTurns > 0`
- `--permission-mode` не передаётся — используются project-local `settings.json`/`settings.local.json` + PreToolUse hook
- Сам бинарник `claude-sm` подставляет `RunProcess.spawn()`, а не `buildArgs()`

### 7.2 RunProcess

Класс, управляющий одним подпроцессом `claude-sm`.

#### Конструктор
```typescript
constructor(callbacks: RunCallbacks, workId: string)
```

#### Колбэки
```typescript
interface RunCallbacks {
  onStarted: (sessionId: string) => void;
  onEvent: (sessionId: string, event: StreamEvent) => void;
  onCompleted: (sessionId: string, result: RunResult) => void;
}
```

#### Публичные методы

| Метод | Сигнатура | Описание |
|-------|-----------|---------|
| `spawn(projectPath, args, watchdogTimeoutMinutes)` | `(string, string[], number) => void` | Запускает `claude-sm` с pipe stdio. Читает stdout через `readline`. Запускает watchdog |
| `cancel()` | `() => void` | SIGTERM → ожидание 5 сек → SIGKILL |
| `getPid()` | `() => number \| null` | PID процесса или null |
| `isRunning()` | `() => boolean` | Процесс жив и не завершился |

#### Внутренняя логика spawn()

1. Создаёт/дописывает лог-файл `~/.claude/session-manager-logs/<workId>.log`
2. `child_process.spawn('claude-sm', args, { cwd: projectPath, env: { ...process.env, CLAUDECODE: '' }, stdio: ['pipe', 'pipe', 'pipe'] })` — `CLAUDECODE: ''` разрешает вложенные запуски
3. **stdout:** построчное чтение через `readline`, каждая строка → `JSON.parse` → `onEvent(sessionId, event)`. Не-JSON строки игнорируются
4. **stderr:** пишется в лог-файл; последние ~4000 символов хранятся в `stderrTail`
5. **AskUserQuestion:** при `event.type === 'assistant'` с `tool_use` `AskUserQuestion` → `awaitingInput=true`, закрытие stdin, fallback-kill через 5 сек
6. **exit:** классификация кода возврата:
   - `awaitingInput` → reason=`ok`
   - `timeoutOccurred` → reason=`timeout`
   - `cancelled` → reason=`stopped`
   - `exitCode=0` → reason=`ok`
   - `exitCode=127` → reason=`config` (command not found — обёртка/окружение сломаны)
   - иначе → reason=`error`
7. **error:** событие `error` на процессе → reason=`error`, exitCode=-1, `errorDetail` = сообщение
8. **watchdog:** после каждого события сбрасывается таймер. Если stdout молчит > N минут → `timeoutOccurred=true` + `cancel()` (exit-обработчик выставит reason=`timeout`)
9. `errorDetail` заполняется хвостом `stderrTail` для `error`/`config`

#### Выходные типы

```typescript
type RunReason = 'ok' | 'error' | 'timeout' | 'stopped' | 'config';

interface RunResult {
  exitCode: number;
  reason: RunReason;
  errorDetail?: string;
}
```

---

## 8. Слой IPC — `ipc/`

### 8.1 Оркестратор — `ipc/register.ts`

Центральный модуль, связывающий все слои. Вызывается из `main/index.ts`.

| Функция | Описание |
|---------|---------|
| `registerAllIPC(window: BrowserWindow)` | Регистрирует `project`, `settings`, `skills` и `work` (через `WorkHandlerDeps`), управляет `activeRuns` Map |
| `shutdownAllRuns()` | Вызывается при `before-quit`. Cancel всех активных Run'ов + пометка «приложение закрыто» + `releaseAllLocalSettings()` |
| `recoverStaleWorks()` | Вызывается при старте. Work'и с `status=IN_PROGRESS` или `currentRunPid != null` → `AWAITING_INPUT` + «восстановлен»; для таких проектов `restoreLocalSettings()` |

#### Внутренние функции (не экспортируются)

| Функция | Описание |
|---------|---------|
| `spawnRun(workId, prompt)` | Cancel существующего Run (если есть), вычисляет `isResume = runCount > 0 && sessionFileExists(workId)`, `buildArgs()`, `acquireLocalSettings()`, создаёт `RunProcess`, передаёт колбэки |
| `cancelRun(workId)` | Отменяет Run, удаляет из `activeRuns`, `releaseLocalSettings()` |
| `sendWorkUpdate(workId)` | Шлёт событие `work:updated` в renderer |

#### Состояние активных Run'ов

`activeRuns: Map<string, RunProcess>` — ключ = workId. Используется для:
- Проверки: не запускать Run, если в этом проекте уже есть активный
- Shutdown: cancel всех процессов при выходе
- Cancel: ручная остановка из UI

### 8.2 Обработчики — `ipc/handlers/`

Каждый файл регистрирует `ipcMain.handle` для своей группы каналов. Обработчики тонкие — делегируют в менеджеры.

#### `handlers/project.ts` — `registerProjectHandlers()`

| Канал | Параметры | Делегат |
|-------|-----------|---------|
| `project:list` | — | `projectManager.listProjects()` |
| `project:get` | `{ id }` | `projectManager.getProject(id)` |
| `project:create` | `{ name, path, profile?, initRepo? }` | `projectManager.createProject()` + `claudeConfig.sync()` |
| `project:delete` | `{ id }` | `projectManager.deleteProject(id)` |
| `project:check-dirty` | `{ id }` | `gitService.isDirty(project.path)` |
| `project:discard` | `{ id }` | `gitService.discardChanges(project.path)` |
| `project:check-branch` | `{ id, branchName }` | `gitService.branchExists(project.path, branchName)` |

#### `handlers/work.ts` — `registerWorkHandlers(deps: WorkHandlerDeps)`

Принимает `deps` с методами `spawnRun` и `cancelRun` (внедрение зависимостей из register.ts).

| Канал | Параметры | Логика |
|-------|-----------|--------|
| `work:list` | `{ projectId? }` | `workManager.listWorks(projectId)` |
| `work:get` | `{ id }` | `workManager.getWork(id)` + `workManager.getLastResult(id)` |
| `work:create` | `{ projectId?, name?, description, directory? }` | `createWork()` → `deps.spawnRun(work.id, work.description)` |
| `work:delete` | `{ id }` | `deps.cancelRun(id)` + `deleteWork(id)` |
| `work:complete` | `{ id }` | `completeWork(id)` |
| `work:respond` | `{ id, message }` | `markRunStarted(id, 0)` + `deps.spawnRun(id, message)` |
| `work:cancel` | `{ id }` | `deps.cancelRun(id)` + `markRunCompleted(id, 'остановлено пользователем')` |
| `work:restart-run` | `{ id }` | `deps.spawnRun(id, work.description)` |
| `work:rename` | `{ id, name }` | `renameWork(id, name)` |
| `work:history` | `{ id }` | `getFullHistory(id)` → `{ messages }` |

#### `handlers/settings.ts` — `registerSettingsHandlers()`

| Канал | Параметры | Логика |
|-------|-----------|--------|
| `settings:get` | — | `load().settings` |
| `settings:update` | `Partial<Settings>` | Partial merge + save; при смене `defaultProfile` — пересинхронизация `.claude`-конфига всех проектов |

#### `handlers/skills.ts` — `registerSkillsHandlers()`

| Канал | Параметры | Логика |
|-------|-----------|--------|
| `skills:list` | `{ projectPath? }` | `scanSkills(projectPath)` → `{ skills, builtIn }` |

### 8.3 Preload — `preload/index.ts`

`contextBridge.exposeInMainWorld('electronAPI', { ... })` — проксирует все 20 invoke-команд и 4 подписки на события.

**Команды** (invoke): 7 `project*`, 10 `work*` (включая `workRename`, `workHistory`), 2 `settings*`, 1 `skillsList`.

**События** (listener):
- `onRunEvent(callback)` — каждое событие stream-json
- `onRunStarted(callback)` — Run начался
- `onRunCompleted(callback)` — Run завершился
- `onWorkUpdated(callback)` — изменился Work

---

## 9. Слой Renderer — `renderer/`

### 9.1 Структура

```
renderer/
├── index.html              — DOM-структура: sidebar, views, dialog overlay, формы
├── app.js                  — Вся логика UI (~1050 строк vanilla JS)
├── slash-autocomplete.js   — Автодополнение /-команд и скиллов (самодостаточный IIFE-модуль)
├── api/ipc-client.ts       — Типизированная обёртка window.electronAPI (TypeScript)
└── styles.css              — Тёмная тема (~330 строк)
```

**Важно:** renderer исключён из компиляции TypeScript. `app.js` и `slash-autocomplete.js` — чистый JavaScript, работают с `window.electronAPI` напрямую. `ipc-client.ts` — декларация типов и экспорт `api` для статического анализа, но в рантайме `app.js` вызывает `window.electronAPI` напрямую.

### 9.2 Состояние UI (app.js)

```javascript
state = {
  projects: [],            // Project[]
  works: [],               // Work[] (текущего проекта или все активные)
  activeWorks: [],         // все non-COMPLETED работы для sidebar
  selectedProjectId: null,
  selectedWorkId: null,
  activeRuns: {},          // { [workId]: { events: StreamEvent[] } }
  settings: {},            // Settings
  skillsCache: { skills: [], builtIn: [] },
  currentView: 'works',    // 'works' | 'project-create' | 'settings' | 'new-ui'
  viewingActive: false,    // выбран ли "Active Works" в sidebar
  uiMode: 'classic',       // 'classic' | 'new'
}
```

### 9.3 Основные функции app.js

| Функция | Описание |
|---------|---------|
| `loadProjects()` | Загружает проекты через `api.projectList()`, рендерит sidebar |
| `loadWorks()` | Загружает Work'и выбранного проекта (или активные), рендерит список |
| `loadActiveWorks()` | Загружает все non-COMPLETED работы в боковую панель |
| `loadSettings()` | Загружает настройки, рендерит форму |
| `loadSkills()` | Загружает скиллы через `api.skillsList()` в `skillsCache` |
| `initSlashAutocomplete()` | Подключает `SlashAutocomplete.attach()` к полям ввода |
| `renderProjectList()` | Отрисовка боковой панели проектов: имя + кнопка удаления |
| `renderActiveWorksSidebar()` | Отрисовка панели активных работ |
| `renderWorkList()` | Список Work: имя, ветка, Run-кол-во, дата, проект, статус |
| `renderWorkDetail(work, lastResult)` | Детальный вид в зависимости от статуса |
| `renderWorkHistory(workId)` | Полная история сессии (user → assistant/result) через `workHistory` |
| `renderStreamEvent(event)` | Отрисовка одного события stream-json (thinking свёрнут, tool_use, result) |
| `renderStatusBadge(status, note)` | Цветной badge |
| `showDialog(title, bodyHTML, buttons)` | Модальный диалог |
| `handleError(err, context)` | Классификация ошибок: DirtyRepoError (с Discard), BranchExistsError, GitNotFoundError, generic |
| `switchUIMode(mode)` / `applyUIMode()` | Переключение/применение `uiMode` (classic/new) |
| `bindEvents()` | Подписка на 4 IPC-события от Main |

### 9.4 Slash Autocomplete (`slash-autocomplete.js`)

Самодостаточный IIFE-модуль `SlashAutocomplete` (глобально `window.SlashAutocomplete`). Метод `attach(textarea, button, skillsCache)`:
- Кнопка `/` открывает выпадающий список
- При вводе `/<query>` фильтрует `skills` + `builtIn` по префиксу
- Навигация стрелками, выбор Enter/Tab, закрытие Escape/blur
- Подстановка `/<name> ` в textarea с учётом пробела-разделителя

### 9.5 Представления (Views)

| View | DOM ID | Когда показан |
|------|--------|--------------|
| Works | `#view-works` | Основной экран: список Work + detail |
| Project Create | `#view-project-create` | Форма создания проекта |
| Settings | `#view-settings` | Форма настроек |
| New UI | `#view-new-ui` | Плейсхолдер будущего интерфейса (по `uiMode === 'new'`) |

---

## 10. Точка входа — `main/index.ts`

```typescript
app.whenReady() → createWindow()
  ├── new BrowserWindow({ preload, contextIsolation: true, nodeIntegration: false, 1200×800 })
  ├── mainWindow.loadFile('renderer/index.html')
  ├── registerAllIPC(mainWindow)
  └── recoverStaleWorks()

app.on('before-quit') → shutdownAllRuns()
app.on('window-all-closed') → app.quit()
app.on('activate') → recreate window if closed
```

---

## 11. Потоки данных

### 11.1 Создание Work и запуск Run

```
Renderer                          Main                              OS
───────                          ──────                             ────
work:create ──────► handler ──► createWork()
  {projectId?,                      │ авто-создание проекта (directory)
   name?,                           │ запись текущей ветки
   description,                     │ Work → store
   directory?}                      ▼
                              spawnRun(workId, description)
                                   │ isResume = runCount>0 && sessionFileExists()
                                   │ buildArgs() → ['--session-id', uuid, '-p', desc, ...]
                                   │ acquireLocalSettings(project.path)
                                   │ new RunProcess(callbacks, workId)
                                   │ rp.spawn(projectPath, args, timeout)
                                   │
                                   ├──► spawn('claude-sm', args, { cwd, stdio: 'pipe' })
                                   │         │
◄── run:started ────── onStarted ─┘         ▼
  {workId}                              claude-sm process
                                   │         │
◄── run:event ──────── onEvent ◄───readline──┘
  {workId, event}                      stdout JSONL
  ... (поток)                           ...
                                   │
                                   ├── exit(code)
                                   │
◄── run:completed ─── onCompleted ─┘
  {workId, exitCode, reason, errorDetail}
◄── work:updated
  {work}
                                   │
                              releaseLocalSettings(project.path)
```

### 11.2 Ответ пользователя (resume)

```
work:respond ────► handler ──► markRunStarted(id, 0) + spawnRun(id, message)
  {id, message}                  │
                                 ▼
                            isResume = runCount>0 && sessionFileExists(id)
                            buildArgs(..., isResume=true)
                            → ['--resume', uuid, '-p', message, ...]
                                 │
                            (дальше как в 11.1)
```

### 11.3 Shutdown

```
app.on('before-quit')
  │
  └── shutdownAllRuns()
        │
        for each activeRuns:
          ├── rp.cancel()  → SIGTERM → 5s → SIGKILL
          └── updateWorkDirect(id, → AWAITING_INPUT + note='приложение закрыто')
        │
        └── releaseAllLocalSettings()   // восстановить settings.local.json во всех проектах
```

### 11.4 Recovery

```
app.whenReady()
  │
  └── recoverStaleWorks()
        │
        for each work in store:
          if status === 'IN_PROGRESS' || currentRunPid !== null:
            ├── updateWorkDirect(id, → AWAITING_INPUT + note='восстановлен после перезапуска')
            └── restoreLocalSettings(project.path)  // если остался .backup
```

---

## 12. Файловая система — артефакты приложения

| Путь | Формат | Владелец | Назначение |
|------|--------|----------|-----------|
| `~/.claude/session-manager.json` | JSON | `store.ts` | Состояние приложения: проекты, Work, настройки |
| `~/.claude/session-manager-logs/app.log` | Text | `logger.ts` | Логи приложения |
| `~/.claude/session-manager-logs/<workId>.log` | Text | `run-process.ts` | stdout/stderr + логи конкретного Run |
| `~/.claude/projects/<slug>/<uuid>.jsonl` | JSONL | Claude Code | Сессионные данные (читаются `getLastResult()` / `getFullHistory()`) |
| `~/.claude/skills/<skill>/SKILL.md` | Markdown | Claude Code | Глобальные скиллы (сканируются `skill-scanner.ts`) |
| `<project>/.claude/skills/<skill>/SKILL.md` | Markdown | Claude Code | Проектные скиллы |
| `<project>/.claude/settings.json` | JSON | `claude-config.ts` | Разрешения Claude Code для проекта |
| `<project>/.claude/settings.local.json` (+`.backup`) | JSON | `claude-config.ts` | Временные permissive-разрешения на время Run |
| `<project>/.claude/hooks/classify-bash.sh` | Shell | `claude-config.ts` | Классификатор Bash-команд |

---

## 13. Именованные контракты IPC

### Команды (Renderer → Main, `ipcRenderer.invoke`)

| Канал | Request | Response |
|-------|---------|----------|
| `project:list` | — | `Project[]` |
| `project:get` | `{ id }` | `Project` |
| `project:create` | `{ name, path, profile?, initRepo? }` | `Project` |
| `project:delete` | `{ id }` | `void` |
| `project:check-dirty` | `{ id }` | `{ isDirty, files }` |
| `project:discard` | `{ id }` | `void` |
| `project:check-branch` | `{ id, branchName }` | `{ exists }` |
| `work:list` | `{ projectId? }` | `Work[]` |
| `work:get` | `{ id }` | `{ work, lastResult }` |
| `work:create` | `{ projectId?, name?, description, directory? }` | `Work` |
| `work:delete` | `{ id }` | `void` |
| `work:complete` | `{ id }` | `void` |
| `work:respond` | `{ id, message }` | `void` |
| `work:cancel` | `{ id }` | `void` |
| `work:restart-run` | `{ id }` | `void` |
| `work:rename` | `{ id, name }` | `void` |
| `work:history` | `{ id }` | `{ messages: HistoryEntry[] }` |
| `settings:get` | — | `Settings` |
| `settings:update` | `Partial<Settings>` | `Settings` |
| `skills:list` | `{ projectPath? }` | `{ skills, builtIn }` |

### События (Main → Renderer, `webContents.send`)

| Канал | Payload | Когда |
|-------|---------|-------|
| `run:started` | `{ workId }` | Run начался |
| `run:event` | `{ workId, event }` | Каждая строка stream-json |
| `run:completed` | `{ workId, exitCode, reason, errorDetail? }` | Run завершился |
| `work:updated` | `{ work }` | Изменился Work |

---

## 14. Обработка ошибок — сквозной контракт

Ошибки, выбрасываемые из Main, проходят через `ipcMain.handle` и попадают в Renderer как rejected Promise. Renderer классифицирует:

| Тип ошибки | Код | Диалог | Действия |
|-----------|-----|--------|---------|
| `GitNotFoundError` | `GIT_NOT_FOUND` | "Git is not installed" | OK |
| `DirtyRepoError` | `DIRTY_REPO` | Список файлов | Discard / Cancel |
| `BranchExistsError` | `BRANCH_EXISTS` | "Ветка уже существует" | OK |
| `CheckoutError` | `CHECKOUT_ERROR` | "Не удалось переключиться на ветку" | OK |
| Generic Error | — | `message` или `userMessage` | OK |

**Примечание:** ошибки Run не бросаются как exception, а доставляются через событие `run:completed` с полем `reason` (`'ok' | 'error' | 'timeout' | 'stopped' | 'config'`) и `errorDetail` (хвост stderr для `error`/`config`).

---

## 15. Точки расширения для новых фич

### Добавление нового IPC-канала
1. Добавить константу в `shared/ipc-channels.ts` → `IPC`
2. Зарегистрировать `ipcMain.handle` в соответствующем `handlers/*.ts`
3. Добавить метод в `preload/index.ts`
4. Добавить сигнатуру в `renderer/api/ipc-client.ts`

### Добавление новой сущности
1. Добавить интерфейс в `shared/types.ts`
2. При необходимости — новое поле в `AppData`
3. Создать менеджер в `src/main/<entity>/`
4. Создать обработчик в `src/main/ipc/handlers/`
5. Зарегистрировать в `register.ts`

### Добавление нового профиля разрешений
1. Добавить значение в `Profile` union type в `claude-config.ts`
2. Добавить whitelist в `PROFILE_WHITELIST`
3. Добавить опцию в `<select id="proj-profile">` и `<select id="set-profile">` в `index.html`

### Изменение модели данных Work
1. Изменить `Work` в `shared/types.ts`
2. Обновить создание Work в `work-manager.ts`
3. При необходимости — `migrate()` в `store.ts` + инкремент `CURRENT_VERSION`

### Добавление нового события stream-json в UI
1. Расширить `renderStreamEvent()` в `app.js` — добавить новый `if (event.type === '...')`
2. При необходимости — новый CSS-класс в `styles.css`

### Добавление нового источника скиллов
1. Расширить `scanSkills()` / `scanDirectory()` в `skill-scanner.ts`
2. При необходимости — новые built-in команды в `BUILT_IN_COMMANDS`

### Добавление нового режима UI
1. Добавить view в `index.html`
2. Добавить case в `showView()` в `app.js`
3. При необходимости — расширить `uiMode` union type в `shared/types.ts`
