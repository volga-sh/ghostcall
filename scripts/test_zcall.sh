#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

forge build --root "${ROOT_DIR}"
python3 "${ROOT_DIR}/scripts/test_zcall.py"
