FROM node:20-alpine as builder

WORKDIR /app

RUN apk add --no-cache \
    python3 py3-pip \
    build-base

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm install --omit=dev
RUN cd server && npm install --omit=dev

FROM nvidia/cuda:12.3.1-runtime-alpine

WORKDIR /app

RUN apk add --no-cache \
    nodejs npm \
    bash curl \
    ffmpeg

RUN apk add --no-cache \
    python3 py3-pip && \
    pip install openai-whisper

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules

COPY . .

RUN mkdir -p ./data/uploads ./data/outputs ./data/temp

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

ENV NODE_ENV=production

CMD ["node", "server/src/server.js"]
