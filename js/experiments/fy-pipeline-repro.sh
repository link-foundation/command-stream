#!/bin/sh
GREETING=hello
for name in world there; do
  echo "$GREETING $name"
done
if true; then
  echo yes
fi
echo done | tr a-z A-Z
