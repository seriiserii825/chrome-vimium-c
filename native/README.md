# Бэкап Projects в git

`Ctrl+E` в панели Projects (`tp` или `Alt+P`) делает `git pull`, после подтверждения перезаписывает `projects.json` в репозитории бэкапа, коммитит и пушит, а результат показывает тостом.

Если с другого компьютера в git уже запушили изменения, вместо `y`/`n` будет выбор:
- `m` — merge: подтянуть их проекты (новые добавляются; если проект менялся на обоих компьютерах, побеждает более свежий `updated_at`), потом сделать бэкап;
- `o` — overwrite: запушить только версию этого компьютера, а прежняя останется в истории git;
- `n` — отмена.

Удаления при merge не переносятся: проект, удалённый здесь, но ещё лежащий в git, вернётся. Для этого случая есть `o`.

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
   native/install.sh              # бэкап в ~/Documents/vimium-tabs (или оставляет уже заданную папку)
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
- Пуш выполняется даже без изменений, так что коммиты, не ушедшие в прошлый раз, догоняются: если пуш упал, просто снова нажми `Ctrl+E`.
- Чтобы понять, что изменения пришли с другого компьютера, расширение запоминает коммит последнего бэкапа или импорта с этого компьютера (`bs-projects-synced`).
- Скрипт пишет только `projects.json` в одну папку. Запускать его может только это расширение (`allowed_origins`).
- Если скрипт не установлен, `Ctrl+E` просто скачивает JSON.
- `Ctrl+Shift+E` всегда просто скачивает JSON (обычный экспорт, без git).
- `Ctrl+I` импортирует из бэкапа: скрипт делает `git pull` (подтягивает бэкап с другого компьютера), читает `projects.json`, и после подтверждения проекты сливаются так же, как при `m`: новые добавляются, для общих побеждает более свежий `updated_at`, так что несохранённые в бэкап правки не затрутся. Работает и в попапе `Alt+P`.

## Файлы

| Файл | Что это |
|------|---------|
| `projects_backup.py` | сам скрипт: запись, коммит, пуш |
| `timecodes_backup.py` | бэкап таймкодов YouTube (см. ниже) |
| `install.sh` | создаёт `com.bs.vimium_projects.json` и `com.bs.vimium_timecodes.json` в `~/.config/<браузер>/NativeMessagingHosts/` |
| `projects_backup.local.sh` | обёртка со своей папкой, создаётся через `install.sh <dir>` (в .gitignore) |

Лог: `~/.cache/vimium-projects-backup.log`

## Если пуш не проходит

Chrome запускает скрипт со своим окружением и может не видеть ssh-agent. Если ключ под паролем, пуш упадёт; ошибка будет в тосте и в логе. Коммит при этом сохранится локально и уйдёт со следующим `Ctrl+E`.

## Таймкоды YouTube

`ve` на странице видео: `git pull` в `~/Documents/youtube-timecodes`, запись таймкодов этого видео в `<название-видео>.json` (кириллица → латиница по таблице `cyr-to-lat` из go-scripts, например `Мое видео` → `moe-video`), коммит только этого файла и пуш. Файл видео ищется по `videoId`, так что после переименования видео пишется в тот же файл.

Если файл этого видео в git менялся с другого компьютера после последней синхронизации (`bs-timecodes-synced` в localStorage youtube.com) — выбор `m` merge / `o` overwrite / `n` отмена, как у Projects.

`vi`: `git pull` и импорт таймкодов из всех `*.json` папки (включая старые экспорты-массивы). Добавляются только отсутствующие, у совпадающих остаётся локальное имя; удаления не переносятся.

Папка по умолчанию `~/Documents/youtube-timecodes`, своя: `VIMIUM_TIMECODES_DIR=<dir> native/install.sh`. Лог: `~/.cache/vimium-timecodes-backup.log`.

## Удаление

```bash
rm ~/.config/{google-chrome,chromium,BraveSoftware/Brave-Browser}/NativeMessagingHosts/com.bs.vimium_{projects,timecodes}.json
```
