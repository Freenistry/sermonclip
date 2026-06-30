import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, BookmarkPlus, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface ClipPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoData: string | null;
  filename: string;
  duration: number;
  isLoading: boolean;
  onRegenerate: () => void;
  highlightId?: string;
}

export function ClipPreviewModal({
  open,
  onOpenChange,
  videoData,
  filename,
  duration,
  isLoading,
  onRegenerate,
  highlightId,
}: ClipPreviewModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!videoData) return;

    setIsDownloading(true);
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

      await writeFile(filePath, bytes);
      toast.success("Clip saved successfully!");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Failed to save clip");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!highlightId) return;

    setIsSaving(true);
    try {
      const response = await fetch(
        `${API_URL}/clip/highlight/${highlightId}/save`,
        { method: "POST" }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save clip");
      }
      setIsSaved(true);
      toast.success("Clip saved to library");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save clip");
    } finally {
      setIsSaving(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Reset saved state when modal reopens with new data
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsSaved(false);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Quote Clip Preview
            {duration > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({formatDuration(duration)})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center min-h-[300px] bg-muted rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin" />
              <span>Generating clip...</span>
            </div>
          ) : videoData ? (
            <video
              src={videoData}
              controls
              className="max-w-full max-h-[400px]"
              autoPlay={false}
            >
              Your browser does not support the video tag.
            </video>
          ) : (
            <span className="text-muted-foreground">No video</span>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onRegenerate}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
          {highlightId && (
            <Button
              variant="outline"
              onClick={handleSaveToLibrary}
              disabled={!videoData || isLoading || isSaving || isSaved}
            >
              {isSaved ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Saved
                </>
              ) : (
                <>
                  <BookmarkPlus className={`h-4 w-4 mr-2 ${isSaving ? "animate-spin" : ""}`} />
                  {isSaving ? "Saving..." : "Save to Library"}
                </>
              )}
            </Button>
          )}
          <Button onClick={handleDownload} disabled={!videoData || isLoading || isDownloading}>
            {isDownloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isDownloading ? "Saving..." : "Download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
