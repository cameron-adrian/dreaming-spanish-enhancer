#!/bin/bash
# Loads Cameron's global Claude Code preferences (cameron-adrian/claude-config)
# into this session's user memory.
#
# On Cameron's own machine, ~/.claude/CLAUDE.md is already a symlink into a
# local clone of claude-config, kept fresh by that repo's own SessionStart
# hook — so this is a no-op there. This hook exists for environments that
# don't have that symlink, chiefly Claude Code on the web / other ephemeral
# remote sessions, where each container starts with no user-level memory.
#
# Fail-quiet by design (no network, no git, no credentials for the private
# claude-config repo, diverged history, etc. all exit clean) so a sync
# failure here never blocks session startup.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -f "$HOME/.claude/CLAUDE.md" ] && [ ! -L "$HOME/.claude/CLAUDE.md" ]; then
  # Already populated by something else on this machine (e.g. a real
  # symlink setup) — don't clobber it.
  exit 0
fi

command -v git >/dev/null 2>&1 || exit 0

CONFIG_DIR="$HOME/.claude-config-global"

if [ -d "$CONFIG_DIR/.git" ]; then
  git -C "$CONFIG_DIR" pull --ff-only --quiet 2>/dev/null || true
else
  rm -rf "$CONFIG_DIR"
  git clone --depth 1 --quiet https://github.com/cameron-adrian/claude-config "$CONFIG_DIR" 2>/dev/null || true
fi

if [ -f "$CONFIG_DIR/CLAUDE.md" ]; then
  mkdir -p "$HOME/.claude"
  cp "$CONFIG_DIR/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
fi

exit 0
