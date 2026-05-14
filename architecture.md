# Session Manager — Architecture Reference

## 1. Обзор слоёв

```
┌─────────────────────────────────────────────────────────┐
│                     Renderer Process                     │
│  index.html  ←→  app.js  ←→  api/ipc-client.ts          │
│                        │ IPC (invoke + events)            │
├────────────────────────┼────────────────────────────────┤
│                     Preload                              │
│              contextBridge.exposeInMainWorld             │
│                        │                                 │
├────────────────────────┼────────────────────────────────┤
│                    Main Process                          │
│                        │                                 │
│  ┌─────────────────────┼──────────────────────┐         │
│  │  ipc/register.ts  ←─┼─  Orchestration       │         │
│  │  ipc/handlers/     ←┼─  (project/work/settings)│      │
│  └─────────┬───────────┼──────────────────────┘         │
│            │                                              │
│  ┌─────────┼──────────┬──────────────┬──────────┐       │
│  │ project/│  work/   │   run/       │ claude/  │       │
│  │ manager │  manager │   process    │ config   │       │
│  └────┬────┴────┬─────┴──────┬───────┴────┬─────┘       │
│       │         │            │            │              │
│  ┌────┴─────────┴────────────┴────────────┴────┐        │
│  │  storage/store.ts  │  git/git-service.ts    │        │
│  │  utils/logger.ts   │                        │        │
│  └────────────────────┴────────────────────────┘        │
│                        │                                 │
│  ┌─────────────────────┼──────────────────────┐         │
│  │  ~/.claude/session-manager.json             │         │
│  │  ~/.claude/projects/<slug>/<uuid>.jsonl     │         │
│  │  <project>/.claude/settings.json            │         │
│  │  <project>/.claude/hooks/classify-bash.sh   │         │
│  └────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘
```

**Принцип:** Main Process владеет всей логикой. Renderer — тонкий, только отображение. Связь через типизированные IPC-контракты. `contextIsolation: true`, `nodeIntegration: false`.

---

## 2. Слой хранения — `storage/store.ts`

**Файл:** `~/.claude/session-manager.json`
**Формат:** один JSON с полной загрузкой в память при старте, атомарная запись (tmp + rename) при каждом изменении.

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

