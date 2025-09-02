#!/bin/bash
# Save Claude auth/config to a named profile

PROFILE_NAME="$1"
if [ -z "$PROFILE_NAME" ]; then
    echo "Usage: $0 <profile_name>"
    echo "Example: $0 work"
    echo "Example: $0 personal"
    exit 1
fi

# Create profiles directory structure
PROFILES_DIR="/workspace/.persisted-configs/claude-profiles"
PROFILE_DIR="$PROFILES_DIR/$PROFILE_NAME"
mkdir -p "$PROFILE_DIR/.claude"

echo "💾 Saving Claude profile: $PROFILE_NAME"

# Copy Claude directory contents
if [ -d ~/.claude ]; then
    cp -r ~/.claude/* "$PROFILE_DIR/.claude/" 2>/dev/null || true
    echo "📂 Copied ~/.claude/* to profile"
else
    echo "⚠️  ~/.claude directory not found"
fi

# Copy credentials file specifically (in case it wasn't caught above)
if [ -f ~/.claude/.credentials.json ]; then
    cp ~/.claude/.credentials.json "$PROFILE_DIR/.claude/"
    echo "🔑 Copied credentials file"
fi

# Copy root-level Claude config files
if [ -f ~/.claude.json ]; then
    cp ~/.claude.json "$PROFILE_DIR/"
    echo "📄 Copied ~/.claude.json"
fi

if [ -f ~/.claude.json.backup ]; then
    cp ~/.claude.json.backup "$PROFILE_DIR/"
    echo "📄 Copied ~/.claude.json.backup"
fi

# Verify save was successful
CRED_FILE="$PROFILE_DIR/.claude/.credentials.json"
if [ -f "$CRED_FILE" ]; then
    echo "✅ Profile '$PROFILE_NAME' saved successfully"
else
    echo "❌ Profile save may have failed - no credentials found"
fi

# Show what was saved
echo "📂 Files saved in profile '$PROFILE_NAME':"
ls -la "$PROFILE_DIR/" 2>/dev/null || echo "(none at root)"
echo "📂 Files in .claude subdirectory:"
ls -la "$PROFILE_DIR/.claude/" 2>/dev/null || echo "(none in .claude)"

echo ""
echo "💡 To restore this profile later, run:"
echo "   ./claude-profile-restore.sh $PROFILE_NAME"