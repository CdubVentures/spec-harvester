FROM mcr.microsoft.com/playwright:v1.54.2-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

CMD ["node", "src/cli/run-batch.js", "--category", "mouse"]
