"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";

interface ClipPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoData: string | null;
  filename: string;
  duration: number;
  isLoading: boolean;
  onRegenerate: () => void;
}

export function ClipPreviewModal({
  open,
  onOpenChange,
  videoData,
  filename,
  duration,
  isLoading,
  onRegenerate,
}: ClipPreviewModalProps) {
  const handleDownload = () => {
    if (!videoData) return;

    const link = document.createElement("a");
    link.href = videoData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button onClick={handleDownload} disabled={!videoData || isLoading}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
