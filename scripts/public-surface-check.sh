#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

failures=0

fail() {
  printf 'public-surface-check: %s\n' "$1" >&2
  failures=1
}

check_commit_message_file() {
  local file="$1"
  local coauthor_label='Co-authored''-by'
  if grep -Eiq "^[[:space:]]*${coauthor_label}:" "$file"; then
    fail "commit message contains an external coauthor trailer; keep Steeped commits attributed to the repo owner only"
  fi
}

if [[ "${1:-}" == "--commit-msg" ]]; then
  check_commit_message_file "${2:?missing commit message path}"
  exit "$failures"
fi

coauthor_label='Co-authored''-by'
if git log --format='%B' | grep -Eiq "^[[:space:]]*${coauthor_label}:"; then
  fail "git history contains external coauthor trailers"
fi

if git ls-files | grep -Eq '(^|/)(A[G]ENTS|C[L]AUDE)\.md$'; then
  fail "agent-only markdown files are tracked; keep them local-only"
fi

if git ls-files | grep -Eq '(^|/)\.DS_Store$|(^|/)__pycache__/|\.pyc$|\.zip$'; then
  fail "generated or packaged artifacts are tracked"
fi

if git ls-files | grep -Eq '^(TODO\.md|design/|\.codex/)'; then
  fail "local launch/design workspace files are tracked; keep the public repo product-only"
fi

public_paths=(
  README.md
  PRIVACY.md
  TERMS.md
  manifest.json
  docs
  src/panel
  src/settings
)

stale_voice_pattern='extract the essence|long pages|long page|long tab|calm summaries|dense pages|let the page settle|lets the page settle|small reader|short, sourced|current tab|long-page'
if grep -RInE "$stale_voice_pattern" "${public_paths[@]}" 2>/dev/null; then
  fail "stale public copy found; use the current Steeped voice"
fi

readme_private_pattern='TODO\.md|LAUNCH-CHECKLIST|PROVIDER-ROADMAP|Development Priorities|Current scope|Post-launch|Managed-key tier|Team and sync|supporter extras'
if grep -InE "$readme_private_pattern" README.md; then
  fail "README contains private roadmap or launch-planning language"
fi

private_public_terms=(
  'Co-authored''-by'
  'generated ''by'
  'A''I-assisted'
  'A''I contributor'
  'tool''-assisted'
  'tool ''contributor'
  'Co''dex'
  'Ca''irn'
  'hand''off'
  'contin''uity'
  'B''ob'
  'rmcco''ok@gm''ail''.com'
  'steeped.privacy@gm''ail''.com'
)
for term in "${private_public_terms[@]}"; do
  if grep -RInFi -- "$term" "${public_paths[@]}" 2>/dev/null; then
    fail "public files contain private launch, owner, or tool-attribution language"
  fi
done

if ! python3 - <<'PY'
from pathlib import Path
import struct

path = Path("docs/social-card.png")
if not path.exists():
    raise SystemExit(1)
data = path.read_bytes()
if data[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit(1)
width, height, bit_depth, color_type = struct.unpack(">IIBB", data[16:26])
if (width, height, bit_depth, color_type) != (1600, 900, 8, 2):
    raise SystemExit(1)
PY
then
  fail "docs/social-card.png must be a 1600x900 24-bit RGB PNG"
fi

if ! grep -q 'Big reads, small notes' docs/index.html; then
  fail "homepage is missing the current hero line"
fi

if ! grep -q './legal.css' docs/privacy.html || ! grep -q './legal.css' docs/terms.html; then
  fail "privacy and terms pages must use the current legal page styling"
fi

if grep -Eq 'Onest|#07101C|--bg-surface|text-secondary' docs/privacy.html docs/terms.html; then
  fail "privacy or terms page still contains old dark-page styling"
fi

if ! node scripts/check-site-links.mjs --local-only; then
  fail "site link check failed"
fi

if (( failures )); then
  exit 1
fi

printf 'public-surface-check: OK\n'
