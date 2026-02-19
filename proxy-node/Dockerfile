# STEALTHNET proxy node agent (register + heartbeat + slots fetch)
# 3proxy can be added later for actual SOCKS5/HTTP serving
# When build context is repo root (e.g. from git URL), paths are proxy-node/...
FROM node:20-alpine

WORKDIR /app

COPY proxy-node/package.json proxy-node/agent.js ./

CMD ["node", "agent.js"]
