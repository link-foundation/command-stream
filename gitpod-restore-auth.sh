# Restore backup of auth data after stopped workspace is restarted (to not login again all the time)

# Restore Claude auth/config from persisted folder
mkdir -p ~/
mkdir -p /workspace/.persisted-configs/.claude # To not fail on missing folder
cp -r /workspace/.persisted-configs/.claude ~/
echo "🔄 Claude files restored:"
ls -a ~/.claude/

# Restore GitHub auth from persisted folder
mkdir -p ~/.config
mkdir -p /workspace/.persisted-configs/gh # To not fail on missing folder
cp -r /workspace/.persisted-configs/gh ~/.config/
echo "🔄 GitHub auth files restored:"
ls -a ~/.config/gh

# Verify login status
echo "🔄 Verify GitHub login status"
gh auth status