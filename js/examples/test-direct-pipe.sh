#!/bin/bash

echo "Testing if jq buffers output:"
echo ""

# Create a script that outputs JSON with delays
cat > /tmp/stream-test.sh << 'EOF'
#!/bin/bash
echo '{"n":1}'
sleep 0.5
echo '{"n":2}'
sleep 0.5  
echo '{"n":3}'
EOF

chmod +x /tmp/stream-test.sh

echo "Running: /tmp/stream-test.sh | jq . | while read line..."
echo "If jq doesn't buffer, we should see output every 0.5 seconds"
echo ""

start=$SECONDS
/tmp/stream-test.sh | jq . | while IFS= read -r line; do
    elapsed=$((SECONDS - start))
    echo "[${elapsed}s] $line"
done

rm /tmp/stream-test.sh