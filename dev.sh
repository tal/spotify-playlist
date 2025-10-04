#!/bin/bash

# Script to run both API server and web client concurrently

echo "🚀 Starting Spotify Playlist Manager Development Environment..."
echo ""

# Function to kill all child processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down servers..."
    pkill -P $$
    exit
}

# Set up trap to call cleanup on script exit
trap cleanup INT TERM EXIT

# Start API server
echo "📡 Starting API server on port 3001..."
yarn dev:api &
API_PID=$!

# Wait a bit for API server to start
sleep 3

# Start web client
echo "🌐 Starting web client on port 3000..."
cd web && bun run dev &
WEB_PID=$!

echo ""
echo "✅ Development environment is running!"
echo "   - Web UI: http://localhost:3000"
echo "   - API: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

# Wait for both processes
wait $API_PID $WEB_PID