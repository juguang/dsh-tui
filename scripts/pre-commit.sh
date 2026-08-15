#!/bin/sh
# dsh-tui pre-commit hook: scan the staged diff for secrets and personal
# paths before allowing a commit.
#
# Zero-dependency: plain POSIX sh + grep. Scans only what is about to be
# committed (`git diff --cached`), never the whole worktree.
#
# To bypass (use sparingly):  git commit --no-verify
#
# Patterns are deliberately conservative: they flag probable secrets and the
# known personal-identifying paths, not every string that looks key-like.

set -u

# ANSI colors, guarded for non-TTY.
if [ -t 1 ]; then
  RED=$'\033[31m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  RED=''; YELLOW=''; RESET=''
fi

STAGED="$(git diff --cached -U0 2>/dev/null)"

# The hook's own pattern definitions live in this script; scanning them would
# match its own /Users/ regexes (a self-referential false positive). Drop this
# file's hunks from the staged scan.
STAGED="$(printf '%s\n' "$STAGED" \
  | awk '/^diff --git a\/scripts\/pre-commit\.sh/{skip=1; next} /^diff --git/{skip=0} !skip')"

# Exit 0 (allow) when nothing is staged.
if [ -z "$STAGED" ]; then
  exit 0
fi

# (pattern, description) pairs; each pattern is an extended regex.
scan() {
  # 1. Secret/token patterns.
  #    DeepSeek/OpenAI-style keys, GitHub tokens, AWS keys, generic key=.
  SECRETS='sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["'"'"'][A-Za-z0-9_\-+/=]{12,}'

  # 2. Personal-identifying paths (the author's macOS home).
  PERSONAL='/Users/[A-Za-z0-9_]+/|/home/[A-Za-z0-9_]+/[A-Za-z0-9_]+|/Users/spark'

  # 3. Credential file names.
  CRED_FILES='\.env(\.[a-z]+)?$|\.pem$|\.p12$|\.pfx$|credentials\.ya?ml$|\.npmrc$'

  echo "$STAGED" \
    | grep -nE "$SECRETS" \
    && echo "${RED}✗ pre-commit: probable secret/token found in staged changes${RESET}" \
    && return 1

  echo "$STAGED" \
    | grep -nE "$PERSONAL" \
    && echo "${RED}✗ pre-commit: personal path (e.g. /Users/<name>) found in staged changes${RESET}" \
    && return 1

  # 4. Staged filenames that look like credential stores.
  if echo "$STAGED" | grep -E "^(diff --git|new file|rename).*($CRED_FILES)" >/dev/null; then
    echo "${RED}✗ pre-commit: credential-file name staged (.env/.pem/.npmrc/…)${RESET}"
    return 1
  fi

  return 0
}

if scan; then
  exit 0
else
  echo "${YELLOW}→ 如确属误报，用 ${RESET}git commit --no-verify${YELLOW} 绕过，或调整脚本中的模式。${RESET}"
  exit 1
fi
