FROM node:20-alpine
WORKDIR /app
# Build with context ./backend (see deploy-backend.yml) so we can copy shared Lua from colyseus
COPY bots/package*.json ./
RUN npm install --omit=dev
COPY bots/ .
COPY colyseus/src/lib/redis-scripts/matchBot.lua ./lib/redis-scripts/matchBot.lua
EXPOSE 3000
CMD ["node", "index.js"]


