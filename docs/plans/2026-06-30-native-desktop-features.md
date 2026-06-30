# Phase 4: Native Desktop Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace web-style file handling and notifications with native OS equivalents using Tauri plugins.

**Architecture:** Install Tauri dialog and notification plugins (both Rust and JS sides). Replace the HTML file input with native open dialog, add OS notifications when processing completes, and replace blob download with native save dialog.

**Tech Stack:** `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-notification`, `tauri-plugin-dialog` (Rust), `tauri-plugin-notification` (Rust)

---

### Task 1: Install Tauri Dialog and Notification Plugins

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/src-tauri/Cargo.toml`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/capabilities/default.json`

**Step 1: Install JS packages**

Run from `desktop/`:
```bash
npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-notification
```

**Step 2: Add Rust plugins to Cargo.toml**

In `desktop/src-tauri/Cargo.toml`, add to `[dependencies]`:
```toml
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
```

**Step 3: Register plugins in lib.rs**

In `desktop/src-tauri/src/lib.rs`, add plugins to the builder chain (after `.plugin(tauri_plugin_shell::init())`):

```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_notification::init())
```

**Step 4: Add permissions to capabilities**

In `desktop/src-tauri/capabilities/default.json`, update the `permissions` array:

```json
{
  "permissions": [
    "core:default",
    "shell:default",
    "dialog:default",
    "notification:default",
    "notification:allow-is-permission-granted",
    "notification:allow-request-permission",
    "notification:allow-notify"
  ]
}
```

**Step 5: Build to verify plugins compile**

Run from `desktop/`:
```bash
cd src-tauri && cargo check
```
Expected: compiles without errors.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: install Tauri dialog and notification plugins"
```

---

### Task 2: Native File Dialog for Video Upload

**Files:**
- Modify: `desktop/src/components/projects/UploadForm.tsx`

**Context:** Currently the upload form uses an HTML `<input type="file">` element (line 361-366) and drag-and-drop. We'll add a "Browse Files" button that opens a native OS file dialog via Tauri's dialog plugin. The drag-and-drop functionality stays as-is (it still works in Tauri's WebView).

**Step 1: Add native file picker function**

At the top of `UploadForm.tsx`, add the import and a helper function:

```typescript
import { open } from "@tauri-apps/plugin-dialog";
```

Replace the existing `handleFileSelect` function (lines 92-104) with one that uses the native dialog:

```typescript
const handleFileSelect = async () => {
  try {
    const selected = await open({
      multiple: false,
      title: "Select Sermon Video",
      filters: [
        {
          name: "Video Files",
          extensions: ["mp4", "mov", "webm"],
        },
      ],
    });

    if (!selected) return; // User cancelled

    // Read the selected file path into a File object for Supabase upload
    const filePath = selected as string;
    const response = await fetch(`asset://localhost/${filePath}`);
    const blob = await response.blob();
    const fileName = filePath.split("/").pop() || "video.mp4";
    const mimeTypes: Record<string, string> = {
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
    };
    const ext = fileName.split(".").pop()?.toLowerCase() || "mp4";
    const nativeFile = new File([blob], fileName, {
      type: mimeTypes[ext] || "video/mp4",
    });

    setFile(nativeFile);
    if (!title) {
      setTitle(fileName.replace(/\.[^/.]+$/, ""));
    }
  } catch (err) {
    console.error("File selection error:", err);
    toast.error("Failed to select file");
  }
};
```

**Step 2: Update the browse button in the JSX**

Replace the HTML file input label block (lines 360-370):

```tsx
{/* Old code: */}
<label>
  <Input
    type="file"
    accept="video/mp4,video/quicktime,video/webm"
    onChange={handleFileSelect}
    className="hidden"
  />
  <span className="text-primary cursor-pointer hover:underline">
    browse to upload
  </span>
</label>
```

With a button that calls the native dialog:

```tsx
<button
  type="button"
  onClick={handleFileSelect}
  className="text-primary cursor-pointer hover:underline"
>
  browse to upload
