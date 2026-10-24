#!/bin/sh
# deploy helper
set -e

TARGET=${1:-staging}
export REGION=eu

deploy() {
  local tag
  tag="$(git rev-parse --short HEAD)"
  echo "deploying $tag to $TARGET" | tee deploy.log
}

if [ -d dist ]; then
  deploy
else
  echo "nothing to deploy" >&2
fi

for env in staging prod; do
  echo "$env"
done

case "$TARGET" in
  staging) deploy ;;
  *) echo unknown ;;
esac

ls && echo ok || echo failed
exit 0
