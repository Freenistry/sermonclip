import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, BookmarkPlus, Check } from "lucide-react";
import { toast } from "sonner";

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

  const handleDownload = () => {
    if (!videoData) return;

    const link = document.createElement("a");
    link.href = videoData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          <Button onClick={handleDownload} disabled={!videoData || isLoading}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
