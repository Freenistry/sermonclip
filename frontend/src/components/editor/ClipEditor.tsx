"use client";

import { useReducer, useEffect, useState, useCallback } from "react";
import { EditorVideoPreview } from "./EditorVideoPreview";
import { SubtitleStyleSelector, type SubtitleStyle } from "./SubtitleStyleSelector";
import { AspectRatioSelector, type AspectRatio } from "./AspectRatioSelector";
import { TrimInputFields } from "./TrimInputFields";
import { Timeline } from "./Timeline";
import { ExportBar } from "./ExportBar";
import { ClipPreviewModal } from "@/components/projects/ClipPreviewModal";
import { toast } from "sonner";
import type { WordTimestamp } from "./types";

interface Highlight {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  [key: string]: unknown;
}

interface EditorState {
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  isPlaying: boolean;
  subtitleStyle: SubtitleStyle;
  aspectRatio: AspectRatio;
  words: WordTimestamp[];
  waveformPeaks: number[];
  isExporting: boolean;
}

type EditorAction =
  | { type: "SET_TRIM"; start: number; end: number }
  | { type: "SET_CURRENT_TIME"; time: number }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_SUBTITLE_STYLE"; style: SubtitleStyle }
  | { type: "SET_ASPECT_RATIO"; ratio: AspectRatio }
  | { type: "SET_WORDS"; words: WordTimestamp[] }
  | { type: "SET_WAVEFORM"; peaks: number[] }
  | { type: "SET_EXPORTING"; exporting: boolean };

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SET_TRIM":
      return { ...state, trimStart: action.start, trimEnd: action.end };
    case "SET_CURRENT_TIME":
      return { ...state, currentTime: action.time };
    case "SET_PLAYING":
      return { ...state, isPlaying: action.playing };
    case "SET_SUBTITLE_STYLE":
      return { ...state, subtitleStyle: action.style };
    case "SET_ASPECT_RATIO":
      return { ...state, aspectRatio: action.ratio };
    case "SET_WORDS":
      return { ...state, words: action.words };
    case "SET_WAVEFORM":
      return { ...state, waveformPeaks: action.peaks };
    case "SET_EXPORTING":
      return { ...state, isExporting: action.exporting };
    default:
      return state;
  }
}

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

interface ClipEditorProps {
  projectId: string;
  highlightId: string;
  highlight: Highlight;
  videoSrc: string;
}

