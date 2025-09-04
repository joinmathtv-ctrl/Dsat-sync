# ---- Build stage (정적 자산은 이미 저장소에 있으므로 최소화) ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:20-alpine
WORKDIR /app

# Timezone/UTF-8 옵션(선택)
ENV TZ=Etc/UTC \
    NODE_ENV=production

# 앱 복사
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Cloud Run은 8080을 기대
ENV PORT=8080
EXPOSE 8080

# 헬스엔드포인트 (이미 /healthz 있음)
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "server.js"]
