# PyInstaller Sidecar Bundling & Distribution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package SermonClip as a self-contained desktop app that anyone can install and run — no Python, no terminal, no dev setup.

**Architecture:** Bundle the FastAPI backend as a PyInstaller executable that Tauri launches as a sidecar. On first run, a setup screen detects missing system dependencies (FFmpeg, Ollama) and offers one-click install. GitHub Actions builds platform-specific installers (.dmg, .msi, .AppImage).

**Tech Stack:** PyInstaller, Tauri 2 sidecar/shell plugin, GitHub Actions, tauri-action, Homebrew/winget/apt (for dependency install)

---

## Context

**Current state:** The desktop app works in dev mode — Tauri launches a Python venv backend via `tauri-plugin-shell`. But distributing requires:
1. Users don't have Python/venv — bundle the backend as a native executable
2. Users don't have FFmpeg/Ollama — detect and help install on first run
3. Building for 3 platforms — CI/CD pipeline with GitHub Actions
4. Supabase — currently local dev instance, needs cloud instance for production

**Key files:**
- `backend/main.py` — FastAPI entry point
- `backend/requirements.txt` — Python deps (fastapi, uvicorn, mlx-whisper, supabase, pytubefix, etc.)
- `desktop/src-tauri/src/lib.rs` — Sidecar launch logic (currently runs `venv/bin/python -m uvicorn`)
- `desktop/src-tauri/tauri.conf.json` — Bundle config
- `desktop/src-tauri/Cargo.toml` — Rust deps

**Platform constraints:**
- Whisper MLX only works on Apple Silicon (macOS ARM64)
- On Windows/Linux, transcription needs an alternative (openai-whisper or whisper.cpp) — **out of scope for this plan**, we'll skip transcription on non-macOS for now
- Ollama is optional — quotes extraction gracefully degrades if unavailable

---

## Task 1: Create PyInstaller Spec for the Backend

**Goal:** Bundle the entire FastAPI backend into a single executable.

**Files:**
- Create: `backend/sermonclip-api.spec`
- Create: `backend/build_sidecar.sh`
- Modify: `backend/requirements.txt` (add pyinstaller)

**Step 1: Add PyInstaller to requirements**

Add to the end of `backend/requirements.txt`:

```
pyinstaller==6.13.0
```

**Step 2: Create the PyInstaller spec file**

Create `backend/sermonclip-api.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all submodules for packages that use dynamic imports
hidden_imports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "httptools",
    "dotenv",
    "supabase",
    "gotrue",
    "postgrest",
    "storage3",
    "realtime",
    "httpx",
    "langdetect",
    "PIL",
    "multipart",
]

# Collect data files needed at runtime
datas = [
    ("assets", "assets"),
]

# Add langdetect profiles (required at runtime)
datas += collect_data_files("langdetect")

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports + collect_submodules("supabase"),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "numpy.testing",
        "scipy",
        "pytest",
    ],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="sermonclip-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    target_arch=None,
)
```

**Step 3: Create the build script**

Create `backend/build_sidecar.sh`:

```bash
#!/bin/bash
set -euo pipefail

# Build the FastAPI backend as a single executable using PyInstaller
# Usage: ./build_sidecar.sh [target-triple]
# Example: ./build_sidecar.sh aarch64-apple-darwin

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Determine target triple
if [ -n "${1:-}" ]; then
  TARGET_TRIPLE="$1"
else
  # Auto-detect
  ARCH=$(uname -m)
  OS=$(uname -s)
  case "$OS" in
    Darwin)
      case "$ARCH" in
        arm64) TARGET_TRIPLE="aarch64-apple-darwin" ;;
        x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
      esac
      ;;
    Linux)
      TARGET_TRIPLE="x86_64-unknown-linux-gnu"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      TARGET_TRIPLE="x86_64-pc-windows-msvc"
      ;;
  esac
fi

echo "Building sidecar for target: $TARGET_TRIPLE"

# Activate venv if it exists
if [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
elif [ -f "venv/Scripts/activate" ]; then
  source venv/Scripts/activate
fi

# Install deps if needed
pip install -r requirements.txt --quiet

# Run PyInstaller
pyinstaller sermonclip-api.spec --distpath dist --clean --noconfirm

# Copy to Tauri sidecar location with target triple suffix
SIDECAR_DIR="../desktop/src-tauri/binaries"
mkdir -p "$SIDECAR_DIR"

if [[ "$TARGET_TRIPLE" == *"windows"* ]]; then
  cp dist/sermonclip-api.exe "$SIDECAR_DIR/sermonclip-api-${TARGET_TRIPLE}.exe"
else
  cp dist/sermonclip-api "$SIDECAR_DIR/sermonclip-api-${TARGET_TRIPLE}"
fi

echo "Sidecar built: $SIDECAR_DIR/sermonclip-api-${TARGET_TRIPLE}"
```