interface Settings {
  watchdogTimeoutMinutes: number;  // default 10
  defaultMaxTurns: number;         // default 25
  defaultProfile: string;          // 'android' | 'frontend' | 'python' | 'generic'
}
```

### Инварианты
- Один файл — один источник правды о проектах, Work и настройках
- Загрузка при старте в `registerAllIPC()` → рекурентно через `load()` при каждом обращении
- При сохранении всегда пишется полный `AppData`, а не частичные изменения

---

## 3. Слой Git — `git/git-service.ts`

Все git-операции через `execSync` с `cwd: projectPath` и таймаутом 30 секунд.

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

### Иерархия ошибок

```
GitError (code: string, userMessage: string)
├── DirtyRepoError    (code: 'DIRTY_REPO', files: string[])
├── BranchExistsError (code: 'BRANCH_EXISTS', branchName: string)
├── CheckoutError     (code: 'CHECKOUT_ERROR')
└── GitNotFoundError  (code: 'GIT_NOT_FOUND')
```

### Особенности реализации
- `isDirty()` фильтрует `.claude/` — незакоммиченные изменения в `.claude/` не считаются «грязным» репозиторием (файлы конфигурации приложения)
- `getDefaultBranch()` ищет `main`, затем `master`. Если нет ни того ни другого — ошибка
- `discardChanges()` выполняет `git checkout -- . && git clean -fd` (только после подтверждения пользователем)

---

## 4. Слой Claude Code конфигурации — `claude/claude-config.ts`

Управляет двумя артефактами в директории проекта: `settings.json` (разрешения) и `hooks/classify-bash.sh` (классификатор Bash).

### Типы

```typescript
type Profile = 'android' | 'frontend' | 'python' | 'generic';
```

### Публичные методы

| Метод | Сигнатура | Описание |
|-------|-----------|---------|
| `ensure(projectPath, profile)` | `(path: string, profile: Profile) => void` | Создаёт `.claude/settings.json`, `hooks/classify-bash.sh` и дополняет `.gitignore`. **Не перезаписывает**, если файлы уже существуют |
| `sync(projectPath, profile)` | `(path: string, profile: Profile) => void` | Принудительно перезаписывает файлы (по запросу пользователя, например при смене профиля) |
| `generateHookScript(profile)` | `(profile: Profile) => string` | Генерирует тело `classify-bash.sh` с учётом профиля |

### Артефакты, создаваемые модулем

**`.claude/settings.json`:**
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

**`.claude/hooks/classify-bash.sh`:** shell-скрипт, классифицирующий Bash-команду через `case`. Возвращает JSON с `permissionDecision: "allow" | "deny" | "ask"`.

### Профили и whitelist в хуке

| Профиль | Дополнительный allow в case |
|---------|---------------------------|
| `android` | `gradlew`, `adb` |
| `frontend` | `npm`, `npx`, `yarn`, `pnpm` |
| `python` | `pip`, `pytest`, `poetry`, `python`, `python3` |
| `generic` | Нет дополнительных |

### Инварианты
- `ensure()` вызывается при создании проекта (`project:create` handler)
- `sync()` вызывается при смене профиля (пока не реализован UI для смены профиля существующего проекта)
- Всегда общий safe-whitelist (`git status`, `git diff`, `git log`, `git commit`, `git add`, `git branch`) плюс профильный
- Blacklist: `rm -rf`, `git push --force`, `curl ... | bash/sh`

---

## 5. Слой проектов — `project/project-manager.ts`

### Публичные методы

| Метод | Сигнатура | Возврат | Побочные эффекты |
|-------|-----------|---------|-----------------|
| `createProject(params)` | `({ name, path, profile? })` | `Project` | Генерирует UUID, вычисляет slug из path, проверяет уникальность path, добавляет в store |
| `listProjects()` | `() => Project[]` | Массив проектов | — |
| `getProject(id)` | `(id: string) => Project \| undefined` | Проект или undefined | — |
| `deleteProject(id)` | `(id: string) => void` | — | Блокирует, если есть незавершённые Work'и в проекте. Удаляет из store |

### Правила валидации
- `path` должен быть уникальным среди всех проектов
- Нельзя удалить проект, в котором есть Work со статусом `IN_PROGRESS` или `AWAITING_INPUT`
- `slug` = path с заменой всех не-алфанумерик символов на `-`

---

## 6. Слой Work — `work/work-manager.ts`

Центральный модуль бизнес-логики. Управляет жизненным циклом Work.

### Публичные методы

| Метод | Сигнатура | Возврат | Описание |
|-------|-----------|---------|---------|
| `createWork(params)` | `({ projectId, description, branchName })` | `Work` | Полная валидация + создание git-ветки + запись в store. Статус: `IN_PROGRESS` |
| `listWorks(projectId?)` | `(projectId?: string)` | `Work[]` | Все Work'и или фильтр по проекту |
| `getWork(id)` | `(id: string) => Work \| undefined` | Work или undefined | Поиск по ID |
| `getLastResult(workId)` | `(workId: string) => string \| null` | Текст или null | Читает JSONL с диска, проходит от конца к началу в поисках последнего `result` или `assistant` |
| `markRunStarted(workId, pid)` | `(workId: string, pid: number) => void` | — | Статус → `IN_PROGRESS`, запись PID |
| `markRunCompleted(workId, statusNote?)` | `(workId: string, statusNote?: string) => void` | — | Статус → `AWAITING_INPUT`, очистка PID, инкремент `runCount` |
| `completeWork(workId)` | `(workId: string) => void` | — | Статус → `COMPLETED`, запись `completedAt` |
| `deleteWork(workId)` | `(workId: string) => void` | — | Убивает процесс по PID если жив, удаляет JSONL с диска, удаляет из store |
| `ensureBranch(workId)` | `(workId: string) => void` | — | `git checkout <branch>` в директории проекта |
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
    timeout/stopped)                        │
              │                              │
              ▼                              │
       AWAITING_INPUT ──────────────────────┘
              │
     completeWork()
              │
              ▼
         COMPLETED
```

### Валидация при createWork()
1. Проект существует
2. Репозиторий не грязный (если грязный — `DirtyRepoError`)
3. Имя ветки уникально (если нет — `BranchExistsError`)
4. В проекте нет активного Run'а (статус `IN_PROGRESS`)
5. Создаётся git-ветка от `main`/`master`

