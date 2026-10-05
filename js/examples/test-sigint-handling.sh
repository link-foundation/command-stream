#!/bin/sh

# Example: Test SIGINT handling in shell scripts
# This script demonstrates proper SIGINT handling with trap

echo "BASELINE_START"

# Set up signal handler
trap 'echo "Got SIGINT"; exit 130' INT

echo "Sleeping for 30 seconds (send SIGINT to interrupt)..."
sleep 30

echo "Sleep completed normally"