**Step 4: Make the build script executable and test**

Run:
```bash
chmod +x backend/build_sidecar.sh
cd backend && ./build_sidecar.sh
```

Expected: Creates `desktop/src-tauri/binaries/sermonclip-api-aarch64-apple-darwin` (on Apple Silicon Mac).

**Step 5: Verify the bundled executable starts**

Run:
```bash
./desktop/src-tauri/binaries/sermonclip-api-aarch64-apple-darwin
```

Expected: Uvicorn starts on port 8000, API responds to `curl http://127.0.0.1:8000/docs`.

**Step 6: Commit**

```bash
git add backend/sermonclip-api.spec backend/build_sidecar.sh backend/requirements.txt
git commit -m "feat: add PyInstaller spec and build script for sidecar bundling"
```

---

## Task 2: Switch Tauri to Use Sidecar Binary Instead of Python Venv

**Goal:** In production builds, launch the PyInstaller binary instead of `venv/bin/python`. Keep venv mode for dev.

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json` (add `externalBin`)
- Modify: `desktop/src-tauri/src/lib.rs` (sidecar launch logic)
- Modify: `desktop/src-tauri/capabilities/default.json` (add shell:allow-spawn permission)

**Step 1: Add externalBin to tauri.conf.json**

Add `"externalBin"` to the `"bundle"` section of `desktop/src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/sermonclip-api"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**Step 2: Add shell sidecar permission to capabilities**

In `desktop/src-tauri/capabilities/default.json`, add the sidecar execution permission:

```json
{
  "permissions": [
    "core:default",
    "dialog:default",
    "notification:default",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify",
    "fs:default",
    {
      "identifier": "fs:allow-read-file",
      "allow": [{ "path": "**" }]
    },
    {
      "identifier": "fs:allow-write-file",
      "allow": [{ "path": "$DOWNLOAD/**" }, { "path": "$DOCUMENT/**" }, { "path": "$DESKTOP/**" }, { "path": "$HOME/**" }]
    },
    "shell:allow-spawn",
    "shell:allow-kill",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "binaries/sermonclip-api", "sidecar": true }]
    }
  ]
}
```

**Step 3: Update lib.rs to use sidecar in production, venv in dev**

Replace the backend launch logic in `desktop/src-tauri/src/lib.rs` (lines 24-67):

```rust
      // Launch backend: sidecar binary in production, Python venv in dev
      let spawn_result = if cfg!(debug_assertions) {
        // Dev mode: use Python venv directly
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let backend_dir = manifest_dir.join("../../backend").canonicalize().unwrap_or_else(|_| {
          std::env::current_dir()
            .unwrap_or_default()
            .join("../backend")
        });

        let venv_python = backend_dir.join("venv/bin/python");
        if !venv_python.exists() {
          log::warn!("Backend venv not found at {:?}, skipping sidecar launch", venv_python);
          return Ok(());
        }

        log::info!("Starting backend from venv: {:?}", backend_dir);

        app
          .shell()
          .command(venv_python.to_string_lossy().to_string())
          .args(["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"])
          .current_dir(backend_dir)
          .spawn()
      } else {
        // Production: use bundled sidecar binary
        log::info!("Starting bundled backend sidecar");

        app
          .shell()
          .sidecar("sermonclip-api")
          .expect("failed to create sidecar command")
          .args(["--host", "127.0.0.1", "--port", "8000"])
          .spawn()
      };

      let (mut rx, child) = match spawn_result {
        Ok(result) => result,
        Err(e) => {
          log::error!("Failed to start backend server: {}", e);
          return Ok(());
        }
      };
```

