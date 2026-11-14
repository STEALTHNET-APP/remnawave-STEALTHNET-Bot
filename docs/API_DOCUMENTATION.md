# STEALTHNET External API v1

## Обзор

External API v1 позволяет интегрировать панель STEALTHNET в мобильные приложения и сторонние сервисы.
Через API можно: авторизовать клиентов, получать профиль и баланс, просматривать подписку, платежи, тарифы, устройства, рефералы и т.д.

**Базовый URL:**
```
https://ваш-домен.ru/api/v1
```

---

## Аутентификация

### API ключ (обязателен для всех запросов)

Создайте ключ в админке: **Настройки → API Ключи → Создать ключ**.

Передавайте ключ одним из двух способов:

```
X-Api-Key: sk_ваш_ключ
```

или

```
Authorization: Bearer sk_ваш_ключ
```

### Клиентский токен (для защищённых эндпоинтов)

После логина клиент получает JWT токен (поле `token` в ответе). Для эндпоинтов, помеченных как **🔒 API Key + Client Token**, передавайте оба заголовка:

```
X-Api-Key: sk_ваш_api_ключ
Authorization: Bearer jwt_токен_клиента
```

> Токен клиента действителен 7 дней.

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 400 | Ошибка валидации (неверный формат данных) |
| 401 | Не авторизован (нет ключа или невалидный токен) |
| 403 | Доступ запрещён (ключ отключён или аккаунт заблокирован) |
| 404 | Не найдено |
| 409 | Конфликт (email уже зарегистрирован) |
| 502 | Ошибка внешнего сервиса (Remna API) |
| 503 | Сервис не настроен |

Все ошибки возвращают JSON:
```json
{
  "error": "Описание ошибки"
}
```

---

## 1. Аутентификация

### POST /api/v1/auth/login

Вход по email и паролю.

**Авторизация:** 🔑 API Key

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "mypassword"
}
```

**Ответ (успех):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "client": {
    "id": "clxyz...",
    "email": "user@example.com",
    "telegramId": null,
    "telegramUsername": null,
    "preferredLang": "ru",
    "preferredCurrency": "RUB",
    "balance": 250.00,
    "referralCode": "REF-A1B2C3D4",
    "referralPercent": 10,
    "remnawaveUuid": "uuid-...",
    "trialUsed": false,
    "isBlocked": false,
    "totpEnabled": false,
    "createdAt": "2025-01-15T10:30:00.000Z",
    "autoRenewEnabled": false,
    "autoRenewTariffId": null
  }
}
```

