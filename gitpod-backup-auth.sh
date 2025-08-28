# Create backup to restore auth data after workspace is stoped (to not login again all the time)

# Verify login status
gh auth status

# Save GitHub auth into persisted workspace folder
mkdir -p /workspace/.persisted-configs
cp -r ~/.config/gh /workspace/.persisted-configs/

# Verify it's saved
GH_CONFIG_BACKUP=/workspace/.persisted-configs/gh/hosts.yml
[ -f "$GH_CONFIG_BACKUP" ] && echo "✅ Saved to $GH_CONFIG_BACKUP" || echo "❌ Save failed"

# Save Claude auth/config into persisted workspace folder
mkdir -p /workspace/.persisted-configs
cp -r ~/.claude /workspace/.persisted-configs/

# Verify it's saved
CLAUDE_CONFIG_BACKUP=/workspace/.persisted-configs/.claude/.credentials.json
[ -f "$CLAUDE_CONFIG_BACKUP" ] && echo "✅ Saved to $CLAUDE_CONFIG_BACKUP" || echo "❌ Save failed"