Note: The sidecar binary needs to accept `--host` and `--port` args. We'll handle that in Task 3.

**Step 4: Verify dev mode still works**

Run:
```bash
cd desktop && source ~/.cargo/env && npx tauri dev
```

Expected: App opens, backend starts from venv, API works.

**Step 5: Commit**

```bash
git add desktop/src-tauri/tauri.conf.json desktop/src-tauri/capabilities/default.json desktop/src-tauri/src/lib.rs
git commit -m "feat: switch to sidecar binary for production, keep venv for dev"
```

---

## Task 3: Make the Backend Accept CLI Arguments

**Goal:** The PyInstaller binary needs to accept `--host` and `--port` CLI args (since it won't use `uvicorn` CLI directly).

**Files:**
- Modify: `backend/main.py` (add `__main__` block with argparse)

**Step 1: Add CLI entry point to main.py**

Add at the bottom of `backend/main.py`:

```python
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SermonClip API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    args = parser.parse_args()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
```

**Step 2: Test the CLI entry point**

Run:
```bash
cd backend && ./venv/bin/python main.py --host 127.0.0.1 --port 8000
```

Expected: Server starts on port 8000.

**Step 3: Rebuild sidecar and test with args**

Run:
```bash
cd backend && ./build_sidecar.sh
../desktop/src-tauri/binaries/sermonclip-api-aarch64-apple-darwin --host 127.0.0.1 --port 8000
```

Expected: Server starts and responds to requests.

**Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat: add CLI argument parsing for sidecar mode"
```

---

## Task 4: First-Run Dependency Detection & Setup Screen

**Goal:** When the app launches, check if FFmpeg and Ollama are installed. If not, show a setup screen with install instructions/buttons.

**Files:**
- Create: `desktop/src/components/setup/DependencyCheck.tsx`
- Create: `desktop/src/hooks/useDependencyCheck.ts`
- Modify: `desktop/src/App.tsx` (or main layout) to show setup screen when deps missing

**Step 1: Create the dependency check hook**

Create `desktop/src/hooks/useDependencyCheck.ts`:

```typescript
import { useState, useEffect } from "react";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface DependencyStatus {
  ffmpeg: boolean | null;
  ollama: boolean | null;
  whisper: boolean | null;
  loading: boolean;
  allRequired: boolean; // true if all required deps are met
}

export function useDependencyCheck(): DependencyStatus {
  const [status, setStatus] = useState<DependencyStatus>({
    ffmpeg: null,
    ollama: null,
    whisper: null,
    loading: true,
    allRequired: false,
  });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const response = await fetch(`${API_URL}/health/dependencies`);
        if (!response.ok) throw new Error("Health check failed");
        const data = await response.json();

        if (!cancelled) {
          setStatus({
            ffmpeg: data.ffmpeg ?? false,
            ollama: data.ollama ?? false,
            whisper: data.whisper ?? false,
            loading: false,
            allRequired: data.ffmpeg === true,
          });
        }
      } catch {
        if (!cancelled) {
          setStatus((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    // Retry a few times — backend sidecar may still be starting
    let attempts = 0;
    const maxAttempts = 10;

    const tryCheck = () => {
      check().catch(() => {
        attempts++;
        if (attempts < maxAttempts && !cancelled) {
          setTimeout(tryCheck, 1500);
        }
      });
    };

    tryCheck();
    return () => { cancelled = true; };
  }, []);

  return status;
}
```

**Step 2: Add the health endpoint to the backend**

Create or modify `backend/routers/health.py`:

```python
from fastapi import APIRouter
import shutil

router = APIRouter(prefix="/health", tags=["health"])

@router.get("/dependencies")
async def check_dependencies():
    """Check which system dependencies are available."""
    ffmpeg_available = shutil.which("ffmpeg") is not None

    ollama_available = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            ollama_available = resp.status_code == 200
    except Exception:
        pass

    whisper_available = False
    try:
        import mlx_whisper  # noqa: F401
        whisper_available = True
    except ImportError:
        pass

    return {
        "ffmpeg": ffmpeg_available,
        "ollama": ollama_available,
        "whisper": whisper_available,
    }
```

Register the router in `backend/main.py`:

```python
from routers import health
app.include_router(health.router)
```

**Step 3: Create the dependency check UI component**

Create `desktop/src/components/setup/DependencyCheck.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";

interface DependencyCheckProps {
  ffmpeg: boolean | null;
  ollama: boolean | null;
  whisper: boolean | null;
  loading: boolean;
  onContinue: () => void;
  onRecheck: () => void;
}

const INSTALL_LINKS: Record<string, { mac: string; windows: string; linux: string; label: string }> = {
  ffmpeg: {
    mac: "https://formulae.brew.sh/formula/ffmpeg",
    windows: "https://www.gyan.dev/ffmpeg/builds/",
    linux: "https://ffmpeg.org/download.html",
    label: "Install FFmpeg",
  },
  ollama: {
    mac: "https://ollama.com/download/mac",
    windows: "https://ollama.com/download/windows",
    linux: "https://ollama.com/download/linux",
    label: "Install Ollama",
  },
};

function getPlatformLink(dep: string): string {
  const links = INSTALL_LINKS[dep];
  if (!links) return "";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return links.mac;
  if (platform.includes("win")) return links.windows;
  return links.linux;
}

function StatusIcon({ status }: { status: boolean | null }) {
  if (status === null) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (status) return <CheckCircle className="h-5 w-5 text-green-500" />;
  return <XCircle className="h-5 w-5 text-red-500" />;
}

export function DependencyCheck({
  ffmpeg,
  ollama,
  whisper,
  loading,
  onContinue,
  onRecheck,
}: DependencyCheckProps) {
  const deps = [
    { key: "ffmpeg", label: "FFmpeg", status: ffmpeg, required: true, description: "Required for video/audio processing" },
    { key: "ollama", label: "Ollama", status: ollama, required: false, description: "Optional — enables AI quote extraction" },
    { key: "whisper", label: "Whisper MLX", status: whisper, required: false, description: "Optional — enables local transcription (Apple Silicon only)" },
  ];

  const requiredMet = ffmpeg === true;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">SermonClip Setup</CardTitle>
          <p className="text-sm text-muted-foreground">
            Checking system dependencies...
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {deps.map((dep) => (
            <div key={dep.key} className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <StatusIcon status={dep.status} />
                <div>
                  <span className="font-medium">{dep.label}</span>
                  {!dep.required && (
                    <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                  )}
                  <p className="text-xs text-muted-foreground">{dep.description}</p>
                </div>
              </div>
              {dep.status === false && INSTALL_LINKS[dep.key] && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => open(getPlatformLink(dep.key))}
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Install
                </Button>
              )}
            </div>
          ))}

          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onRecheck} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Re-check
            </Button>
            <Button onClick={onContinue} disabled={!requiredMet} className="flex-1">
              {requiredMet ? "Continue" : "Install required dependencies first"}
            </Button>
          </div>

          {!requiredMet && ffmpeg === false && (
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
              <p className="font-medium">Quick install (terminal):</p>
              <code className="block text-xs bg-background rounded p-2">
                {navigator.platform.toLowerCase().includes("mac")
                  ? "brew install ffmpeg"
                  : navigator.platform.toLowerCase().includes("win")
                  ? "winget install ffmpeg"
                  : "sudo apt install ffmpeg"}
              </code>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 4: Wire the setup screen into the app layout**

This depends on the current routing setup. The setup screen should be shown before the main app if FFmpeg is missing. Find the main layout component (likely `App.tsx` or a layout wrapper) and add:

```tsx
import { useDependencyCheck } from "@/hooks/useDependencyCheck";
import { DependencyCheck } from "@/components/setup/DependencyCheck";

// Inside the component:
const deps = useDependencyCheck();
const [setupDismissed, setSetupDismissed] = useState(false);

if (!setupDismissed && deps.loading === false && !deps.allRequired) {
  return (
    <DependencyCheck
      {...deps}
      onContinue={() => setSetupDismissed(true)}
      onRecheck={() => window.location.reload()}
    />
  );
}
```

**Step 5: Test the setup screen**

Run:
```bash
cd desktop && npx tauri dev
```

Expected: If FFmpeg is installed, app loads normally. If you temporarily rename FFmpeg (`sudo mv /opt/homebrew/bin/ffmpeg /opt/homebrew/bin/ffmpeg.bak`), the setup screen appears. Rename it back and click Re-check to continue.

**Step 6: Commit**

```bash
git add desktop/src/components/setup/DependencyCheck.tsx desktop/src/hooks/useDependencyCheck.ts backend/routers/health.py backend/main.py
git commit -m "feat: add first-run dependency detection and setup screen"
```

---

## Task 5: Production Environment Configuration

**Goal:** The production app needs to connect to a cloud Supabase instance (not localhost). Add a configuration system that lets the bundled app use production credentials.

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json` (update CSP for production Supabase)
- Create: `backend/.env.production` (template for production env vars)
- Modify: `backend/main.py` (load env from bundled path)

**Step 1: Create production env template**

Create `backend/.env.production`:

```bash
# Production environment variables — populate before building sidecar
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# Ollama (optional — leave empty to disable quote extraction)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Whisper model (only used on Apple Silicon)
WHISPER_MODEL=mlx-community/whisper-large-v3-turbo
```

**Step 2: Update PyInstaller spec to bundle .env.production**

Add to the `datas` list in `backend/sermonclip-api.spec`:

```python
datas = [
    ("assets", "assets"),
    (".env.production", "."),
]
```

**Step 3: Update main.py to load bundled env in production**

At the top of `backend/main.py`, before `load_dotenv()`:

```python
import sys
import os

# In PyInstaller bundle, load .env.production from the bundle directory
if getattr(sys, "frozen", False):
    bundle_dir = os.path.dirname(sys.executable)
    env_file = os.path.join(bundle_dir, ".env.production")
    if os.path.exists(env_file):
        from dotenv import load_dotenv
        load_dotenv(env_file)
    # Also set a flag for the app to know it's bundled
    os.environ.setdefault("SERMONCLIP_BUNDLED", "1")
```

**Step 4: Update desktop .env for production**

The frontend also needs production Supabase credentials. Create `desktop/.env.production`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_FASTAPI_URL=http://localhost:8000
```

When building for production: `npx tauri build` will use `.env.production` if Vite is configured to load it.

**Step 5: Commit**

```bash
git add backend/.env.production backend/sermonclip-api.spec backend/main.py desktop/.env.production
git commit -m "feat: add production environment configuration for bundled app"
```

---

## Task 6: GitHub Actions CI/CD Pipeline

**Goal:** Automatically build the app for macOS (ARM + Intel), Windows, and Linux on every release tag.

**Files:**
- Create: `.github/workflows/build-desktop.yml`

**Step 1: Create the workflow file**

Create `.github/workflows/build-desktop.yml`:

```yaml
name: Build Desktop App

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

env:
  VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
  VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
  VITE_FASTAPI_URL: http://localhost:8000

jobs:
  build-sidecar:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            target: aarch64-apple-darwin
            python-version: "3.11"
          - platform: macos-13
            target: x86_64-apple-darwin
            python-version: "3.11"
          - platform: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            python-version: "3.11"
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            python-version: "3.11"
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install backend dependencies
        working-directory: backend
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Populate production env
        working-directory: backend
        run: |
          echo "SUPABASE_URL=${{ secrets.SUPABASE_URL }}" > .env.production
          echo "SUPABASE_SERVICE_KEY=${{ secrets.SUPABASE_SERVICE_KEY }}" >> .env.production

      - name: Build sidecar with PyInstaller
        working-directory: backend
        run: pyinstaller sermonclip-api.spec --distpath dist --clean --noconfirm

      - name: Copy sidecar to Tauri binaries (Unix)
        if: runner.os != 'Windows'
        run: |
          mkdir -p desktop/src-tauri/binaries
          cp backend/dist/sermonclip-api desktop/src-tauri/binaries/sermonclip-api-${{ matrix.target }}

      - name: Copy sidecar to Tauri binaries (Windows)
        if: runner.os == 'Windows'
        run: |
          mkdir -p desktop/src-tauri/binaries
          cp backend/dist/sermonclip-api.exe desktop/src-tauri/binaries/sermonclip-api-${{ matrix.target }}.exe

      - name: Upload sidecar artifact
        uses: actions/upload-artifact@v4
        with:
          name: sidecar-${{ matrix.target }}
          path: desktop/src-tauri/binaries/sermonclip-api-*

  build-tauri:
    needs: build-sidecar
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            target: aarch64-apple-darwin
            args: "--target aarch64-apple-darwin"
          - platform: macos-13
            target: x86_64-apple-darwin
            args: "--target x86_64-apple-darwin"
          - platform: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            args: ""
          - platform: windows-latest
            target: x86_64-pc-windows-msvc
            args: ""
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install frontend dependencies
        working-directory: desktop
        run: npm ci

      - name: Download sidecar artifact
        uses: actions/download-artifact@v4
        with:
          name: sidecar-${{ matrix.target }}
          path: desktop/src-tauri/binaries/

      - name: Make sidecar executable (Unix)
        if: runner.os != 'Windows'
        run: chmod +x desktop/src-tauri/binaries/sermonclip-api-*

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS signing (optional)
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          projectPath: desktop
          tauriScript: npx tauri
          args: ${{ matrix.args }}
          tagName: ${{ github.ref_name }}
          releaseName: "SermonClip ${{ github.ref_name }}"
          releaseBody: "See the assets for download links."
          releaseDraft: true
          prerelease: false

  cleanup-artifacts:
    needs: build-tauri
    runs-on: ubuntu-latest
    steps:
      - uses: geekyeggo/delete-artifact@v5
        with:
          name: sidecar-*
```

**Step 2: Add .gitignore entries**

Add to the project root `.gitignore`:

```
# PyInstaller
backend/dist/
backend/build/
desktop/src-tauri/binaries/

# Production env (contains secrets)
backend/.env.production
desktop/.env.production
```

**Step 3: Commit**

```bash
git add .github/workflows/build-desktop.yml .gitignore
git commit -m "feat: add GitHub Actions CI/CD for multi-platform desktop builds"
```

---

## Task 7: Test Full Build Locally

**Goal:** Do an end-to-end local build to verify the sidecar + Tauri bundle works.

**Step 1: Build the sidecar**

```bash
cd backend && ./build_sidecar.sh
```

**Step 2: Build the Tauri app**

```bash
cd desktop && source ~/.cargo/env && npx tauri build
```

Expected: Creates `desktop/src-tauri/target/release/bundle/dmg/SermonClip_0.1.0_aarch64.dmg` (on macOS ARM).

**Step 3: Install and test the .dmg**

1. Open the .dmg
2. Drag SermonClip to Applications
3. Launch SermonClip from Applications
4. Verify: backend starts (check Activity Monitor for `sermonclip-api` process)
5. Verify: can create a project and process a video

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjustments from local build testing"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | PyInstaller spec + build script to bundle FastAPI as executable |
| 2 | Tauri config to launch sidecar binary in production, venv in dev |
| 3 | CLI args for the backend so sidecar accepts --host/--port |
| 4 | First-run setup screen to detect FFmpeg/Ollama and help install |
| 5 | Production env config for cloud Supabase |
| 6 | GitHub Actions to build .dmg/.msi/.AppImage on release tags |
| 7 | Local end-to-end build test |

**After this plan:** Users download a single installer, open the app, install FFmpeg if prompted, and start processing sermons. No Python, no terminal, no dev setup.
