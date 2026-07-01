import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Merge, X, Clock } from "lucide-react";
import { toast } from "sonner";

interface HighlightInfo {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  quote_text: string;
}

interface Suggestion {
  id: string;
  highlight_ids: string[];
  reason: string;
  merged_title: string;
  merged_start_time: number;
  merged_end_time: number;
  confidence: string;
  highlights: HighlightInfo[];
}

interface MergeSuggestionCardProps {
  suggestion: Suggestion;
  onProcessed: (id: string) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const confidenceColors: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
};

export function MergeSuggestionCard({ suggestion, onProcessed }: MergeSuggestionCardProps) {
  const [loading, setLoading] = useState<"accept" | "dismiss" | null>(null);
  const apiUrl = import.meta.env.VITE_FASTAPI_URL || "http://localhost:18080";

  const combinedDuration = suggestion.merged_end_time - suggestion.merged_start_time;

  const handleAction = async (action: "accept" | "dismiss") => {
    setLoading(action);
    try {
      const res = await fetch(`${apiUrl}/merge/suggestion/${suggestion.id}/${action}`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to ${action} suggestion`);
      }

      toast.success(action === "accept" ? "Clips merged successfully!" : "Suggestion dismissed.");
      onProcessed(suggestion.id);
      // TODO: invalidate React Query cache instead of router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${action}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card className="border-border/50">
      <CardContent className="pt-4 pb-3 space-y-3">
        {/* Header: merged title + confidence */}
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-semibold text-sm">{suggestion.merged_title}</h4>
          <Badge
            variant="secondary"
            className={confidenceColors[suggestion.confidence] || ""}
          >
            {suggestion.confidence}
          </Badge>
        </div>

        {/* Source highlights */}
        <div className="text-xs text-muted-foreground space-y-1">
          {suggestion.highlights.map((h, i) => (
            <div key={h.id} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground/50">+</span>}
              <span className="font-medium text-foreground/80">&ldquo;{h.title}&rdquo;</span>
              <span>({formatTime(h.start_time)}-{formatTime(h.end_time)})</span>
            </div>
          ))}
        </div>

        {/* Reason */}
        <p className="text-xs text-muted-foreground italic">{suggestion.reason}</p>

        {/* Footer: duration + actions */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>{Math.round(combinedDuration)}s combined</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAction("dismiss")}
              disabled={loading !== null}
              className="h-7 px-2 text-xs"
            >
              {loading === "dismiss" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3 mr-1" />
              )}
              Dismiss
            </Button>
            <Button
              size="sm"
              onClick={() => handleAction("accept")}
              disabled={loading !== null}
              className="h-7 px-3 text-xs"
            >
              {loading === "accept" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Merge className="h-3 w-3 mr-1" />
              )}
              Merge
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
