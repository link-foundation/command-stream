# Create backup to restore auth data after workspace is stopped (to not login again all the time)

# --- GitHub backup ---
# Verify login status
gh auth status

# Save GitHub auth into persisted workspace folder
mkdir -p /workspace/.persisted-configs
cp -r ~/.config/gh /workspace/.persisted-configs/

# Verify it's saved & list files
GH_CONFIG_BACKUP=/workspace/.persisted-configs/gh/hosts.yml
[ -f "$GH_CONFIG_BACKUP" ] && echo "✅ GitHub saved" || echo "❌ GitHub save failed"
echo "📂 GitHub backup files:"
ls -R /workspace/.persisted-configs/gh

# --- Claude backup ---
# Save Claude auth/config into persisted workspace folder
mkdir -p /workspace/.persisted-configs
cp -r ~/.claude /workspace/.persisted-configs/ 2>/dev/null || true
cp -r ~/.claude.json /workspace/.persisted-configs/ 2>/dev/null || true
cp -r ~/.claude.json.backup /workspace/.persisted-configs/ 2>/dev/null || true

# Verify it's saved & list files
CLAUDE_CRED_BACKUP=/workspace/.persisted-configs/.claude/.credentials.json
[ -f "$CLAUDE_CRED_BACKUP" ] && echo "✅ Claude credentials saved" || echo "❌ Claude credentials save failed"

echo "📂 Claude backup files:"
ls -R /workspace/.persisted-configs/.claude 2>/dev/null || echo "(no .claude folder)"
[ -f /workspace/.persisted-configs/.claude.json ] && echo " - .claude.json found"
[ -f /workspace/.persisted-configs/.claude.json.backup ] && echo " - .claude.json.backup found"