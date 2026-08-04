# Сборка фронтенда — результат в /app/dist
FROM node:22-alpine AS builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* frontend/.npmrc* ./
RUN npm ci
COPY frontend/. .
COPY version.json ../version.json
RUN npm run build

# Финальный образ — просто dist для копирования через docker cp или volume
FROM alpine:3.20
COPY --from=builder /app/dist /dist
CMD ["echo", "Frontend build is in /dist"]
