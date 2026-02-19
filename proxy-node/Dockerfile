# STEALTHNET proxy node agent (register + heartbeat + slots fetch)
# 3proxy can be added later for actual SOCKS5/HTTP serving
FROM node:20-alpine

WORKDIR /app

COPY package.json agent.js ./

CMD ["node", "agent.js"]
