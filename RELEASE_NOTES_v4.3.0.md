# STEALTHNET 4.3.0 — Release Notes (final)

**Дата:** 2026-05-08
**Тип:** security + features release
**Совместимость:** обратная (миграции БД идемпотентные)

---

## TL;DR

- 🛡️ Антибот-защита регистраций (домены + паттерны + IP rate-limit + страница массовой очистки)
- 🔐 API-ключи: срок действия, IP whitelist (CIDR), audit log
- 🚦 Жёсткие rate-limit на `/auth/login` и `/auth/register` (с **skip для Telegram-бота**)
- 🔒 CORS auto-derive из `publicAppUrl` (вместо `*`)
- 🔒 `/api/health` без версии (fingerprint resistance)
- 📲 **Happ Crypto Link** — опциональное шифрование подписочных ссылок (по умолчанию **выключено**)
- 🛠️ Редактор страницы подписки: корректный merge, «Загрузить JSON с ПК», встроенная инструкция
- 📁 Subpage volume-mount в docker-compose: правки на сервере без пересборки

---

## 🛡️ Антибот-защита регистраций

### Превентивная защита (ВКЛЮЧЕНА по умолчанию)
- **Блок-лист доменов:** ~55 disposable-сервисов (`example.com`, `mailinator`, `tempmail`, `guerrillamail`, `10minutemail`, `yopmail`, `getnada` и др.) + RFC reserved TLDs (`.test`, `.invalid`, `.local`)
- **Regex-паттерны:** `test_<hex>@`, `bot_NNN@`, последовательности цифр
- **IP rate-limit:** 5 регистраций / 60 сек / IP (настраивается)
- **Skip для Telegram-бота:** запросы с валидным `X-Telegram-Bot-Token` проходят без проверки IP rate-limit (бот = доверенный канал, иначе все регистрации через `/start` блокировались бы под одним IP контейнера)
- **Tracking:** `clients.registration_ip / registration_ua / registration_source`
- **HTTP 429 теперь возвращает retry-after:** клиент видит точное число секунд до сброса (`{"retryAfter": 47, "resetAt": "..."}`)

### Очистка уже накопленных ботов
Новая страница **Settings → Антибот** (`/admin/antibot`):
- Пресеты: «Все тестовые домены / Накрутки за час / Шторм с одного IP»
- 9 фильтров (домен, паттерн, IP, период, источник, порог IP, без подключения, без платежей)
- IP-grouping для обнаружения шторма с одного адреса
- Bulk-purge с автоматической защитой платящих и активных в Remna

### Настройки
`Settings → SMTP → 🛡️ Антибот-защита`:
- Master switch
- Лимит регистраций / IP / окно
- Дополнительный список доменов
- Custom regex-паттерны

---

## 🔐 API-ключи: hardening

- **`expires_at`** — срок действия (пресеты: 30 дней / 3 мес / 6 мес / 1 год / без срока)
- **`allowed_ips`** — IP whitelist (CIDR-нотация, до 50 диапазонов)
- **`last_used_ip`** — IP последнего использования
- Новая таблица **`api_key_usage`** — audit log (timestamp, IP, UA, method, path, status)
- Inline-редактирование, журнал использования модалкой
- Цветной индикатор срока: зелёный → жёлтый (< 7 дн) → красный (истёк)

### Endpoints
- `PATCH /api/admin/api-keys/:id` — редактирование
- `GET /api/admin/api-keys/:id/usage?limit=N` — журнал

---

## 🚦 Rate-limit hardening

| Эндпоинт | Было | Стало |
|---|---|---|
| `POST /api/auth/login` + `/2fa-login` | 2000/15мин | **20/15мин** + `skipSuccessfulRequests` |
| `POST /api/client/auth/register` | 500/час | **5/60сек**, skip для X-Telegram-Bot-Token |
| `POST /api/client/auth/login` + `/2fa-login` | (общий 600/15мин) | **20/15мин** + `skipSuccessfulRequests` |

