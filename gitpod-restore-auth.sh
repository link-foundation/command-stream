# Restore backup of auth data after stopped workspace is restarted (to not login again all the time)

# --- Claude restore ---
mkdir -p ~/.claude
mkdir -p /workspace/.persisted-configs/.claude # To not fail on missing folder

# Restore Claude credentials
cp -r /workspace/.persisted-configs/.claude ~/.claude 2>/dev/null || true
cp -f /workspace/.persisted-configs/.claude.json ~ 2>/dev/null || true
cp -f /workspace/.persisted-configs/.claude.json.backup ~ 2>/dev/null || true

CLAUDE_CRED=~/.claude/.credentials.json
[ -f "$CLAUDE_CRED" ] && echo "✅ Claude credentials restored" || echo "❌ Claude credentials missing"

echo "📂 Claude files in ~/.claude:"
ls -a ~/.claude 2>/dev/null || echo "(none)"
[ -f ~/.claude.json ] && echo " - .claude.json present"
[ -f ~/.claude.json.backup ] && echo " - .claude.json.backup present"

# --- GitHub restore ---
mkdir -p ~/.config
mkdir -p /workspace/.persisted-configs/gh # To not fail on missing folder

cp -r /workspace/.persisted-configs/gh ~/.config/ 2>/dev/null || true

GH_CONFIG=~/.config/gh/hosts.yml
[ -f "$GH_CONFIG" ] && echo "✅ GitHub credentials restored" || echo "❌ GitHub credentials missing"

echo "📂 GitHub files in ~/.config/gh:"
ls -a ~/.config/gh 2>/dev/null || echo "(none)"

# --- Verify GitHub login status ---
echo "🔄 Verify GitHub login status"
gh auth status