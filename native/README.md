# Бэкап Projects в git

`Ctrl+E` в панели Projects (`tp` или `Alt+P`) перезаписывает `projects.json` в репозитории бэкапа, делает коммит и пуш, а результат показывает тостом.

## Установка

1. Создай репозиторий для бэкапа (по умолчанию `~/Documents/vimium-tabs`):
   ```bash
   mkdir ~/Documents/vimium-tabs && cd ~/Documents/vimium-tabs
   git init && git switch -c main
   touch README.md && git add README.md && git commit -m "first commit"
   git remote add origin <url>
   git push -u origin main
   ```
2. Зарегистрируй скрипт в Chrome, Chromium и Brave:
   ```bash
   native/install.sh              # бэкап в ~/Documents/vimium-tabs
   native/install.sh ~/other/dir  # или в свою папку
   ```
3. Загрузи `dist/` в `chrome://extensions` через «Load unpacked». ID должен быть `ecpabanjdgnmfemepdgoimbhlbdmmhnh`: он задаётся полем `key` в `manifest.json`, не меняй его.

Если папка расширения переехала, запусти `install.sh` ещё раз: в регистрации записан абсолютный путь к скрипту.

## Как работает

```
Ctrl+E → background.ts → chrome.runtime.sendNativeMessage("com.bs.vimium_projects")
       → Chrome запускает projects_backup.py (JSON приходит через stdin)
       → запись projects.json → git commit (если есть изменения) → git push
       → ответ { ok, changed, pushed, pushError } → тост
```

- Скрипт запускается на одно сообщение и сразу завершается, в фоне ничего не висит.
- Пуш выполняется даже без изменений, так что коммиты, не ушедшие в прошлый раз, догоняются.
- Скрипт пишет только `projects.json` в одну папку. Запускать его может только это расширение (`allowed_origins`).
- Если скрипт не установлен, `Ctrl+E` просто скачивает JSON.

## Файлы

| Файл | Что это |
|------|---------|
| `projects_backup.py` | сам скрипт: запись, коммит, пуш |
| `install.sh` | создаёт `com.bs.vimium_projects.json` в `~/.config/<браузер>/NativeMessagingHosts/` |
| `projects_backup.local.sh` | обёртка со своей папкой, создаётся через `install.sh <dir>` (в .gitignore) |

Лог: `~/.cache/vimium-projects-backup.log`

## Если пуш не проходит

Chrome запускает скрипт со своим окружением и может не видеть ssh-agent. Если ключ под паролем, пуш упадёт; ошибка будет в тосте и в логе. Коммит при этом сохранится локально и уйдёт со следующим `Ctrl+E`.

## Удаление

```bash
rm ~/.config/{google-chrome,chromium,BraveSoftware/Brave-Browser}/NativeMessagingHosts/com.bs.vimium_projects.json
```

## Где что лежит

| Что | Где |
|-----|-----|
| Скрипт бэкапа | `native/projects_backup.py` в папке расширения |
| Файл бэкапа | `~/Documents/vimium-tabs/projects.json` |
| Репозиторий бэкапа | `ssh://git@git.umervtilte.lol:2222/g.artiom/vimium-tabs.git` |
| Регистрация в браузере | `~/.config/google-chrome/NativeMessagingHosts/com.bs.vimium_projects.json` (то же для `chromium` и `BraveSoftware/Brave-Browser`) |
| Лог | `~/.cache/vimium-projects-backup.log` |
| ID расширения | `ecpabanjdgnmfemepdgoimbhlbdmmhnh` (`chrome://extensions`) |
| Проекты внутри браузера | `chrome.storage.local`, ключ `bs-projects` |
| Код в расширении | `src/projects.ts` (Ctrl+E → `backupProjects`), `src/background.ts` (`sendNativeMessage`) |