**Ответ (требуется 2FA):**
```json
{
  "requires2FA": true,
  "tempToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**curl:**
```bash
curl -X POST https://ваш-домен.ru/api/v1/auth/login \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"mypassword"}'
```

---

### POST /api/v1/auth/2fa

Подтверждение 2FA после логина (если `requires2FA: true`).

**Авторизация:** 🔑 API Key

**Тело запроса:**
```json
{
  "tempToken": "eyJhbGciOiJIUzI1NiIs...",
  "code": "123456"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| tempToken | string | Токен из ответа `/auth/login` |
| code | string | 6-значный TOTP код |

**Ответ:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "client": { ... }
}
```

> `tempToken` действителен 5 минут.

**curl:**
```bash
curl -X POST https://ваш-домен.ru/api/v1/auth/2fa \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{"tempToken":"...","code":"123456"}'
```

---

### POST /api/v1/auth/register

Регистрация нового клиента.

**Авторизация:** 🔑 API Key

**Тело запроса:**
```json
{
  "email": "new@example.com",
  "password": "securepass123",
  "referralCode": "REF-A1B2C3D4",
  "preferredLang": "ru",
  "preferredCurrency": "RUB"
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| email | string | ✅ | Email (должен быть валидным) |
| password | string | ✅ | Пароль (мин. 6 символов) |
| referralCode | string | ❌ | Реферальный код |
| preferredLang | string | ❌ | Язык (по умолчанию `"ru"`) |
| preferredCurrency | string | ❌ | Валюта (по умолчанию `"RUB"`) |

**Ответ (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "client": {
    "id": "clxyz...",
    "email": "new@example.com",
    "balance": 0,
    "referralCode": "REF-E5F6G7H8",
    ...
  }
}
```

**Ошибки:**
- `409` — Email уже зарегистрирован

**curl:**
```bash
curl -X POST https://ваш-домен.ru/api/v1/auth/register \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{"email":"new@example.com","password":"securepass123"}'
```

---

## 2. Профиль клиента

### GET /api/v1/client/profile

Получить полный профиль текущего клиента.

**Авторизация:** 🔒 API Key + Client Token

**Ответ:**
```json
{
  "id": "clxyz...",
  "email": "user@example.com",
  "telegramId": "123456789",
  "telegramUsername": "username",
  "preferredLang": "ru",
  "preferredCurrency": "RUB",
  "balance": 250.00,
  "referralCode": "REF-A1B2C3D4",
  "referralPercent": 10,
  "remnawaveUuid": "550e8400-e29b-41d4-a716-446655440000",
  "trialUsed": false,
  "isBlocked": false,
  "totpEnabled": false,
  "createdAt": "2025-01-15T10:30:00.000Z",
  "autoRenewEnabled": true,
  "autoRenewTariffId": "tariff_id..."
}
```

**curl:**
```bash
curl https://ваш-домен.ru/api/v1/client/profile \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Authorization: Bearer jwt_токен_клиента"
```

---

### PATCH /api/v1/client/profile

Обновить предпочтения клиента.

**Авторизация:** 🔒 API Key + Client Token

**Тело запроса:**
```json
{
  "preferredLang": "en",
  "preferredCurrency": "USD"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| preferredLang | string | Язык интерфейса |
| preferredCurrency | string | Валюта |

Оба поля необязательны, можно передать только одно.

**Ответ:** обновлённый профиль (аналогично GET).

---

## 3. Баланс и платежи

### GET /api/v1/client/balance

Получить текущий баланс.

**Авторизация:** 🔒 API Key + Client Token

**Ответ:**
```json
{
  "balance": 250.00
}
```

**curl:**
```bash
curl https://ваш-домен.ru/api/v1/client/balance \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Authorization: Bearer jwt_токен_клиента"
```

---

### GET /api/v1/client/payments

История платежей с пагинацией.

**Авторизация:** 🔒 API Key + Client Token

**Query параметры:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| limit | number | 50 | Макс. записей (до 100) |
| offset | number | 0 | Смещение |

**Ответ:**
```json
{
  "payments": [
    {
      "id": "clxyz...",
      "orderId": "ORD-123456",
      "amount": 200,
      "currency": "RUB",
      "status": "PAID",
      "provider": "yookassa",
      "tariffId": "tariff_id...",
      "createdAt": "2025-06-01T12:00:00.000Z",
      "paidAt": "2025-06-01T12:05:00.000Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**Статусы платежей:** `PENDING`, `PAID`, `FAILED`, `REFUNDED`

**Провайдеры:** `platega`, `balance`, `yoomoney`, `yoomoney_form`, `yookassa`, `cryptopay`, `heleket`

**curl:**
```bash
curl "https://ваш-домен.ru/api/v1/client/payments?limit=10&offset=0" \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Authorization: Bearer jwt_токен_клиента"
```

---

## 4. Подписка

### GET /api/v1/client/subscription

Получить данные VPN подписки из Remnawave.

**Авторизация:** 🔒 API Key + Client Token

**Ответ (активная подписка):**
```json
{
  "active": true,
  "subscription": {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "username": "user_abc",
    "status": "ACTIVE",
    "trafficLimitBytes": 107374182400,
    "trafficLimitStrategy": "NO_RESET",
    "userTraffic": {
      "usedTrafficBytes": 5368709120,
      "lifetimeUsedTrafficBytes": 21474836480
    },
    "expireAt": "2025-08-15T23:59:59.000Z",
    "onlineAt": "2025-07-10T14:30:00.000Z",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "activeUserInbounds": [...]
  }
}
```

**Ответ (нет подписки):**
```json
{
  "active": false,
  "message": "No subscription"
}
```

**curl:**
```bash
curl https://ваш-домен.ru/api/v1/client/subscription \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Authorization: Bearer jwt_токен_клиента"
```

---

## 5. Устройства

### GET /api/v1/client/devices

Список подключённых устройств (HWID) из Remnawave.

**Авторизация:** 🔒 API Key + Client Token

**Ответ:**
```json
{
  "total": 2,
  "devices": [
    {
      "hwid": "a1b2c3d4...",
      "userAgent": "...",
      "lastConnectedAt": "2025-07-10T14:30:00.000Z"
    }
  ]
}
```

---

## 6. Прокси слоты

### GET /api/v1/client/proxy-slots

Активные прокси слоты клиента.

**Авторизация:** 🔒 API Key + Client Token

**Ответ:**
```json
[
  {
    "id": "clxyz...",
    "host": "proxy.example.com",
    "login": "user_abc",
    "password": "pass123",
    "expiresAt": "2025-08-15T23:59:59.000Z",
    "trafficUsedBytes": 1073741824,
    "trafficLimitBytes": 10737418240,
    "connectionLimit": 3,
    "currentConnections": 1,
    "status": "ACTIVE",
    "createdAt": "2025-07-01T00:00:00.000Z"
  }
]
```

---

## 7. Sing-box слоты

### GET /api/v1/client/singbox-slots

Активные Sing-box слоты клиента.

**Авторизация:** 🔒 API Key + Client Token

**Ответ:**
```json
[
  {
    "id": "clxyz...",
    "userIdentifier": "550e8400-e29b-...",
    "expiresAt": "2025-08-15T23:59:59.000Z",
    "trafficUsedBytes": 5368709120,
    "trafficLimitBytes": null,
    "currentConnections": 0,
    "status": "ACTIVE",
    "createdAt": "2025-07-01T00:00:00.000Z"
  }
]
```

---

## 8. Рефералы

### GET /api/v1/client/referrals

Реферальная информация клиента.

**Авторизация:** 🔒 API Key + Client Token

**Ответ:**
```json
{
  "referralCode": "REF-A1B2C3D4",
  "referralPercent": 10,
  "referralsCount": 5,
  "totalEarnings": 500.00
}
```

**curl:**
```bash
curl https://ваш-домен.ru/api/v1/client/referrals \
  -H "X-Api-Key: sk_ваш_ключ" \
  -H "Authorization: Bearer jwt_токен_клиента"
```

---

## 9. Тарифы (публичные)

Эндпоинты этой секции не требуют клиентского токена — только API ключ.

### GET /api/v1/tariffs

Список VPN тарифов по категориям.

**Авторизация:** 🔑 API Key

**Ответ:**
```json
[
  {
    "id": "cat_id...",
    "name": "Стандартные",
    "tariffs": [
      {
        "id": "tariff_id...",
        "name": "30 дней",
        "description": "Безлимитный доступ на 30 дней",
        "durationDays": 30,
        "trafficLimitBytes": 107374182400,
        "trafficResetMode": null,
        "deviceLimit": 3,
        "price": 200,
        "currency": "RUB"
      }
    ]
  }
]
```

| Поле | Тип | Описание |
|------|-----|----------|
| trafficLimitBytes | number \| null | Лимит трафика в байтах (`null` = безлимит) |
| trafficResetMode | string \| null | Режим сброса трафика |
| deviceLimit | number \| null | Макс. устройств (`null` = без ограничений) |
| durationDays | number | Длительность подписки в днях |

**curl:**
```bash
curl https://ваш-домен.ru/api/v1/tariffs \
  -H "X-Api-Key: sk_ваш_ключ"
```

---

### GET /api/v1/proxy-tariffs

Список активных тарифов прокси по категориям.

**Авторизация:** 🔑 API Key

---

### GET /api/v1/singbox-tariffs

Список активных тарифов Sing-box по категориям.

**Авторизация:** 🔑 API Key

---

### GET /api/v1/config

Публичная конфигурация сервиса.

**Авторизация:** 🔑 API Key

**Ответ (частичный пример):**
```json
{
  "serviceName": "STEALTHNET",
  "languages": ["ru", "en"],
  "currencies": ["RUB", "USD"],
  "telegramBotUsername": "stealthnet_bot",
  "trialEnabled": true,
  "trialDurationDays": 3,
  "paymentMethods": {
    "yookassaEnabled": true,
    "cryptopayEnabled": true,
    "heleketEnabled": false,
    "platega": false,
    "yoomoneyEnabled": false
  },
  "sellOptions": [...],
  "customBuildConfig": {...}
}
```

---

## Полный пример интеграции

### 1. Логин и получение токена

```bash
# Логин
RESPONSE=$(curl -s -X POST https://example.com/api/v1/auth/login \
  -H "X-Api-Key: sk_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"pass123"}')

# Извлечь токен
TOKEN=$(echo $RESPONSE | jq -r '.token')
```

### 2. Получение профиля

```bash
curl -s https://example.com/api/v1/client/profile \
  -H "X-Api-Key: sk_abc123..." \
  -H "Authorization: Bearer $TOKEN"
```

### 3. Получение подписки

```bash
curl -s https://example.com/api/v1/client/subscription \
  -H "X-Api-Key: sk_abc123..." \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Список тарифов (без клиентского токена)

```bash
curl -s https://example.com/api/v1/tariffs \
  -H "X-Api-Key: sk_abc123..."
```

---

## Лимиты и рекомендации

- **Токен клиента** действителен **7 дней** — сохраняйте его и обновляйте через повторный логин.
- **API ключ** не имеет срока действия, но может быть отключён или удалён из админки.
- Для пагинации используйте параметры `limit` и `offset` (макс. `limit=100`).
- Все даты в формате **ISO 8601** (UTC).
- Все суммы баланса и цены — числа с плавающей точкой.
- Трафик всегда в **байтах** (1 ГБ = 1073741824 байт).
