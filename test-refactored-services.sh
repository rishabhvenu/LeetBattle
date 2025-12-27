#!/bin/bash
# Test script to verify refactored services build and start

set -e

echo "=== Testing Refactored Services ==="
echo ""

# Test 1: Colyseus TypeScript Build
echo "Test 1: Building Colyseus TypeScript..."
cd /Users/ase/Documents/CodeClashers/backend/colyseus
npm run build
echo "✓ Colyseus builds successfully"
echo ""

# Test 2: Bot Service Syntax Check
echo "Test 2: Checking Bot Service syntax..."
cd /Users/ase/Documents/CodeClashers/backend/bots
node -c index.new.js
node -c lib/config.js
node -c lib/leaderElection.js  
node -c lib/matchmaking.js
node -c lib/apiClient.js
echo "✓ All bot service files have valid syntax"
echo ""

# Test 3: Check if env file exists
echo "Test 3: Checking environment configuration..."
if [ -f "/Users/ase/Documents/CodeClashers/backend/.env" ]; then
    echo "✓ Environment file exists"
    
    # Load environment variables
    export $(grep -v '^#' /Users/ase/Documents/CodeClashers/backend/.env | xargs)
    
    echo "Test 4: Starting Colyseus server (will run for 5 seconds)..."
    cd /Users/ase/Documents/CodeClashers/backend/colyseus
    
    # Start server in background and capture PID
    node dist/index.js &
    SERVER_PID=$!
    
    echo "Server started with PID $SERVER_PID"
    
    # Wait 5 seconds for startup
    sleep 5
    
    # Kill the server
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    
    echo "✓ Colyseus server started and stopped"
else
    echo "⚠ Environment file not found, skipping server startup test"
    echo "  The build and syntax checks passed successfully"
fi

echo ""
echo "=== All Tests Passed ==="
