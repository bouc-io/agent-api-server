# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---- Dependencies ----
FROM base AS dependencies
RUN npm install

# ---- Build ----
FROM dependencies AS build
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- Production ----
FROM base AS production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY prisma ./prisma
RUN npx prisma generate

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000


ENV NODE_ENV="development"
ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL
# LLM Configuration
ENV OLLAMA_URL="https://api.pik8s.internal/ollama"
ENV OLLAMA_MODEL="qwen3.5:2b"
# OAuth2 Configuration (for token refresh)
ENV OAUTH_TOKEN_ENDPOINT="https://sso.pik8s.internal/realms/users/protocol/openid-connect/token"
ENV OAUTH_CLIENT_ID="oauth2-proxy"
# SSL/TLS Configuration
ENV ALLOW_SELF_SIGNED_CERTS="true"

# Sandboxed code execution (disabled by default; needs a container runtime on the host)
ENV ALLOW_CODE_EXECUTE="false"
ENV SANDBOX_IMAGE="python:3.11-slim"
ENV SANDBOX_TIMEOUT_MS="10000"
ENV SANDBOX_MEMORY="256m"
ENV SANDBOX_CPUS="1"
ENV SANDBOX_PIDS="128"
# Eval harness HITL auto-approval master switch (disabled by default; keep off in prod).
# When "true", runs opting in via options.eval_mode=true skip the human approval gate.
ENV EVAL_AUTO_APPROVE="false"
# Instruction services (GAP 4)
ENV ADMIN_API_URL=$ADMIN_API_URL
ENV PORTAL_API_URL=$PORTAL_API_URL

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

CMD ["sh", "-c", "npm run db:deploy && npm start"]
