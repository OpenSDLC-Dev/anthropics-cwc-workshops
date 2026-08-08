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
#
# Deliberately no USER: image-level de-privileging breaks the sandbox. A
# deployment creates paths inside the container that it then writes to as root
# — the shell lane's /var/lib/map-shell/<session>/ among them — so a non-root
# image user fails the very first bash tool call with "target cannot be
# written: Permission denied", and the session hangs rather than erroring out.
# Chowning /mnt/session at build time does not help either: the writable paths
# are runtime mounts, which replace whatever the image put there.
#
# The container is the security boundary here, and the sandbox is disposable
# and per-session. Where a deployment does want a non-root sandbox, that is the
# platform's call and it has a knob for it — a hardening `run_as_user` sets the
# container's user at runtime, alongside the capability drops and pid/CPU caps
# it already applies — because only the platform knows who owns those mounts.
FROM python:3.12-slim

# python-pptx writes the deck; Pillow and matplotlib back the later workshop
# rounds that add images and generated diagrams to slides.
RUN pip install --no-cache-dir python-pptx pillow matplotlib

# The rendering half of the eval runs on the host (the cwc-pptx-render image),
# not in here — the sandbox only needs to produce the .pptx.
