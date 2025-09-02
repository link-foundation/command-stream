#!/bin/bash
# List all saved Claude profiles

PROFILES_DIR="/workspace/.persisted-configs/claude-profiles"

echo "📋 Saved Claude Profiles:"
echo ""

if [ ! -d "$PROFILES_DIR" ]; then
    echo "  (no profiles directory found)"
    echo ""
    echo "💡 To save your first profile, run:"
    echo "   ./claude-profile-save.sh <profile_name>"
    exit 0
fi

# Check if any profiles exist
PROFILE_COUNT=$(ls -1 "$PROFILES_DIR" 2>/dev/null | wc -l)
if [ "$PROFILE_COUNT" -eq 0 ]; then
    echo "  (no profiles saved yet)"
    echo ""
    echo "💡 To save your first profile, run:"
    echo "   ./claude-profile-save.sh <profile_name>"
    exit 0
fi

# List profiles with details
for profile in "$PROFILES_DIR"/*; do
    if [ -d "$profile" ]; then
        profile_name=$(basename "$profile")
        cred_file="$profile/.claude/.credentials.json"
        config_file="$profile/.claude.json"
        
        echo "  📁 $profile_name"
        
        # Show what's in this profile
        if [ -f "$cred_file" ]; then
            echo "     🔑 credentials present"
        fi
        
        if [ -f "$config_file" ]; then
            echo "     ⚙️  config present"
        fi
        
        # Show file count
        file_count=$(find "$profile" -type f 2>/dev/null | wc -l)
        echo "     📊 $file_count files total"
        
        # Show last modified
        if command -v stat >/dev/null 2>&1; then
            last_mod=$(stat -c %y "$profile" 2>/dev/null | cut -d' ' -f1)
            [ -n "$last_mod" ] && echo "     📅 saved: $last_mod"
        fi
        
        echo ""
    fi
done

echo "💡 Usage:"
echo "   ./claude-profile-restore.sh <profile_name>  # Restore a profile"
echo "   ./claude-profile-save.sh <profile_name>     # Save current state"