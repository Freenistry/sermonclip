"use client";

import { Button } from "@/components/ui/button";
import { Download, Loader2, BookmarkPlus, Check } from "lucide-react";
import type { SubtitleStyle } from "./SubtitleStyleSelector";
import type { AspectRatio } from "./AspectRatioSelector";

interface ExportBarProps {
  trimStart: number;
  trimEnd: number;
  subtitleStyle: SubtitleStyle;
  aspectRatio: AspectRatio;
  isExporting: boolean;
  onExport: () => void;
  isSaving?: boolean;
  isSaved?: boolean;
  onSave?: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

const STYLE_LABELS: Record<SubtitleStyle, string> = {
  basic: "Basic",
  one_word: "One Word",
  two_word: "Two Words",
  elevate: "Elevate",
  word_color: "Highlight",
  text_reveal: "Reveal",
  slide_in: "Slide In",
  word_bg: "Word BG",
  word_append: "Appended",
  highlight_impactful: "Impactful",
};

export function ExportBar({
  trimStart,
  trimEnd,
  subtitleStyle,
  aspectRatio,
  isExporting,
  onExport,
  isSaving,
  isSaved,
  onSave,
}: ExportBarProps) {
  const duration = trimEnd - trimStart;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background border-t px-6 py-3 flex items-center justify-between z-50">
      <div className="text-sm text-muted-foreground">
        {formatDuration(duration)} &middot; {aspectRatio} &middot; {STYLE_LABELS[subtitleStyle]}
      </div>
      <div className="flex gap-2">
        {onSave && (
          <Button
            variant="outline"
            onClick={onSave}
            disabled={isExporting || isSaving || isSaved}
          >
            {isSaved ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Saved
              </>
            ) : isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <BookmarkPlus className="h-4 w-4 mr-2" />
                Save to Library
              </>
            )}
          </Button>
        )}
        <Button onClick={onExport} disabled={isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Export Clip
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