export function ClipEditor({
  projectId,
  highlightId,
  highlight,
  videoSrc,
}: ClipEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, {
    trimStart: highlight.start_time,
    trimEnd: highlight.end_time,
    currentTime: highlight.start_time,
    isPlaying: false,
    subtitleStyle: "basic" as SubtitleStyle,
    aspectRatio: "9:16" as AspectRatio,
    words: [],
    waveformPeaks: [],
    isExporting: false,
  });

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportData, setExportData] = useState<string | null>(null);
  const [exportFilename, setExportFilename] = useState("clip.mp4");
  const [exportDuration, setExportDuration] = useState(0);

  // Fetch words and waveform on mount
  useEffect(() => {
    async function fetchWords() {
      try {
        const res = await fetch(`${API_URL}/editor/highlight/${highlightId}/words`);
        if (res.ok) {
          const data = await res.json();
          dispatch({ type: "SET_WORDS", words: data.words });
        }
      } catch {
        console.error("Failed to fetch words");
      }
    }

    async function fetchWaveform() {
      try {
        const res = await fetch(
          `${API_URL}/editor/project/${projectId}/waveform?start=${highlight.start_time}&end=${highlight.end_time}&peaks=200`
        );
        if (res.ok) {
          const data = await res.json();
          dispatch({ type: "SET_WAVEFORM", peaks: data.peaks });
        }
      } catch {
        console.error("Failed to fetch waveform");
      }
    }

    fetchWords();
    fetchWaveform();
  }, [highlightId, projectId, highlight.start_time, highlight.end_time]);

  const handleTimeUpdate = useCallback((time: number) => {
    dispatch({ type: "SET_CURRENT_TIME", time });
  }, []);

  const handlePlayPause = useCallback((playing: boolean) => {
    dispatch({ type: "SET_PLAYING", playing });
  }, []);

  const handleTrimChange = useCallback((start: number, end: number) => {
    dispatch({ type: "SET_TRIM", start, end });
  }, []);

  const handleSeek = useCallback((time: number) => {
    dispatch({ type: "SET_CURRENT_TIME", time });
    dispatch({ type: "SET_PLAYING", playing: false });
  }, []);

  const handleExport = async () => {
    dispatch({ type: "SET_EXPORTING", exporting: true });
    setShowExportModal(true);
    setExportData(null);

    try {
      const res = await fetch(`${API_URL}/editor/highlight/${highlightId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: state.trimStart,
          end_time: state.trimEnd,
          aspect_ratio: state.aspectRatio,
          subtitle_style: state.subtitleStyle,
        }),
      });

      if (!res.ok) throw new Error("Export failed");

      const data = await res.json();
      setExportData(data.video);
      setExportFilename(data.filename);
      setExportDuration(data.duration);
    } catch {
      toast.error("Failed to export clip");
      setShowExportModal(false);
    } finally {
      dispatch({ type: "SET_EXPORTING", exporting: false });
    }
  };

  return (
    <div className="pb-20">
      {/* Main layout: 3 columns on desktop, stacked on mobile */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left: Subtitle Style Selector */}
        <div className="lg:w-[200px] shrink-0">
          <SubtitleStyleSelector
            value={state.subtitleStyle}
            onChange={(style) => dispatch({ type: "SET_SUBTITLE_STYLE", style })}
          />
        </div>

        {/* Center: Video Preview */}
        <div className="flex-1 flex justify-center">
          <EditorVideoPreview
            videoSrc={videoSrc}
            trimStart={state.trimStart}
            trimEnd={state.trimEnd}
            currentTime={state.currentTime}
            isPlaying={state.isPlaying}
            subtitleStyle={state.subtitleStyle}
            aspectRatio={state.aspectRatio}
            words={state.words}
            onTimeUpdate={handleTimeUpdate}
            onPlayPause={handlePlayPause}
          />
        </div>

        {/* Right: Aspect Ratio + Trim */}
        <div className="lg:w-[200px] shrink-0 space-y-6">
          <AspectRatioSelector
            value={state.aspectRatio}
            onChange={(ratio) => dispatch({ type: "SET_ASPECT_RATIO", ratio })}
          />
          <TrimInputFields
            trimStart={state.trimStart}
            trimEnd={state.trimEnd}
            onChange={handleTrimChange}
          />
        </div>
      </div>

      {/* Bottom: Timeline */}
      <div className="mt-6">
        <Timeline
          waveformPeaks={state.waveformPeaks}
          trimStart={state.trimStart}
          trimEnd={state.trimEnd}
          currentTime={state.currentTime}
          totalStart={highlight.start_time}
          totalEnd={highlight.end_time}
          onTrimChange={handleTrimChange}
          onSeek={handleSeek}
        />
      </div>

      {/* Export Bar */}
      <ExportBar
        trimStart={state.trimStart}
        trimEnd={state.trimEnd}
        subtitleStyle={state.subtitleStyle}
        aspectRatio={state.aspectRatio}
        isExporting={state.isExporting}
        onExport={handleExport}
      />

      {/* Export Modal (reuses ClipPreviewModal) */}
      <ClipPreviewModal
        open={showExportModal}
        onOpenChange={setShowExportModal}
        videoData={exportData}
        filename={exportFilename}
        duration={exportDuration}
        isLoading={state.isExporting}
        onRegenerate={handleExport}
      />
    </div>
  );
}
