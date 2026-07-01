import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { MergeSuggestionCard } from "./MergeSuggestionCard";

interface Suggestion {
  id: string;
  highlight_ids: string[];
  reason: string;
  merged_title: string;
  merged_start_time: number;
  merged_end_time: number;
  confidence: string;
  highlights: {
    id: string;
    title: string;
    start_time: number;
    end_time: number;
    quote_text: string;
  }[];
}

interface MergeSuggestionsPanelProps {
  projectId: string;
}

export function MergeSuggestionsPanel({ projectId }: MergeSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_FASTAPI_URL || "http://localhost:18080";
    fetch(`${apiUrl}/merge/project/${projectId}/suggestions`)
      .then((res) => res.json())
      .then((data) => {
        setSuggestions(data.suggestions || []);
      })
      .catch(() => {
        setSuggestions([]);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleProcessed = (id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  };

  if (loading || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/50 dark:border-purple-900 dark:bg-purple-950/20">
      {/* Collapsible banner */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-purple-800 dark:text-purple-300 hover:bg-purple-100/50 dark:hover:bg-purple-900/20 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <span>{suggestions.length} clip{suggestions.length !== 1 ? "s" : ""} could be stronger together</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {suggestions.map((suggestion) => (
            <MergeSuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onProcessed={handleProcessed}
            />
          ))}
        </div>
      )}
    </div>
  );
}
