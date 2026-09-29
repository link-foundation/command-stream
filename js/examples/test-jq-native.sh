#!/bin/bash

echo "Testing native jq streaming (without our library):"
echo "Each JSON object should appear immediately, not all at once"
echo ""

# Test with delays - jq should output each line as it arrives
(echo '{"n":1}'; sleep 0.5; echo '{"n":2}'; sleep 0.5; echo '{"n":3}') | jq . | while read line; do
    echo "[$(date +%s%3N)] $line"
done