### Сущность Work

```typescript
interface Work {
  id: string;              // UUID = session_id Claude Code
  projectId: string;       // → Project.id
  description: string;     // Описание задачи / prompt первого Run
  branch: string;          // Имя git-ветки
  status: 'IN_PROGRESS' | 'AWAITING_INPUT' | 'COMPLETED';
  statusNote?: string;     // Пометка причины: «бюджет», «ошибка», «остановлено пользователем», «восстановлен»
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
| `buildArgs(sessionId, prompt, settings, isResume)` | `(string, string, Settings, boolean) => string[]` | Собирает массив аргументов для `claude-sm` |

**Результат для первого Run:**
```
claude-sm --session-id <uuid> -p "<prompt>" --output-format stream-json --verbose --max-turns <N>
```

**Результат для resume Run:**
```
claude-sm --resume <uuid> -p "<prompt>" --output-format stream-json --verbose --max-turns <N>
```

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
| `spawn(projectPath, args, watchdogTimeoutMinutes)` | `(string, string[], number) => void` | Запускает `claude-sm` с pipe stdio. Начинает чтение stdout через `readline`. Запускает watchdog |
| `cancel()` | `() => void` | SIGTERM → ожидание 5 сек → SIGKILL |
| `getPid()` | `() => number \| null` | PID процесса или null |
| `isRunning()` | `() => boolean` | Процесс жив и не завершился |

#### Внутренняя логика spawn()

1. Создаёт лог-файл `~/.claude/session-manager-logs/<workId>.log`
2. `child_process.spawn('claude-sm', args, { cwd: projectPath, stdio: ['pipe', 'pipe', 'pipe'] })`
3. **stdout:** построчное чтение через `readline`, каждая строка → `JSON.parse` → `onEvent(sessionId, event)`. Не-JSON строки игнорируются.
4. **stderr:** пишется в лог-файл
5. **exit:** классификация кода возврата:
   - `cancelled=true` → reason=`stopped`
   - `exitCode=0` → reason=`ok`
   - `exitCode≠0` → reason=`error`
6. **error:** событие `error` на процессе → reason=`error`, exitCode=-1
7. **watchdog:** после каждого события сбрасывается таймер. Если stdout молчит > N минут → `cancel()` + reason=`timeout`

#### Выходные типы

```typescript
type RunReason = 'ok' | 'error' | 'timeout' | 'stopped';

interface RunResult {
  exitCode: number;
  reason: RunReason;
}
```

---

## 8. Слой IPC — `ipc/`

### 8.1 Оркестратор — `ipc/register.ts`

Центральный модуль, связывающий все слои. Вызывается из `main/index.ts`.

| Функция | Описание |
|---------|---------|
| `registerAllIPC(window: BrowserWindow)` | Регистрирует все `ipcMain.handle`, создаёт `WorkHandlerDeps` (spawnRun/cancelRun), управляет `activeRuns` Map |
| `shutdownAllRuns()` | Вызывается при `before-quit`. Cancel всех активных Run'ов + пометка «приложение закрыто» |
| `recoverStaleWorks()` | Вызывается при старте. Work'и с `status=IN_PROGRESS` или `currentRunPid != null` → `AWAITING_INPUT` + пометка «восстановлен после перезапуска» |

#### Внутренние функции (не экспортируются)

| Функция | Описание |
|---------|---------|
| `spawnRun(workId, prompt)` | Создаёт `RunProcess`, передаёт колбэки, которые дёргают `WorkManager` и шлют IPC-события в renderer |
| `cancelRun(workId)` | Отменяет Run и удаляет из `activeRuns` |
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
| `project:create` | `{ name, path, profile? }` | `projectManager.createProject()` + `claudeConfig.ensure()` |
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
| `work:create` | `{ projectId, description, branchName }` | `createWork()` → `deps.spawnRun(work.id, work.description)` |
| `work:delete` | `{ id }` | `deps.cancelRun(id)` + `deleteWork(id)` |
| `work:complete` | `{ id }` | `completeWork(id)` |
| `work:respond` | `{ id, message }` | `markRunStarted()` + `ensureBranch()` + `deps.spawnRun(id, message)` |
| `work:cancel` | `{ id }` | `deps.cancelRun(id)` + `markRunCompleted(id, 'остановлено пользователем')` |
| `work:restart-run` | `{ id }` | `ensureBranch()` + `deps.spawnRun(id, work.description)` |

#### `handlers/settings.ts` — `registerSettingsHandlers()`

| Канал | Параметры | Логика |
|-------|-----------|--------|
| `settings:get` | — | `load().settings` |
| `settings:update` | `Partial<Settings>` | Partial merge + save |

### 8.3 Preload — `preload/index.ts`

`contextBridge.exposeInMainWorld('electronAPI', { ... })` — проксирует все 17 invoke-команд и 4 подписки на события.

**Команды** (invoke): все методы `project*`, `work*`, `settings*` из таблицы выше.

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
├── index.html       — DOM-структура: sidebar, views, dialog overlay, формы
├── app.js           — Вся логика UI (~540 строк vanilla JS)
├── api/ipc-client.ts — Типизированная обёртка window.electronAPI (TypeScript)
└── styles.css       — Тёмная тема (~150 строк)
```

