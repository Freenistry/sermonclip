import { Badge } from "@/components/ui/badge";
import { Clock, Merge } from "lucide-react";

interface Highlight {
  id: string;
  title: string;
  quote_text: string;
  start_time: number;
  end_time: number;
  duration_tier: string;
  is_merged?: boolean;
  time_ranges?: { start: number; end: number }[];
}

interface ClipListItemProps {
  highlight: Highlight;
  isSelected: boolean;
  onClick: () => void;
  isMergeSuggested?: boolean;
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

export function ClipListItem({ highlight, isSelected, onClick, isMergeSuggested }: ClipListItemProps) {
  const hasMultiSegment = highlight.time_ranges && highlight.time_ranges.length >= 2;
  const duration = hasMultiSegment
    ? highlight.time_ranges!.reduce((sum, r) => sum + (r.end - r.start), 0)
    : highlight.end_time - highlight.start_time;

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
          {hasMultiSegment
            ? `${formatTime(highlight.time_ranges![0].start)}\u2013${formatTime(highlight.time_ranges![0].end)} + ${highlight.time_ranges!.length - 1} more`
            : `${formatTime(highlight.start_time)} - ${formatTime(highlight.end_time)}`}
        </span>
        {highlight.is_merged && (
          <Badge variant="outline" className="ml-auto gap-1 text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-950/30">
            <Merge className="h-2.5 w-2.5" />
            Merged
          </Badge>
        )}
        {isMergeSuggested && !highlight.is_merged && (
          <Badge variant="outline" className="ml-auto gap-1 text-purple-700 border-purple-300 bg-purple-50 dark:text-purple-400 dark:border-purple-800 dark:bg-purple-950/30">
            <Merge className="h-2.5 w-2.5" />
            Merge
          </Badge>
        )}
      </div>
    </button>
  );
}
