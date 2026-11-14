FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /console .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && mkdir -p /data
COPY --from=build /console /console
VOLUME /data
ENTRYPOINT ["/console"]
