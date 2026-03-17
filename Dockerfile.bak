FROM node:20

WORKDIR /app

# Copy everything (frontend/dist is pre-built and committed)
COPY . .

# Install only backend dependencies
WORKDIR /app/backend
RUN npm install --production

# Back to root
WORKDIR /app

# Railway injects PORT env var (default 3000)
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Shell form ensures output is flushed; exec replaces shell with node process
CMD echo "[DOCKER] Starting container..." && echo "[DOCKER] Node: $(node -v)" && echo "[DOCKER] Files: $(ls /app/backend/server.js 2>&1)" && exec node /app/backend/server.js