`skipSuccessfulRequests`: верный пароль квоту не съедает.

**Бот шлёт `X-Telegram-Bot-Token` во всех запросах** (`bot/src/api.ts` getHeaders) — без этого все регистрации через `/start` ушли бы под IP бот-контейнера и блокировались.

---

## 🔒 CORS + version hide

### CORS
Было: `Access-Control-Allow-Origin: *` по умолчанию.

Стало:
1. Если `CORS_ORIGIN` задан в `.env` (не `*`) — whitelist (комма-разделённый)
2. Иначе — auto-derive из `system_settings.public_app_url` (кэш 60 сек)
3. Только если ни env, ни settings — fallback на `*` (для свежих установок)

### Health
- `GET /api/health` теперь только `{"status":"ok"}` (без версии)
- `GET /api/admin/version` — для мониторинга, **под JWT**

---

## 📲 Happ Crypto Link

Опциональное шифрование подписочных ссылок в формат `happ://crypt4/...` через встроенный API Remnawave.

**По умолчанию: ВЫКЛЮЧЕНО.**
Включается в `Settings → SMTP → 🔗 Happ Crypto Link`.

### Зачем выключено по умолчанию
- Crypt4-ссылка очень длинная (~1500 символов)
- В Telegram-сообщении выглядит как простыня

### Как работает
- Применяется в трёх endpoint'ах: `GET /api/client/subscription`, `/by-uuid/:uuid`, `/all`
- 10-мин кэш в памяти бэкенда (Remna-шифрование детерминировано)
- Если Remna API упал — возвращается обычная ссылка
- Кэш админских настроек: 60 сек, после изменения подождать минуту

---

## 🛠️ Редактор страницы подписки

### Bug fixes
1. Раньше при наличии записей в БД дефолт игнорировался → новые приложения никогда не появлялись
2. `mergeWithDefault` терял кастомные приложения которых нет в дефолте
3. Save в админке не отправлял `happCryptEnabled` и антибот-настройки на бэк (поля просто отсутствовали в payload)

### Новое
1. **Volume-mount** файла в `docker-compose.yml` — изменения подхватываются мгновенно
2. **Двойной COPY в Dockerfile** — `/app/defaults/` как fallback
3. **Корректный merge** — порядок и enabled-статусы сохраняются, новые добавляются в конец, кастомные не теряются
4. **30-сек кэш** + `?fresh=1` для сброса
5. **Плашка** «Найдено N новых приложений в файле»
6. **Кнопка «Загрузить JSON с ПК»** — обходит Docker-проблему
7. **Раскрывающаяся инструкция** «Как добавить новое приложение»

### Workflow
1. На сервере: `nano /opt/.../backend/subpage-...json` → save
2. В админке: Settings → Страница подписки → «Перезагрузить с сервера»
3. Появится плашка «Найдено N новых» → «Подмёрж новые»
4. (опц.) перетащить мышью → «Сохранить»

**Никакой пересборки контейнеров.**

---

## 📦 Миграции БД

Применяются автоматически при старте контейнера. Идемпотентные (`IF NOT EXISTS`).

### `20260507120000_api_key_hardening`
- `api_keys.expires_at`, `last_used_ip`, `allowed_ips`
- Новая таблица `api_key_usage` с FK CASCADE и индексами

### `20260507130000_anti_bot_protection`
- `clients.registration_ip`, `registration_ua`, `registration_source`
- Индексы

---

## 🚀 Установка обновления

### Стандартный путь (с 4.2.x)

```bash
cd /opt/remnawave-STEALTHNET-Bot

# 1. Бэкап БД (НЕ ПРОПУСКАЙТЕ!)
mkdir -p ~/backups
docker exec stealthnet-postgres pg_dump -U stealthnet stealthnet \
  | gzip > ~/backups/stealthnet_pre_v430_$(date +%Y%m%d_%H%M%S).sql.gz
cp .env ~/backups/.env.preserved   # сохранить .env на случай перезатирания

# 2. Распаковать ZIP в корень репо
unzip -o /path/to/stealthnet_v430_full.zip

# 3. Пересобрать и перезапустить
docker compose build api frontend bot
docker compose up -d frontend
docker compose up -d api bot
```

