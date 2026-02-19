# Прокси-нода STEALTHNET

Контейнер для запуска на сервере админа. Регистрируется в панели по токену, шлёт heartbeat, получает список слотов (логин/пароль) для генерации конфига прокси.

## Переменные окружения

- `STEALTHNET_API_URL` — URL API панели (например https://panel.example.com)
- `PROXY_NODE_TOKEN` — токен ноды (из админки «Добавить прокси»)
- `SOCKS_PORT` — порт SOCKS5 (по умолчанию 1080)
- `HTTP_PORT` — порт HTTP-прокси (по умолчанию 8080)

## API агента

1. **POST** `{API_URL}/api/proxy-nodes/register`  
   Заголовок: `X-Proxy-Node-Token: <token>`  
   Тело (опционально): `{ "name": "...", "socksPort": 1080, "httpPort": 8080 }`  
   Ответ: `{ "nodeId": "...", "pollIntervalSec": 60 }`

2. **POST** `{API_URL}/api/proxy-nodes/:nodeId/heartbeat`  
   Заголовок: `X-Proxy-Node-Token: <token>`  
   Тело: `{ "connections": 0, "trafficIn": 0, "trafficOut": 0, "slots": [{ "slotId": "...", "trafficUsed": 0, "connections": 0 }] }`

3. **GET** `{API_URL}/api/proxy-nodes/:nodeId/slots`  
   Заголовок: `X-Proxy-Node-Token: <token>`  
   Ответ: `{ "slots": [{ "id", "login", "password", "expiresAt", "trafficLimitBytes", "connectionLimit" }] }`

## Сборка образа

```bash
cd proxy-node
docker build -t stealthnet/proxy-node:latest .
```

Далее используйте docker-compose из админки (образ уже указан как `stealthnet/proxy-node:latest`).

## Реализация

Сейчас в образ входит только **агент** (регистрация + heartbeat каждые 60 сек). Интеграция с 3proxy или gost для выдачи SOCKS5/HTTP по списку слотов — следующий шаг (генерация конфига из GET /slots и перезапуск прокси-сервера).
