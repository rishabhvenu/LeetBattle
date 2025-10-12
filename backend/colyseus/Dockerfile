FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
# Copy problems.json to dist directory so matchmaker can find it
COPY problems.json ./dist/
EXPOSE 2567
CMD ["node", "dist/index.js"]

