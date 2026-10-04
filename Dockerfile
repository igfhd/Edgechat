FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 8787

ENV NODE_ENV=production +    CI=true +    WRANGLER_SEND_METRICS=false

CMD ["npx", "wrangler", "dev", "--port", "8787", "--ip", "0.0.0.0", "--show-interactive-dev-session=false"]
