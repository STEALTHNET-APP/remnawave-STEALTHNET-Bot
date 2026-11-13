# Встроенный nginx: автоматическое продление SSL

Для профиля `builtin-nginx` certbot проверяет сертификаты каждые 12 часов и
автоматически запускается после перезагрузки сервера. Продление использует
`webroot` (`/var/www/certbot`) для сертификатов, ранее выпущенных через
`standalone`. Для остальных сохраняется выбранный способ проверки, включая DNS Cloudflare. Останавливать nginx и освобождать порт 80 не требуется.

Nginx проверяет содержимое сертификатов и ключей каждые 60 секунд. После изменения
выполняются `nginx -t` и `nginx -s reload`. При ошибке проверка повторяется через
60 секунд; работающий nginx не останавливается. HTTP-only запуск установщика
работает и до появления первого сертификата.

## Обновление существующей установки

После обновления файлов репозитория выполните из его каталога:

```sh
docker compose --profile builtin-nginx up -d --no-deps --force-recreate nginx certbot
```

Нужно пересоздать оба контейнера: обычный `docker compose restart` не применяет
новую restart-политику, команду certbot и подключение скрипта nginx. Выпуск нового
сертификата с `--force-renewal` для перехода не нужен. Сохранённые standalone-настройки
перекрываются параметрами каждого запуска `renew`; при успешном продлении Certbot
сохраняет новые параметры.

Порт 80 и путь `http://<домен>/.well-known/acme-challenge/` должны быть доступны
из интернета. Если установщик использовал standalone из-за недоступного webroot,
причину этой недоступности необходимо устранить.

## Проверка

Чтобы не запустить два certbot одновременно, на время проверки остановите его
фоновый контейнер (nginx продолжает работать):

```sh
docker compose --profile builtin-nginx stop certbot
docker compose --profile builtin-nginx run --rm --no-deps --entrypoint /bin/sh certbot \
  /opt/renew-certificates.sh --dry-run
docker compose --profile builtin-nginx up -d --no-deps certbot
docker compose --profile builtin-nginx logs --tail=100 certbot nginx
```

Даже если `--dry-run` завершился ошибкой, снова запустите certbot последней
командой `up`. Dry-run проверяет выпуск через тестовый сервер Let's Encrypt,
не заменяет действующий сертификат и не должен вызывать reload nginx.

После настоящего продления в логах nginx появится
`[ssl-renewal] nginx reloaded after certificate change`. Внешний nginx и его
сертификаты этим механизмом не управляются.
