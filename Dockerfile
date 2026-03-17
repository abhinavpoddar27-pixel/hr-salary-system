FROM node:20-slim

WORKDIR /app

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
