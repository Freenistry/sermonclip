"use client";

import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

interface Highlight {
  id: string;
  title: string;
  quote_text: string;
  start_time: number;
  end_time: number;
  duration_tier: string;
}

interface ClipListItemProps {
  highlight: Highlight;
  isSelected: boolean;
  onClick: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function ClipListItem({ highlight, isSelected, onClick }: ClipListItemProps) {
  const duration = highlight.end_time - highlight.start_time;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        isSelected
          ? "border-primary bg-primary/5"
          : "border-transparent hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="font-medium text-sm leading-tight line-clamp-1">{highlight.title}</h4>
        <Badge variant="secondary" className="shrink-0 text-xs">
          {formatDuration(duration)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
        &quot;{highlight.quote_text}&quot;
      </p>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>
          {formatTime(highlight.start_time)} - {formatTime(highlight.end_time)}
        </span>
      </div>
    </button>
  );
}
