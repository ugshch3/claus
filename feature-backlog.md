# Feature Backlog — Session Manager

## MVP Gap (требования задекларированы, но не реализованы)

### F1.2 — Создание проекта из remote URL (git clone)
- **Приоритет:** High
- **Требование:** F1.2
- **Что нужно:** В форме создания проекта добавить опцию «Remote URL». При создании выполнять `git clone <url>` в указанную директорию. Обрабатывать ошибки клонирования (нет доступа, репозиторий не существует).
- **Затронутые файлы:** `src/main/project/project-manager.ts`, `src/main/ipc/handlers/project.ts`, `src/renderer/index.html`, `src/renderer/app.js`

### F1.3 — Создание проекта как пустого репозитория (git init)
- **Приоритет:** High
- **Требование:** F1.3
- **Что нужно:** Если переданный `path` не существует или не является git-репозиторием — создавать директорию и выполнять `git init`. Добавить чекбокс «Init as new repository» в форму создания.
- **Затронутые файлы:** `src/main/project/project-manager.ts`, `src/main/git/git-service.ts` (добавить `initRepo()`), `src/renderer/index.html`, `src/renderer/app.js`

### F3.3 — Полная история диалога Work
- **Приоритет:** Medium
- **Требование:** F3.3
- **Что нужно:** UI для просмотра всей цепочки сообщений user/assistant из JSONL-файла сессии. Сейчас `WorkManager.getLastResult()` читает JSONL, нужно расширить до чтения всей истории и отобразить в хронологическом порядке.
- **Затронутые файлы:** `src/main/work/work-manager.ts` (добавить `getFullHistory()`), `src/main/ipc/handlers/work.ts` (новый канал `work:history`), `src/renderer/app.js`

### F6.4 — Редактирование Bash allow/deny списков через UI
- **Приоритет:** Medium
- **Требование:** F6.4
- **Что нужно:** Секция в Settings (или отдельный view) для редактирования белых/чёрных списков Bash-команд. Должно обновлять `classify-bash.sh` и/или `settings.json`.
- **Затронутые файлы:** `src/main/claude/claude-config.ts`, `src/main/ipc/handlers/settings.ts`, `src/renderer/index.html`, `src/renderer/app.js`

### F6.6 — Предупреждение о конфликтах allow/ask
- **Приоритет:** Low
- **Требование:** F6.6
- **Что нужно:** При сохранении профиля проверять, что инструмент не попал одновременно в `allow` и `ask` (allow всегда побеждает — это документированная ловушка Claude Code). Показывать предупреждение.
- **Затронутые файлы:** `src/main/claude/claude-config.ts`, `src/renderer/app.js`

---

## Implementation Plan Gap

### Task 6.10 — Подтверждение выхода при активных Run'ах
- **Приоритет:** Medium
- **План:** Task 6.10
- **Что нужно:** Подписка на `beforeunload` в renderer. Если `activeRuns` не пуст — показать диалог «Есть активные Run'ы. Закрыть приложение?». Без этого пользователь может случайно закрыть окно и потерять прогресс.
- **Затронутые файлы:** `src/renderer/app.js`

---

## Bugs

### B1 — Проблема с правами на редактирование
- **Приоритет:** High
- **Симптом:** Claude Code не может редактировать файлы — возможно, проблема с конфигурацией permissions в `settings.json` или `classify-bash.sh`, либо с авто-разрешением Edit/Write.
- **Что нужно:** Проверить, какие именно права блокируются. Проверить `claude-config.ts` — корректно ли генерируется `settings.json` (allow: Read, Glob, Grep, Edit, Write). Проверить, не перезаписываются ли права где-то ещё. Проверить `classify-bash.sh` — не блокирует ли хук лишнего.
- **Затронутые файлы:** `src/main/claude/claude-config.ts`, `src/main/ipc/handlers/project.ts`

### B2 — Work в статусе AWAITING_INPUT (stopped) показывает "(no output)"
- **Приоритет:** Medium
- **Симптом:** Проект `/Users/k.chernyadiev/PycharmProjects/GOL`, Work в статусе `AWAITING_INPUT` (stopped), но результат отображается как "(no output)".
- **Что нужно:** Выяснить, почему `getLastResult()` не находит текст результата:
  - Проверить, существует ли JSONL-файл сессии в `~/.claude/projects/<slug>/`
  - Проверить логику `WorkManager.getLastResult()` — корректно ли читает JSONL и ищет последний `result`/`assistant` event
  - Проверить формат событий в JSONL — возможно, при остановке (SIGTERM) не пишется финальное событие
  - Проверить логику восстановления после перезапуска в `register.ts` — корректно ли восстанавливается `AWAITING_INPUT` с пометкой `stopped`
- **Затронутые файлы:** `src/main/work/work-manager.ts`, `src/main/run/run-process.ts`, `src/main/ipc/register.ts`, `src/main/ipc/handlers/work.ts`

---

## Research Debt

### Q7 — Формат событий при превышении `--max-budget-usd`
- **Приоритет:** Low
- **Что нужно:** Эксперимент: `claude -p "сложная задача" --max-budget-usd 0.01 --output-format stream-json --verbose`. Зафиксировать stream-json события и exit code. Обновить `run-process.ts` с правильной классификацией.

### Q8 — Формат событий при превышении `--max-turns`
- **Приоритет:** Low
- **Что нужно:** Эксперимент: `claude -p "сложная задача" --max-turns 3 --output-format stream-json --verbose`. Зафиксировать stream-json события и exit code. Обновить `run-process.ts`.

### Q9 — Формат ошибок API в stream-json
- **Приоритет:** Low
- **Что нужно:** Эксперимент с заведомо проблемным запросом (auth, rate limit, network). Зафиксировать формат ошибок в stream-json. Добавить обработку в `renderStreamEvent()`.

---

## Post-MVP (следующие версии)

| # | Фича | Описание |
|---|------|---------|
| P1 | Android-приложение | Удалённое управление сессиями с телефона |
| P2 | Интеграция с Jira | Создание Work по ссылке на задачу |
| P3 | Push-уведомления | Уведомление при переходе в AWAITING_INPUT |
| P4 | Параллельные Work | Несколько Work в одном проекте, каждый на своей ветке |
| P5 | Авто-MR | Автоматическое создание Merge Request по завершении Work |
| P6 | Базовая ветка | Настройка базовой ветки на проект (develop/main/master) |
| P7 | Autogenerate ветки | Генерация имени ветки из описания задачи через Claude |
| — | Авто-обнаружение проектов | Сканирование `~/.claude/projects/` и предложение добавить найденные |
| — | Кастомизация classify-bash.sh через UI | Полноценный редактор профилей разрешений |
| — | `--permission-mode` аргумент | Поддержка разных режимов разрешений (default/acceptEdits/plan и т.д.) |
| — | Автоматические тесты | Unit и integration тесты для main-процесса |
| — | Package/distribution | Сборка `.dmg`/`.AppImage` через electron-builder |
