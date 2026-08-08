# Sandbox image for a SELF-HOSTED control plane.
#
# Anthropic's hosted Managed Agents installs an environment's `packages:` into
# the sandbox for you. A self-hosted managed-agent-platform deployment stores
# that field but never acts on it (internal/sandbox/docker/docker.go never
# reads Packages), so python-pptx has to be baked into the image instead.
#
# The executor picks its sandbox base image from one deployment-wide variable,
# so build this on the same Docker daemon the executor talks to and point
# EXECUTOR_IMAGE at the tag:
#
#   docker build -t cwc-sandbox-pptx -f resources/sandbox.Dockerfile resources
#   # then in managed-agent-platform/deploy/compose/.env:
#   #   EXECUTOR_IMAGE=cwc-sandbox-pptx
#   docker compose up -d executor
#
# Set it BEFORE running any session: the provider fails closed on an image
# mismatch rather than replacing a live session's sandbox, so flipping the
# variable mid-workshop wedges every session that already has one.
#
# python:3.12-slim is Debian-based, which the platform's sandbox contract
# requires — the container entrypoint and the outputs-harvest listing script
# are bash one-liners, so an Alpine base would fail.
FROM python:3.12-slim

# python-pptx writes the deck; Pillow and matplotlib back the later workshop
# rounds that add images and generated diagrams to slides.
RUN pip install --no-cache-dir python-pptx pillow matplotlib

# The rendering half of the eval runs on the host (the cwc-pptx-render image),
# not in here — the sandbox only needs to produce the .pptx.
