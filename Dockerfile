FROM node:24.15.0-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "services/launch.mjs"]