### Если RAM < 1.5GB и билд падает по OOM

В `frontend/Dockerfile` и `backend/Dockerfile` поменять строку:
```dockerfile
RUN npm run build
```
на:
```dockerfile
RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build
```
(использует swap; на 1ГБ RAM с 2ГБ свопа собирается без проблем)

### Если `_prisma_migrations` отсутствует / прыжок с 3.x

Это ручной baseline. Свяжись с автором — нужно эвристически отметить уже применённые миграции (по наличию таблиц/колонок) и через `prisma migrate deploy` накатить недостающие. Прямой `migrate deploy` упадёт.

### Проверки после деплоя

```bash
# API стартанул на 4.3.0
docker compose logs api --since=2m | grep "API v"
# → API v4.3.0 listening on port 5000

# Health без версии
curl -s https://your-domain/api/health
# → {"status":"ok"}

# Миграции применились
docker exec stealthnet-postgres psql -U stealthnet -d stealthnet -t -c \
  "SELECT migration_name FROM _prisma_migrations \
   WHERE migration_name IN ('20260507120000_api_key_hardening', '20260507130000_anti_bot_protection') \
   ORDER BY migration_name;"

# Бот шлёт X-Telegram-Bot-Token (тестово)
docker exec stealthnet-bot grep "X-Telegram-Bot-Token" /app/dist/api.js | head -2
```

### После деплоя в админке

1. **Браузер:** `Ctrl+Shift+R` (`Cmd+Shift+R` на Mac) для сброса Service Worker
2. **Settings → Антибот:** пресет «Все тестовые домены» → «Найти» → «Удалить» — почистить уже накопленных ботов
3. **Settings → SMTP → 🛡️ Антибот-защита:** проверь master switch и лимит IP/окно
4. **Settings → SMTP → 🔗 Happ Crypto Link:** оставь выключенным (по умолчанию), либо включи если нужно скрыть URL подписки
5. **Settings → Страница подписки:** проверь что новые приложения видны

---

## ⚠️ Breaking changes

**Нет.** Все изменения обратно-совместимые:
- API-ключи без `expires_at` продолжают работать (бессрочные)
- API-ключи без `allowed_ips` продолжают работать (без IP-фильтра)
- CORS auto-derive имеет fallback на `*` для свежих установок
- Antibot защиту можно выключить (`signupProtectionEnabled: false`)
- Happ Crypto **выключен** по умолчанию (включай в админке)

---

## 📋 Состав архива

Полный snapshot проекта v4.3.0 (424 файла):

- `backend/` — Express API (все модули + миграции + Dockerfile + docker-entrypoint.sh)
- `frontend/` — React SPA (все pages + components + Dockerfile)
- `bot/` — Telegram Grammy bot (с фиксом `X-Telegram-Bot-Token` во всех запросах)
- `nginx/` — конфиг nginx
- `proxy-node/`, `singbox-node/` — VPN-ноды
- `proxysteal-extension/` — Chrome MV3
- `scripts/`, `docs/`
- `docker-compose.yml` (с volume-mount для subpage-default.json)
- `install.sh`
- `LICENSE`, `README.md`

---

## 🐛 Известные нюансы

- **Telegram client throttling** — при спаме `/start` с одного устройства Telegram-клиент сам перестаёт отправлять дубликаты (статус ⊘). Это поведение Telegram, не бэкенда. С другого устройства проходит.
- **JWT_SECRET ротация** — если `.env` пересоздан с новым секретом, все админ-сессии протухнут (re-login).
- **На свежих установках** оба билда могут упасть по OOM на серверах с ≤1GB RAM — добавить `NODE_OPTIONS=--max-old-space-size=2048` в Dockerfile (см. выше).
