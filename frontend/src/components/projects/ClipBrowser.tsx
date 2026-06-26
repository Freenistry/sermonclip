"use client";

import { useState } from "react";
import { ClipListItem } from "./ClipListItem";
import { ClipPreviewPanel } from "./ClipPreviewPanel";

interface Highlight {
  id: string;
  title: string;
  transcript_excerpt: string;
  quote_text: string;
  start_time: number;
  end_time: number;
  duration_tier: string;
}

interface ClipBrowserProps {
  highlights: Highlight[];
  sourceType: "youtube" | "upload";
  youtubeUrl?: string;
  videoUrl?: string;
}

export function ClipBrowser({
  highlights,
  sourceType,
  youtubeUrl,
  videoUrl,
}: ClipBrowserProps) {
  const [selectedId, setSelectedId] = useState<string>(
    highlights[0]?.id ?? ""
  );

  const selectedHighlight =
    highlights.find((h) => h.id === selectedId) ?? null;

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[500px]">
      {/* Clip list */}
      <div className="w-full md:w-[340px] shrink-0 border rounded-lg overflow-hidden">
        <div className="p-3 border-b bg-muted/30">
          <h3 className="font-semibold text-sm">
            Clips ({highlights.length})
          </h3>
        </div>
        <div className="overflow-y-auto max-h-[600px] md:max-h-[calc(100vh-300px)] p-2 space-y-1">
          {highlights.map((h) => (
            <ClipListItem
              key={h.id}
              highlight={h}
              isSelected={h.id === selectedId}
              onClick={() => setSelectedId(h.id)}
            />
          ))}
        </div>
      </div>

      {/* Preview panel */}
      <div className="flex-1 border rounded-lg p-4">
        <ClipPreviewPanel
          highlight={selectedHighlight}
          sourceType={sourceType}
          youtubeUrl={youtubeUrl}
          videoUrl={videoUrl}
        />
      </div>
    </div>
  );
}
