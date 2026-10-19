# SSL через Cloudflare DNS

Для установленной панели со встроенным Docker nginx. Используется официальный плагин [Certbot DNS Cloudflare](https://certbot-dns-cloudflare.readthedocs.io/en/stable/). DNS-зона должна обслуживаться Cloudflare. Проверка DNS не требует открытого порта 80 и поддерживает wildcard.

Создайте API Token Cloudflare с правом `Zone:DNS:Edit` только для нужной зоны. На сервере сохраните `/root/cloudflare.ini` с правами `600`:

```ini
dns_cloudflare_api_token = ВАШ_API_TOKEN
```

В каталоге проекта сначала проверьте DNS challenge без замены рабочего сертификата:

```bash
bash scripts/cloudflare-ssl.sh --dry-run panel.example.com admin@example.com /root/cloudflare.ini example.com '*.example.com'
```

Первый домен должен совпадать с `DOMAIN` в `.env`: nginx ищет сертификат по этому имени. Дополнительные имена необязательны. `*.example.com` покрывает один уровень поддоменов, но не сам `example.com`. Все перечисленные зоны должны быть доступны токену.

После успешной проверки установите сертификат той же командой без `--dry-run`. Скрипт обновит сертификат, сохранит DNS credentials внутри тома Certbot с правами `600`, переключит `CERTBOT_IMAGE` в `.env` на образ с DNS-плагином и перезагрузит nginx. Не запускайте рабочую выдачу многократно: у Let's Encrypt есть лимиты.

Certbot сохраняет способ проверки и путь к credentials для следующих продлений. Контейнер проверяет продление каждые 12 часов. Встроенный nginx проверяет изменения файлов сертификатов раз в минуту и автоматически перечитывает их после успешного `nginx -t`. Если проверка или перезагрузка не удалась, он повторит попытку при следующей проверке. Отдельная задача в cron не нужна.

Если nginx был запущен старой версией панели, после обновления кода примените актуальную конфигурацию контейнера, чтобы подключить скрипт автоматической перезагрузки:

```bash
docker compose --profile builtin-nginx up -d --no-deps nginx
```

Для проверки сохранённой настройки продления:

```bash
docker compose --profile builtin-nginx run --rm --no-deps --entrypoint certbot certbot renew --dry-run
```

Если используется внешний nginx, Caddy или Traefik, настройте DNS challenge у своего reverse proxy. Этот скрипт рассчитан только на встроенный nginx. Не коммитьте credentials и не удаляйте сохранённый том Certbot: он нужен для продления.