**Важно:** renderer исключён из компиляции TypeScript. `app.js` — чистый JavaScript, работает с `window.electronAPI` напрямую. `ipc-client.ts` — декларация типов и экспорт `api` для статического анализа, но в рантайме `app.js` вызывает `window.electronAPI` напрямую.

### 9.2 Состояние UI (app.js)

```javascript
state = {
  projects: [],            // Project[]
  works: [],               // Work[]
  selectedProjectId: null,
  selectedWorkId: null,
  activeRuns: {},          // { [workId]: { events: StreamEvent[] } }
  settings: {},            // Settings
  currentView: 'works',    // 'works' | 'project-create' | 'settings'
}
```

### 9.3 Основные функции app.js

| Функция | Описание |
|---------|---------|
| `loadProjects()` | Загружает проекты через `api.projectList()`, рендерит sidebar |
| `loadWorks()` | Загружает Work'и выбранного проекта, рендерит список |
| `loadSettings()` | Загружает настройки, рендерит форму |
| `renderProjectList()` | Отрисовка боковой панели: имя проекта + кнопка удаления |
| `renderWorkList()` | Список Work: описание, ветка, количество Run'ов, дата, статус |
| `renderWorkDetail(work, lastResult)` | Детальный вид: статус, прогресс/ответ/результат в зависимости от статуса |
| `renderStreamEvent(event)` | Отрисовка одного события stream-json: system, assistant (thinking свёрнут), result |
| `renderStatusBadge(status, note)` | Цветной badge: зелёный/оранжевый/серый |
| `showDialog(title, bodyHTML, buttons)` | Модальный диалог |
| `handleError(err, context)` | Классификация ошибок: DirtyRepoError (с Discard), BranchExistsError, GitNotFoundError, generic |
| `bindEvents()` | Подписка на 4 IPC-события от Main |

### 9.4 Представления (Views)

| View | DOM ID | Когда показан |
|------|--------|--------------|
| Works | `#view-works` | Основной экран: список Work + detail |
| Project Create | `#view-project-create` | Форма создания проекта |
| Settings | `#view-settings` | Форма настроек |

---

## 10. Точка входа — `main/index.ts`

```typescript
app.whenReady() → createWindow()
  ├── new BrowserWindow({ preload, contextIsolation: true, nodeIntegration: false })
  ├── mainWindow.loadFile('renderer/index.html')
  ├── registerAllIPC(mainWindow)
  └── recoverStaleWorks()

app.on('before-quit') → shutdownAllRuns()
app.on('window-all-closed') → app.quit()
```

---

## 11. Потоки данных

### 11.1 Создание Work и запуск Run

```
Renderer                          Main                              OS
───────                          ──────                             ────
work:create ──────► handler ──► createWork()
  {projectId,                      │ валидация
   description,                    │ git branch create
   branchName}                     │ Work → store
                                   ▼
                              spawnRun(workId, description)
                                   │
                              buildArgs() → ['--session-id', uuid, '-p', desc, ...]
                                   │
                              new RunProcess(callbacks, workId)
                                   │
                              rp.spawn(projectPath, args, timeout)
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
  {workId, exitCode, reason}
◄── work:updated
  {work}
```

