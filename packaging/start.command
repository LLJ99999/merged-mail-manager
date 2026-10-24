#!/usr/bin/env bash
# macOS：双击即可在“终端”中启动（首次如被拦截，见 README 的 Gatekeeper 说明）
cd "$(dirname "$0")"
exec ./start.sh "$@"
