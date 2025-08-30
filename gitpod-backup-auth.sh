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
mkdir -p /workspace/.persisted-configs/.claude
mkdir -p /workspace/.persisted-configs/claude-code

# Copy main Claude files
cp -r ~/.claude/* /workspace/.persisted-configs/.claude/ 2>/dev/null || true
cp -r ~/.config/claude-code/* /workspace/.persisted-configs/claude-code/ 2>/dev/null || true

# Also copy root-level hidden files if they exist
[ -f ~/.claude/.credentials.json ] && cp ~/.claude/.credentials.json /workspace/.persisted-configs/.claude/
[ -f ~/.claude.json ] && cp ~/.claude.json /workspace/.persisted-configs/
[ -f ~/.claude.json.backup ] && cp ~/.claude.json.backup /workspace/.persisted-configs/

# Verify it's saved & list files
CLAUDE_CRED_BACKUP=/workspace/.persisted-configs/.claude/.credentials.json
CLAUDE_CFG_BACKUP=/workspace/.persisted-configs/claude-code/auth.json
[ -f "$CLAUDE_CRED_BACKUP" ] && echo "✅ Claude credentials saved" || echo "❌ Claude credentials save failed"
[ -f "$CLAUDE_CFG_BACKUP" ] && echo "✅ Claude config saved" || echo "❌ Claude config save failed"
echo "📂 Claude backup files:"
ls -R /workspace/.persisted-configs/.claude
ls -R /workspace/.persisted-configs/claude-code
[ -f /workspace/.persisted-configs/.claude.json ] && echo " - .claude.json found"
[ -f /workspace/.persisted-configs/.claude.json.backup ] && echo " - .claude.json.backup found"