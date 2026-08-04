FROM node:22-alpine AS builder

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci
COPY backend/. .
COPY version.json ./version.json
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine

# Fallback-зеркала для apk: dl-cdn.alpinelinux.org иногда недоступен.
# 25.05.2026, WolfVPN — добавили ffmpeg (нужен ffprobe для извлечения
# width/height/duration видео в broadcast, чтобы Telegram не рисовал квадрат).
RUN set -eux; \
    apk add --no-cache postgresql-client ffmpeg \
    || (printf 'https://mirror.yandex.ru/mirrors/alpine/v3.19/main\nhttps://mirror.yandex.ru/mirrors/alpine/v3.19/community\n' > /etc/apk/repositories && apk update && apk add --no-cache postgresql-client ffmpeg) \
    || (printf 'https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.19/main\nhttps://mirrors.tuna.tsinghua.edu.cn/alpine/v3.19/community\n' > /etc/apk/repositories && apk update && apk add --no-cache postgresql-client ffmpeg)

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/i18n/*.json ./dist/i18n/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/version.json ./version.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/subpage-00000000-0000-0000-0000-000000000000.json ./
# Бэкап-копия в /app/defaults — используется бэкендом как fallback,
# если основной файл /app/subpage-...json отсутствует/битый/перекрыт
# битым volume-mount'ом. Не перекрывается volume и всегда содержит
# версию из образа (т.е. с момента сборки).
RUN mkdir -p /app/defaults && \
    cp /app/subpage-00000000-0000-0000-0000-000000000000.json /app/defaults/
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN npx prisma generate \
  && chmod +x /app/docker-entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
