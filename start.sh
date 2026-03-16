#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║   HR Intelligence & Salary Processing Platform    ║"
echo "║   Indriyan Beverages / Asian Lakto Ind. Ltd.       ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Parse args: --prod to run in production mode
MODE="dev"
if [[ "$1" == "--prod" ]]; then
  MODE="prod"
fi

# Install if node_modules missing
if [ ! -d "backend/node_modules" ]; then
  echo "📦 Installing backend dependencies..."
  cd backend && npm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "📦 Installing frontend dependencies..."
  cd frontend && npm install && cd ..
fi

if [ ! -d "node_modules" ]; then
  echo "📦 Installing root dependencies..."
  npm install
fi

# Create data directory
mkdir -p data

if [ "$MODE" == "prod" ]; then
  echo "🔨 Building frontend for production..."
  npm run build --prefix frontend

  echo ""
  echo "🚀 Starting in PRODUCTION mode (single server)..."
  echo "   App → http://localhost:3000"
  echo ""
  NODE_ENV=production node backend/server.js
else
  echo "🚀 Starting in DEVELOPMENT mode..."
  echo "   Backend  → http://localhost:3001"
  echo "   Frontend → http://localhost:5173"
  echo ""
  npm run dev
fi
