#!/bin/bash

# Sample shell script for testing $fy tool
# This demonstrates various shell features

set -e

# Variables
PROJECT_DIR="/tmp/test-project"
LOG_FILE="build.log"

# Create project directory
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Initialize project
echo "Initializing project..." 
touch package.json
echo '{"name": "test-project", "version": "1.0.0"}' > package.json

# Build process
echo "Starting build process" | tee "$LOG_FILE"
ls -la >> "$LOG_FILE"

# Conditional execution
if [ -f "package.json" ]; then
  echo "Package.json found"
else
  echo "Package.json missing" && exit 1
fi

# Pipeline operations
cat package.json | grep "name" | cut -d '"' -f 4

# Cleanup
cd ..
rm -rf "$PROJECT_DIR"

echo "Build complete!"