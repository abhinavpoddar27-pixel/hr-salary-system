FROM node:20-slim

WORKDIR /app

# Install build tools needed for better-sqlite3 native compilation
RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy everything (frontend/dist is pre-built and committed)
COPY . .

# Install only backend dependencies
WORKDIR /app/backend
RUN npm install --production

# Back to root
WORKDIR /app

# Railway injects PORT env var
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "backend/server.js"]
