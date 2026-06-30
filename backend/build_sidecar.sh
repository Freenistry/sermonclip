#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Detect or accept target triple
# ---------------------------------------------------------------------------
if [ -n "${1:-}" ]; then
    TARGET_TRIPLE="$1"
else
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Darwin)
            case "$ARCH" in
                arm64)  TARGET_TRIPLE="aarch64-apple-darwin" ;;
                x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
                *)      echo "Unsupported macOS architecture: $ARCH"; exit 1 ;;
            esac
            ;;
        Linux)
            TARGET_TRIPLE="x86_64-unknown-linux-gnu"
            ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT)
            TARGET_TRIPLE="x86_64-pc-windows-msvc"
            ;;
        *)
            echo "Unsupported OS: $OS"; exit 1
            ;;
    esac
fi

echo "==> Target triple: $TARGET_TRIPLE"

# ---------------------------------------------------------------------------
# Activate venv if it exists
# ---------------------------------------------------------------------------
if [ -d "venv" ]; then
    echo "==> Activating venv"
    source venv/bin/activate
fi

# ---------------------------------------------------------------------------
# Install requirements
# ---------------------------------------------------------------------------
echo "==> Installing requirements"
pip install -r requirements.txt

# ---------------------------------------------------------------------------
# Run PyInstaller
# ---------------------------------------------------------------------------
echo "==> Running PyInstaller"
pyinstaller --clean --noconfirm sermonclip-api.spec

# ---------------------------------------------------------------------------
# Determine output binary name
# ---------------------------------------------------------------------------
EXT=""
case "$TARGET_TRIPLE" in
    *windows*) EXT=".exe" ;;
esac

SRC="dist/sermonclip-api${EXT}"
DEST_DIR="../desktop/src-tauri/binaries"
DEST="$DEST_DIR/sermonclip-api-${TARGET_TRIPLE}${EXT}"

if [ ! -f "$SRC" ]; then
    echo "ERROR: Build output not found at $SRC"
    exit 1
fi

# ---------------------------------------------------------------------------
# Copy to Tauri binaries directory
# ---------------------------------------------------------------------------
echo "==> Copying binary to $DEST"
mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
chmod +x "$DEST"

echo "==> Build complete: $DEST"
echo "    Size: $(du -h "$DEST" | cut -f1)"
