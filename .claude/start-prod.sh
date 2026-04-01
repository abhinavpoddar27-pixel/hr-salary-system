#!/bin/bash
cd "$(dirname "$0")/.."
NODE_ENV=production exec node backend/server.js
