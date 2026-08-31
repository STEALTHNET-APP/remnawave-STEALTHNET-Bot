# Вход и регистрация через Apple и Google

Краткий план, что нужно для добавления «Войти через Apple» и «Войти через Google» в кабинет клиента.

---

## 1. Что нужно получить (учётки и ключи)

### Google

1. Зайти в [Google Cloud Console](https://console.cloud.google.com/).
2. Создать проект (или выбрать существующий).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Тип приложения: **Web application**.
5. Указать **Authorized JavaScript origins**, например:
   - `https://yourdomain.com`
   - `http://localhost:5173` (для разработки)
6. Указать **Authorized redirect URIs** — **точно** те же URL, что использует приложение (без завершающего слэша):
   - Для продакшена: в админке **Настройки** задайте **URL приложения** (например `https://yourdomain.com`). Тогда добавьте в Google:
     - `https://yourdomain.com/cabinet/login`
     - `https://yourdomain.com/cabinet/register`
   - Для разработки: `http://localhost:5173/cabinet/login` и `http://localhost:5173/cabinet/register`
   - Если **URL приложения** в админке не задан, приложение отправляет в Google `window.location.origin` (тот адрес, с которого пользователь открыл страницу). Добавьте в Google эти два URI с вашим реальным доменом/портом.
7. Сохранить **Client ID** и **Client Secret** — они понадобятся в бэкенде; в настройках админки укажите их и включите «Вход через Google».

**Важно:** при ошибке `redirect_uri_mismatch` проверьте, что в Google Console добавлены **буквально те же** URI (протокол, домен, путь без слэша в конце). URL приложения в админке должен совпадать с доменом, под которым пользователи открывают кабинет.

### Apple

1. [Apple Developer](https://developer.apple.com/) — аккаунт разработчика (платный).
2. **Certificates, Identifiers & Profiles → Identifiers**:
   - Создать **App ID** с включённой возможностью **Sign in with Apple**.
   - Создать **Services ID** (для веб): указать домен и Return URL (например `https://yourdomain.com/api/client/auth/apple/callback`).
3. **Keys** — создать ключ с **Sign in with Apple**, привязать к App ID. Скачать `.p8` (один раз), записать **Key ID**.
4. Записать **Team ID**, **Services ID** (Bundle ID для веба), **Client ID** (обычно тот же Services ID), **Key ID**, содержимое `.p8`, **App Bundle ID** (для конфига Apple).

Без этого шага дальше двигаться нельзя: бэкенд будет проверять токены от Google и Apple по их правилам.

---

## 2. База данных (Prisma)

В модели `Client` добавить поля для привязки аккаунта к OAuth:

```prisma
model Client {
  // ... существующие поля ...
  googleId   String?  @unique @map("google_id")   // Google sub (уникальный id пользователя)
  appleId    String?  @unique @map("apple_id")   // Apple sub
  // ...
}
```

После правок:

```bash
cd backend && npx prisma migrate dev --name add_oauth_google_apple
```

---

## 3. Бэкенд (Node.js)

### 3.1 Переменные окружения

В `.env` (или в админке как system_settings, если храните там секреты):

- **Google:**  
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Apple:**  
  `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (содержимое .p8, можно в одну строку с `\n`)

Имеет смысл добавить флаги включения: `GOOGLE_LOGIN_ENABLED`, `APPLE_LOGIN_ENABLED` (или аналоги в настройках).

### 3.2 Маршруты

- **Google**
  - `GET /api/client/auth/google` — редирект на Google OAuth (или отдача `url` для фронта).
  - `GET /api/client/auth/google/callback` — приём `code`, обмен на токены, запрос профиля (email, sub), поиск/создание `Client` по `googleId`, выдача своей JWT (как сейчас делается `signClientToken` + `toClientShape`).

- **Apple**
  - `POST /api/client/auth/apple` (или GET с редиректом) — приём `id_token` или `code` от фронта.
  - Проверка JWT Apple (через JWKS Apple), из payload взять `sub` (уникальный id) и при желании `email`. Найти или создать `Client` по `appleId`, выдать свою JWT.

Логика «найти или создать» — как у Telegram: если пользователь с таким `googleId`/`appleId` есть — логин; если нет — регистрация (создать запись, привязать реферала по cookie/query, если нужно).

### 3.3 Зависимости

- Google: запросы на `https://oauth2.googleapis.com/token` и `https://www.googleapis.com/oauth2/v2/userinfo` (или userinfo v3) — достаточно `fetch` или `axios`.
- Apple: проверка JWT (например, библиотека `jose` или `jsonwebtoken` + загрузка JWKS с `https://appleid.apple.com/auth/keys`).

Пароль при OAuth-регистрации не задаётся (`passwordHash` остаётся `null`).

---

## 4. Фронтенд

### 4.1 Страницы входа/регистрации

- На `/cabinet/login` (и при необходимости на `/cabinet/register`) добавить кнопки:
  - **Войти через Google**
  - **Войти через Apple**

### 4.2 Варианты реализации

**Вариант A — редирект (проще):**

- Кнопка «Google» ведёт на `GET /api/client/auth/google` (бэкенд делает redirect на Google).
- После входа Google редиректит на `GET /api/client/auth/google/callback?code=...`.
- Бэкенд обменивает `code` на токены, создаёт/находит клиента, редиректит на `/cabinet/dashboard` с выданным токеном (например, в query или в cookie; если в query — фронт один раз читает токен и сохраняет в память/localStorage, как сейчас).

**Вариант B — popup / без полного редиректа:**

- Фронт открывает окно с URL бэкенда (или напрямую с Google/Apple).
- После входа бэкенд отдаёт страницу, которая через `postMessage` отправляет токен в окно-родитель и закрывается.
- Родитель сохраняет токен и обновляет состояние авторизации (как при логине по email).

**Apple на фронте:**

- Можно использовать [Sign in with Apple JS](https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js) — кнопка и получение `id_token` или `authorization.code`, затем отправка на бэкенд `POST /api/client/auth/apple` с этим значением. Тогда редирект на бэкенд не обязателен для Apple.

### 4.3 Публичный конфиг

В `getPublicConfig()` (или аналог) добавить флаги, например:

- `googleLoginEnabled: boolean`
- `appleLoginEnabled: boolean`

И при необходимости `googleClientId` (если кнопка Google рендерится через Google Identity Services на фронте). Тогда на странице входа показывать кнопки только если соответствующий способ включён.

---

## 5. Безопасность и ограничения

- **HTTPS:** для продакшена обязателен; Apple для веба обычно требует HTTPS.
- **Redirect URI** у Google и Apple должны точно совпадать с теми, что указаны в консолях (включая слэш и путь).
- Токены от Google/Apple проверять только на бэкенде; не доверять присланному с фронта «профилю» без проверки id_token/code.
- У Apple email может приходить один раз при первой авторизации; при необходимости сохранять его в `Client.email` при первом входе.

---

## 6. Порядок внедрения

1. Получить Client ID и Client Secret (Google) и настроить Services ID + ключ (Apple).
2. Добавить поля `googleId` и `appleId` в Prisma, выполнить миграцию.
3. Реализовать на бэкенде:
   - `GET /api/client/auth/google` и `GET /api/client/auth/google/callback`;
   - `POST /api/client/auth/apple` (приём и проверка id_token/code, поиск/создание Client по `appleId`).
4. Добавить переменные окружения и флаги включения (в настройках или .env).
5. На фронте: кнопки «Войти через Google» и «Войти через Apple», вызов нужных URL или отправка токена на бэкенд; сохранение выданного токена и редирект в кабинет.
6. В админке (по желанию): включение/выключение способов входа и указание redirect URI для справки.

После этого регистрация и вход через Apple и Google будут работать в том же потоке, что и текущий вход по email/Telegram: один и тот же JWT и объект `client` в ответе.
