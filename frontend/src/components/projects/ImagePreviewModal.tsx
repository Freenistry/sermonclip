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

interface ImagePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageData: string | null;
  filename: string;
  isLoading: boolean;
  onRegenerate: () => void;
}

export function ImagePreviewModal({
  open,
  onOpenChange,
  imageData,
  filename,
  isLoading,
  onRegenerate,
}: ImagePreviewModalProps) {
  const handleDownload = () => {
    if (!imageData) return;

    const link = document.createElement("a");
    link.href = imageData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quote Image Preview</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center min-h-[300px] bg-muted rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin" />
              <span>Generating image...</span>
            </div>
          ) : imageData ? (
            <img
              src={imageData}
              alt="Quote preview"
              className="max-w-full max-h-[400px] object-contain"
            />
          ) : (
            <span className="text-muted-foreground">No image</span>
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
          <Button onClick={handleDownload} disabled={!imageData || isLoading}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
