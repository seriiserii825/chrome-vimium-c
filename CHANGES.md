# Projects panel: изменения (3 коммита)

## 1. `d5ca44a` — feat: projects map keys

Добавлен справочный файл `projects-map.csv` со списком всех хоткеев панели
Projects (Escape, ArrowUp/Down, Enter, Tab, F2, Delete, Ctrl+S/U/A/E/O/I и т.д.) —
тот же формат колонок, что у основного `maps.csv` (`hotkey,action,description,group`).

Файл подключён в `content.ts` и подмешивается в список `maps.csv` только при
открытии окна справки (`?`) — хоткеи панели Projects теперь видны там отдельной
группой `projects`.

**Важно:** это чисто справочный список для help-окна. Сама обработка клавиш
внутри панели Projects как и раньше захардкожена в `onKeydown` (`src/projects.ts`).
`projects-map.csv` не участвует в реальном резолвинге чордов — формат хоткеев там
другой (`ArrowDown`, `^u` и т.п.), не совместимый с резолвером `maps.csv`.

Файлы: `projects-map.csv` (новый), `src/content.ts`.

---

## 2. `cf80587` — feat: commit message project name

Раньше `Ctrl+E` (бэкап проектов в git) всегда коммитил с одинаковым сообщением
`backup: N projects`. Теперь commit message — это название последнего
изменённого проекта.

**Механизм:** добавлен persisted-флаг `dirtyMessage`, хранится в
`chrome.storage.local` под ключом `bs-projects-dirty` (а не просто в переменной
модуля — потому что `projects` и так перезагружается из storage на каждое
открытие панели, панель может открываться из разных вкладок/popup).

Флаг выставляется при каждом значимом изменении (`src/projects.ts`):
- `save: <title>` — создание нового проекта (Ctrl+S)
- `rename: <title>` — переименование (F2)
- `update: <title>` — замена вкладок (Ctrl+U), добавление текущей вкладки (Ctrl+A),
  удаление вкладки из проекта
- `delete: <title>` — удаление всего проекта
- `import: N projects` — импорт (Ctrl+O / Ctrl+I)

При `Ctrl+E`: сообщение из `dirtyMessage` летит через
`chrome.runtime.sendMessage({ type: 'backupProjects', message })` →
`background.ts` пробрасывает его в `sendNativeMessage` → native host
(`native/projects_backup.py`) использует как `git commit -m <message>`.
Если поле не передано (старый клиент) — фоллбэк на старое
`backup: N projects`.

После успешного коммита (или скачивания JSON, если host не установлен)
флаг очищается (`clearDirty()`).

Файлы: `native/projects_backup.py`, `src/background.ts`, `src/projects.ts`.

---

## 3. `8bfdb5f` — feat: check for pull and show message if is not dirty

Два отдельных улучшения, завязанных на ту же идею "не делать лишнюю работу,
если нечего делать":

**a) `Ctrl+E` без изменений.** Если `dirtyMessage` пуст (ничего не менялось
с последнего бэкапа) — просто тост **"Nothing to export"**, без диалога
подтверждения и без обращения к native host.

**b) `Ctrl+I` (restore) без изменений.** Раньше `Ctrl+I` всегда делал
`git pull` и показывал диалог импорта, даже если в бэкапе ничего нового. Теперь:
- `background.ts` перед вызовом native host читает текущие `bs-projects` и
  передаёт их в запрос: `{ action: "restore", projects: [...] }`.
- `native/projects_backup.py`: после `git pull` сравнивает содержимое
  `projects.json` с переданными `local_projects`. Если совпадают —
  возвращает `{ ok: true, upToDate: true }` без самого массива проектов.
- `src/projects.ts`: при `res.upToDate` показывает тост
  **"Already up to date"** вместо диалога импорта.

Файлы: `native/projects_backup.py`, `src/background.ts`, `src/projects.ts`.

---

## Проверка

- `bun run build` (tsc + eslint + vite) проходит на всех трёх коммитах.
- `native/projects_backup.py` прогнан вручную через протокол native messaging
  (stdin/stdout framing) с тестовыми временными git-репозиториями — проверены:
  commit message с переданным и без переданного `message`, а также оба случая
  `restore` (locals совпадают / отличаются от backup).

## Что нужно напарнику знать для тестирования руками

1. Перезагрузить расширение после `bun run build` (`chrome://extensions`).
2. Открыть панель Projects, нажать `?` — проверить, что в help-окне появилась
   группа `projects` с хоткеями.
3. Что-то изменить в проекте (например, переименовать), нажать `Ctrl+E` —
   в бэкап-репозитории (`~/Documents/vimium-tabs` или свой `VIMIUM_PROJECTS_DIR`)
   коммит должен называться `rename: <имя>` (или `save:`/`update:`/`delete:`
   в зависимости от действия).
4. Нажать `Ctrl+E` ещё раз без изменений — должен показаться тост
   "Nothing to export", без диалога.
5. Нажать `Ctrl+I`, когда локальный backup идентичен текущим проектам —
   должен показаться тост "Already up to date" без диалога импорта.
