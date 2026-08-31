# SQL шпаргалки

Готовые запросы для быстрой диагностики прода. Используй когда надо
быстро понять «что сейчас в БД» без захода в код или в админку.

## Запуск

### Через docker (без открытия порта)

```bash
docker compose exec -T postgres psql -U stealthnet -d stealthnet \
  < scripts/sql/payments-status.sql
```

### С локального хоста (если `docker-compose.override.yml` включён)

Скопируй `docker-compose.override.yml.example` → `docker-compose.override.yml`
и сделай `docker compose up -d` — Postgres станет доступен на `127.0.0.1:5432`.
Затем:

```bash
psql -h 127.0.0.1 -U stealthnet -d stealthnet -f scripts/sql/payments-status.sql
```

Пароль возьми из `.env` (`POSTGRES_PASSWORD`).

## Что есть

| Файл | Что показывает |
|------|----------------|
| `payments-status.sql` | Сводка статусов за 24ч + последние 20 транзакций + PENDING старше 1ч |
| `migrations-status.sql` | Применённые Prisma миграции + незавершённые |
| `active-clients.sql` | Сводка по клиентам + топ балансов + новые за 24ч |

## Безопасность

⚠️ **`docker-compose.override.yml` НЕ коммить.** Там Postgres-порт открыт
наружу контейнера. Если случайно зальёшь на прод-сервер — Postgres станет
доступен извне. Override включай **только локально**.

На проде используй `docker compose exec -T postgres psql ... < файл.sql`.
