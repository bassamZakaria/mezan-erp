#!/usr/bin/env bash
# Builds the linux/amd64 image for the Contabo VPS from a clean checkout and
# pushes it to GHCR tagged with the commit SHA; the VPS then runs deploy.sh <sha>.
# Needs: docker buildx, and `docker login ghcr.io` with a token that has write:packages.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "build-image: the working tree has uncommitted changes; the image would not match its tag" >&2
  exit 1
fi

sha="$(git rev-parse HEAD)"
image="${MEZAN_IMAGE:-ghcr.io/bassamzakaria/mezan-erp}"

docker buildx build \
  --platform linux/amd64 \
  --build-arg "MEZAN_VERSION=${sha}" \
  --label "org.opencontainers.image.revision=${sha}" \
  --tag "${image}:${sha}" \
  --push \
  .

echo "On the VPS run: sudo /opt/mezan/deploy.sh ${sha}"
