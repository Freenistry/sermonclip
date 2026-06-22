"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Clock } from "lucide-react";

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptViewProps {
  transcript: {
    id: string;
    full_text: string;
    segments: Segment[];
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function TranscriptView({ transcript }: TranscriptViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Transcript</CardTitle>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTimestamps(!showTimestamps)}
          >
            <Clock className="h-4 w-4 mr-1" />
            {showTimestamps ? "Hide Times" : "Show Times"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Expand
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showTimestamps ? (
          <div className={`space-y-2 ${expanded ? "" : "max-h-64 overflow-hidden"}`}>
            {transcript.segments.map((segment, index) => (
              <div key={index} className="flex gap-3">
                <span className="text-xs text-muted-foreground font-mono min-w-[60px]">
                  {formatTime(segment.start)}
                </span>
                <p className="text-sm">{segment.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className={expanded ? "" : "max-h-64 overflow-hidden"}>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {transcript.full_text}
            </p>
          </div>
        )}
        {!expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
      </CardContent>
    </Card>
  );
}