### 11.2 Ответ пользователя (resume)

```
work:respond ────► handler ──► markRunStarted() + ensureBranch()
  {id, message}                  │
                                 ▼
                            spawnRun(workId, message)
                                 │
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
          └── markCompleted(workId, 'приложение закрыто')
```

### 11.4 Recovery

```
app.whenReady()
  │
  └── recoverStaleWorks()
        │
        for each work in store:
          if status === 'IN_PROGRESS' || currentRunPid !== null:
            └── updateWorkDirect(id, w → AWAITING_INPUT + note='восстановлен')
```

---

## 12. Файловая система — артефакты приложения

| Путь | Формат | Владелец | Назначение |
|------|--------|----------|-----------|
| `~/.claude/session-manager.json` | JSON | `store.ts` | Состояние приложения: проекты, Work, настройки |
| `~/.claude/session-manager-logs/app.log` | Text | `logger.ts` | Логи приложения |
| `~/.claude/session-manager-logs/<workId>.log` | Text | `run-process.ts` | stderr + логи конкретного Run |
| `~/.claude/projects/<slug>/<uuid>.jsonl` | JSONL | Claude Code | Сессионные данные (читаются `getLastResult()`) |
| `<project>/.claude/settings.json` | JSON | `claude-config.ts` | Разрешения Claude Code для проекта |
| `<project>/.claude/hooks/classify-bash.sh` | Shell | `claude-config.ts` | Классификатор Bash-команд |

---

## 13. Именованные контракты IPC

### Команды (Renderer → Main, `ipcRenderer.invoke`)

| Канал | Request | Response |
|-------|---------|----------|
| `project:list` | — | `Project[]` |
| `project:get` | `{ id }` | `Project` |
| `project:create` | `{ name, path, profile? }` | `Project` |
| `project:delete` | `{ id }` | `void` |
| `project:check-dirty` | `{ id }` | `{ isDirty, files }` |
| `project:discard` | `{ id }` | `void` |
| `project:check-branch` | `{ id, branchName }` | `{ exists }` |
| `work:list` | `{ projectId? }` | `Work[]` |
| `work:get` | `{ id }` | `{ work, lastResult }` |
| `work:create` | `{ projectId, description, branchName }` | `Work` |
| `work:delete` | `{ id }` | `void` |
| `work:complete` | `{ id }` | `void` |
| `work:respond` | `{ id, message }` | `void` |
| `work:cancel` | `{ id }` | `void` |
| `work:restart-run` | `{ id }` | `void` |
| `settings:get` | — | `Settings` |
| `settings:update` | `Partial<Settings>` | `Settings` |

### События (Main → Renderer, `webContents.send`)

| Канал | Payload | Когда |
|-------|---------|-------|
| `run:started` | `{ workId }` | Run начался |
| `run:event` | `{ workId, event }` | Каждая строка stream-json |
| `run:completed` | `{ workId, exitCode, reason }` | Run завершился |
| `work:updated` | `{ work }` | Изменился Work |

---

## 14. Обработка ошибок — сквозной контракт

Ошибки, выбрасываемые из Main, проходят через `ipcMain.handle` и попадают в Renderer как rejected Promise. Renderer классифицирует:

| Тип ошибки | Код | Диалог | Действия |
|-----------|-----|--------|---------|
| `GitNotFoundError` | `GIT_NOT_FOUND` | "Git is not installed" | OK |
| `DirtyRepoError` | `DIRTY_REPO` | Список файлов | Discard / Cancel |
| `BranchExistsError` | `BRANCH_EXISTS` | "Ветка уже существует" | OK |
| Generic Error | — | `message` или `userMessage` | OK |

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
3. Добавить опцию в `<select id="proj-profile">` в `index.html`

### Изменение модели данных Work
1. Изменить `Work` в `shared/types.ts`
2. Обновить создание Work в `work-manager.ts`
3. При необходимости — `migrate()` в `store.ts` + инкремент `CURRENT_VERSION`

### Добавление нового события stream-json в UI
1. Расширить `renderStreamEvent()` в `app.js` — добавить новый `if (event.type === '...')`
2. При необходимости — новый CSS-класс в `styles.css`
