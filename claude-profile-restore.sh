#!/bin/bash
# Restore Claude auth/config from a named profile

PROFILE_NAME="$1"
if [ -z "$PROFILE_NAME" ]; then
    echo "Usage: $0 <profile_name>"
    echo ""
    echo "Available profiles:"
    PROFILES_DIR="/workspace/.persisted-configs/claude-profiles"
    if [ -d "$PROFILES_DIR" ]; then
        ls -1 "$PROFILES_DIR" | sed 's/^/  - /'
    else
        echo "  (no profiles found)"
    fi
    exit 1
fi

# Check if profile exists
PROFILES_DIR="/workspace/.persisted-configs/claude-profiles"
PROFILE_DIR="$PROFILES_DIR/$PROFILE_NAME"

if [ ! -d "$PROFILE_DIR" ]; then
    echo "❌ Profile '$PROFILE_NAME' not found"
    echo ""
    echo "Available profiles:"
    if [ -d "$PROFILES_DIR" ]; then
        ls -1 "$PROFILES_DIR" | sed 's/^/  - /'
    else
        echo "  (no profiles found)"
    fi
    exit 1
fi

echo "📦 Restoring Claude profile: $PROFILE_NAME"

# Create ~/.claude directory
mkdir -p ~/.claude

# Show what's available in the profile before restore
echo "📂 Files available in profile '$PROFILE_NAME':"
ls -la "$PROFILE_DIR/" 2>/dev/null || echo "(none at root)"
echo "📂 Files in profile's .claude subdirectory:"
ls -la "$PROFILE_DIR/.claude/" 2>/dev/null || echo "(none in .claude)"

# Restore Claude directory contents
if [ -d "$PROFILE_DIR/.claude" ]; then
    cp -r "$PROFILE_DIR/.claude"/* ~/.claude/ 2>/dev/null || true
    echo "📂 Restored .claude directory contents"
fi

# Restore credentials file specifically
if [ -f "$PROFILE_DIR/.claude/.credentials.json" ]; then
    cp "$PROFILE_DIR/.claude/.credentials.json" ~/.claude/
    echo "🔑 Restored credentials file"
fi

# Restore root-level Claude config files
if [ -f "$PROFILE_DIR/.claude.json" ]; then
    cp "$PROFILE_DIR/.claude.json" ~/
    echo "📄 Restored ~/.claude.json"
fi

if [ -f "$PROFILE_DIR/.claude.json.backup" ]; then
    cp "$PROFILE_DIR/.claude.json.backup" ~/
    echo "📄 Restored ~/.claude.json.backup"
fi

# Verify restore was successful
CRED_FILE=~/.claude/.credentials.json
if [ -f "$CRED_FILE" ]; then
    echo "✅ Profile '$PROFILE_NAME' restored successfully"
else
    echo "❌ Profile restore may have failed - no credentials found"
fi

# Show what was restored (same style as backup)
echo "📂 Claude files in ~/.claude after restore:"
ls -la ~/.claude 2>/dev/null || echo "(none)"
[ -f ~/.claude.json ] && echo "📄 ~/.claude.json present"
[ -f ~/.claude.json.backup ] && echo "📄 ~/.claude.json.backup present"

echo ""
echo "💡 To save current state as a profile, run:"
echo "   ./claude-profile-save.sh <profile_name>"