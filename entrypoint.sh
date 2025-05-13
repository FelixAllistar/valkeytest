#!/bin/sh

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Starting application server (server.js)..."
node server.js &
APP_PID=$!
echo "Application server started in background with PID $APP_PID."

# The run_tests.js script has its own internal logic (waitForServer function) 
# to wait for the server at http://localhost:3000 to be ready and for Redis to be connected.
echo "Starting tests (run_tests.js)..."
node run_tests.js
TEST_EXIT_CODE=$? # Capture the exit code of the test script

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ Tests passed. Application server will continue running."
  # If tests pass, we want the server to keep running.
  # We wait for the APP_PID to keep the script (and thus the container) alive.
  # If server.js exits for any reason, this wait will end.
  wait $APP_PID 
  exit $? # Exit with the server's exit code.
else
  echo "❌ Tests failed with exit code $TEST_EXIT_CODE."
  echo "Stopping application server due to test failure..."
  kill $APP_PID
  # Wait for the server to actually stop
  wait $APP_PID || true # or true in case kill already made it exit and wait would fail
  echo "Application server stopped."
  exit $TEST_EXIT_CODE # Exit with the test failure code. Coolify should see this.
fi 