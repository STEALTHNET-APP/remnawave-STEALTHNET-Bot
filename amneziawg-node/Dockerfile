FROM golang:1.25-alpine AS engine
ARG AWG_GO_REV=b5928efb6ca19f0153958460c3d141f04abc5c2e
RUN apk add --no-cache git build-base
WORKDIR /src
RUN git init && git remote add origin https://github.com/amnezia-vpn/amneziawg-go.git && git fetch --depth 1 origin ${AWG_GO_REV} && git checkout FETCH_HEAD
RUN go build -trimpath -o /amneziawg-go .

FROM alpine:3.22 AS tools
ARG AWG_TOOLS_REV=ee0f0a9aa34ff0a0da4b3433b9512781cfe02843
RUN apk add --no-cache git build-base linux-headers
WORKDIR /src
RUN git init && git remote add origin https://github.com/amnezia-vpn/amneziawg-tools.git && git fetch --depth 1 origin ${AWG_TOOLS_REV} && git checkout FETCH_HEAD
RUN make -C src

FROM node:22-alpine
RUN apk add --no-cache iproute2 iptables
COPY --from=engine /amneziawg-go /usr/local/bin/amneziawg-go
COPY --from=tools /src/src/wg /usr/local/bin/awg
WORKDIR /app
COPY amneziawg-node/agent.cjs /app/agent.cjs
ENV DATA_DIR=/data
CMD ["node", "agent.cjs"]
