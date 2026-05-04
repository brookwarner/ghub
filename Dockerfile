FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY dist/ ./dist/
COPY vendor/ ./vendor/

EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
