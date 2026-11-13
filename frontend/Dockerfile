# Сборка фронтенда — результат в /app/dist
FROM node:22-alpine AS builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* frontend/.npmrc* ./
RUN npm ci
COPY frontend/. .
COPY version.json ../version.json
COPY scripts/build-version.cjs /tmp/build-version.cjs
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE
RUN BUILD_COMMIT="$BUILD_COMMIT" BUILD_DATE="$BUILD_DATE" node /tmp/build-version.cjs ../version.json
RUN npm run build

# Финальный образ — просто dist для копирования через docker cp или volume
FROM alpine:3.20
ARG BUILD_COMMIT=unknown
LABEL org.opencontainers.image.revision=$BUILD_COMMIT
COPY --from=builder /app/dist /dist
CMD ["echo", "Frontend build is in /dist"]