</button>
```

**Step 3: Verify**

Run `npx tauri dev`. Navigate to Projects > New. Click "browse to upload". A native OS file picker should appear with video file filters. Select a file — it should populate the form.

**Step 4: Commit**

```bash
git add desktop/src/components/projects/UploadForm.tsx
git commit -m "feat: native file dialog for video upload"
```

---

### Task 3: OS Notifications for Processing Completion

**Files:**
- Modify: `desktop/src/components/projects/ProcessingProgress.tsx`

**Context:** When processing completes (status changes to `completed`), we currently only show an in-app toast and update the UI. Users often switch away from the app during the minutes-long processing. An OS notification brings them back.

**Step 1: Add notification import and helper**

At the top of `ProcessingProgress.tsx`, add:

```typescript
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
```

**Step 2: Add notification logic to handleStatusChange**

In the `handleStatusChange` callback (around line 109), add notification when status becomes `completed`:

Replace:
```typescript
const handleStatusChange = useCallback((newStatus: string) => {
  if (newStatus !== status) {
    setLastStatusChange(Date.now());
    setShowRetry(false);
  }
  setStatus(newStatus);

  if (newStatus === "failed") {
    setError("Processing failed. Please try again.");
  }
  if (newStatus === "cancelled") {
    toast.info("Processing was cancelled");
  }
}, [status]);
```

With:
```typescript
const handleStatusChange = useCallback(async (newStatus: string) => {
  if (newStatus !== status) {
    setLastStatusChange(Date.now());
    setShowRetry(false);
  }
  setStatus(newStatus);

  if (newStatus === "failed") {
    setError("Processing failed. Please try again.");
  }
  if (newStatus === "cancelled") {
    toast.info("Processing was cancelled");
  }

  // Send OS notification for terminal states
  if (newStatus === "completed" || newStatus === "failed") {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === "granted";
      }
      if (granted) {
        sendNotification({
          title: "SermonClip",
          body:
            newStatus === "completed"
              ? "Your sermon has been processed! Highlights and quotes are ready."
              : "Processing failed. Please try again.",
        });
      }
    } catch {
      // Notification not available — silently ignore
    }
  }
}, [status]);
```

**Step 3: Verify**

Run `npx tauri dev`. Upload or process a video. When processing completes, an OS notification should appear (macOS notification center, Windows toast, Linux notify).

**Step 4: Commit**

```bash
git add desktop/src/components/projects/ProcessingProgress.tsx
git commit -m "feat: OS notification on processing completion"
```

---

### Task 4: Native Save Dialog for Clip Export

**Files:**
- Modify: `desktop/src/components/projects/ClipPreviewModal.tsx`

**Context:** Currently `handleDownload` (lines 39-48) creates a blob URL and triggers a browser-style download via a hidden `<a>` tag. In a desktop app, we should use a native "Save As" dialog and write the file to the user's chosen location.

**Step 1: Add Tauri dialog import**

At the top of `ClipPreviewModal.tsx`, add:

```typescript
import { save } from "@tauri-apps/plugin-dialog";
```

**Step 2: Replace handleDownload with native save dialog**

Replace the existing `handleDownload` function (lines 39-48):

```typescript
const handleDownload = async () => {
  if (!videoData) return;

  try {
    const filePath = await save({
      title: "Save Clip",
      defaultPath: filename,
      filters: [
        {
          name: "Video Files",
          extensions: ["mp4"],
        },
      ],
    });

    if (!filePath) return; // User cancelled

    // Convert blob URL to bytes and write to disk
    const response = await fetch(videoData);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Use Tauri's fs plugin to write the file
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(filePath, bytes);

    toast.success("Clip saved successfully!");
  } catch (err) {
    console.error("Save error:", err);
    toast.error("Failed to save clip");
  }
};
```

**Step 3: Add fs plugin dependency**

The save dialog gives us the path, but we need `@tauri-apps/plugin-fs` to write the file.

Run from `desktop/`:
```bash
npm install @tauri-apps/plugin-fs
```

Add to `desktop/src-tauri/Cargo.toml` dependencies:
```toml
tauri-plugin-fs = "2"
```

Add to `desktop/src-tauri/src/lib.rs` builder chain:
```rust
.plugin(tauri_plugin_fs::init())
```

Add to `desktop/src-tauri/capabilities/default.json` permissions:
```json
"fs:default",
"fs:allow-write-file"
```

**Step 4: Verify**

Run `npx tauri dev`. Go to a project > clip editor > Export Clip. When the export finishes, click Download. A native "Save As" dialog should appear. Choose a location — the file should be written there.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: native save dialog for clip export"
```

---

### Task 5: Verify All Features End-to-End

**Step 1:** Run `npx tauri dev` from `desktop/`

**Step 2:** Test native file dialog:
- Go to Projects > New
- Click "browse to upload" — native file picker should open
- Select a video file — form should populate with file name and size
- Drag-and-drop should still work as before

**Step 3:** Test OS notifications:
- Process a video (or wait for one in progress to complete)
- When status changes to "completed", an OS notification should appear
- If processing fails, a failure notification should appear

**Step 4:** Test native save dialog:
- Open a completed project
- Click a highlight > Edit Clip
- Export the clip
- Click "Download" in the preview modal
- A native "Save As" dialog should appear
- Save to a location — verify the file plays correctly

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "feat: phase 4 native desktop features complete"
```
