"use client";

import { useReducer, useEffect, useState, useCallback } from "react";
import { EditorVideoPreview } from "./EditorVideoPreview";
import { type SubtitleStyle } from "./SubtitleStyleSelector";
import { AspectRatioSelector, type AspectRatio } from "./AspectRatioSelector";
import { TrimInputFields } from "./TrimInputFields";
import { Timeline } from "./Timeline";
import { ExportBar } from "./ExportBar";
import { ClipPreviewModal } from "@/components/projects/ClipPreviewModal";
import { SubtitlePanel } from "./SubtitlePanel";
import { BackgroundMusicSelector } from "./BackgroundMusicSelector";
import { useTimelineThumbnails } from "./useTimelineThumbnails";
import { toast } from "sonner";
import type { WordTimestamp, SubtitleCustomization } from "./types";

export interface BgMusicSegment {
  id: string;
  musicStart: number;     // position in source music file (seconds)
  musicEnd: number;       // position in source music file (seconds)
  timelineStart: number;  // absolute video time where this segment starts
}

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
  subtitlesEnabled: boolean;
  aspectRatio: AspectRatio;
  words: WordTimestamp[];
  subtitleCustomization: SubtitleCustomization;
  bgMusic: string | null;
  bgMusicName: string | null;
  bgMusicUrl: string | null;
  bgMusicVolume: number;
  bgMusicDuration: number | null;
  bgMusicSegments: BgMusicSegment[];
  isExporting: boolean;
}

type EditorAction =
  | { type: "SET_TRIM"; start: number; end: number }
  | { type: "SET_CURRENT_TIME"; time: number }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_SUBTITLE_STYLE"; style: SubtitleStyle }
  | { type: "SET_SUBTITLES_ENABLED"; enabled: boolean }
  | { type: "SET_ASPECT_RATIO"; ratio: AspectRatio }
  | { type: "SET_WORDS"; words: WordTimestamp[] }
  | { type: "SET_WORD_EDIT"; index: number; newWord: string }
  | { type: "SET_SUBTITLE_CUSTOMIZATION"; customization: SubtitleCustomization }
  | { type: "SET_BG_MUSIC"; trackId: string | null; trackName: string | null; trackUrl: string | null }
  | { type: "SET_BG_MUSIC_VOLUME"; volume: number }
  | { type: "SET_BG_MUSIC_SEGMENTS"; segments: BgMusicSegment[] }
  | { type: "SET_BG_MUSIC_DURATION"; duration: number }
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
    case "SET_SUBTITLES_ENABLED":
      return { ...state, subtitlesEnabled: action.enabled };
    case "SET_ASPECT_RATIO":
      return { ...state, aspectRatio: action.ratio };
    case "SET_WORDS":
      return { ...state, words: action.words };
    case "SET_WORD_EDIT": {
      const updated = [...state.words];
      if (action.index < updated.length) {
        updated[action.index] = { ...updated[action.index], word: action.newWord };
      }
      return { ...state, words: updated };
    }
    case "SET_SUBTITLE_CUSTOMIZATION":
      return { ...state, subtitleCustomization: action.customization };
    case "SET_BG_MUSIC":
      return { ...state, bgMusic: action.trackId, bgMusicName: action.trackName, bgMusicUrl: action.trackUrl, bgMusicDuration: null, bgMusicSegments: [] };
    case "SET_BG_MUSIC_VOLUME":
      return { ...state, bgMusicVolume: action.volume };
    case "SET_BG_MUSIC_SEGMENTS":
      return { ...state, bgMusicSegments: action.segments };
    case "SET_BG_MUSIC_DURATION": {
      // Initialize a single segment spanning the full track at the clip start
      const segments = state.bgMusicSegments.length > 0
        ? state.bgMusicSegments
        : [{ id: "1", musicStart: 0, musicEnd: action.duration, timelineStart: state.trimStart }];
      return { ...state, bgMusicDuration: action.duration, bgMusicSegments: segments };
    }
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
    subtitlesEnabled: true,
    aspectRatio: "9:16" as AspectRatio,
    words: [],
    subtitleCustomization: { color: "#FFFFFF", fontSize: 48, fontWeight: "bold", uppercase: true },
    bgMusic: null,
    bgMusicName: null,
    bgMusicUrl: null,
    bgMusicVolume: 0.15,
    bgMusicDuration: null,
    bgMusicSegments: [],
    isExporting: false,
  });

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportData, setExportData] = useState<string | null>(null);
  const [exportFilename, setExportFilename] = useState("clip.mp4");
  const [exportDuration, setExportDuration] = useState(0);

  // Fetch timeline thumbnails
  const { spriteUrl } = useTimelineThumbnails({
    projectId,
    start: highlight.start_time,
    end: highlight.end_time,
    count: 30,
    height: 56,
  });

  // Fetch words on mount
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

    fetchWords();
  }, [highlightId]);

  // Detect background music duration when URL changes
  useEffect(() => {
    if (!state.bgMusicUrl) return;
    const audio = new Audio(state.bgMusicUrl);
    const handleMeta = () => {
      if (audio.duration && isFinite(audio.duration)) {
        dispatch({ type: "SET_BG_MUSIC_DURATION", duration: audio.duration });
      }
    };
    audio.addEventListener("loadedmetadata", handleMeta);
    return () => {
      audio.removeEventListener("loadedmetadata", handleMeta);
      audio.src = "";
    };
  }, [state.bgMusicUrl]);

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

  const handleWordEdit = useCallback((index: number, newText: string) => {
    dispatch({ type: "SET_WORD_EDIT", index, newWord: newText });
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
          subtitle_style: state.subtitlesEnabled ? state.subtitleStyle : "none",
          font_color: state.subtitleCustomization.color,
          font_size: state.subtitleCustomization.fontSize,
          font_weight: state.subtitleCustomization.fontWeight,
          bg_music: state.bgMusic,
          bg_music_volume: state.bgMusicVolume,
          bg_music_segments: state.bgMusicSegments.map((s) => ({
            music_start: s.musicStart,
            music_end: s.musicEnd,
            timeline_start: s.timelineStart,
          })),
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
    <div className="flex flex-col h-full">
      {/* Main layout: 3 columns on desktop, stacked on mobile */}
      <div className="flex flex-col lg:flex-row gap-4 mt-4 flex-1 min-h-0 overflow-auto">
        {/* Left: Subtitle Panel + Music */}
        <div className="lg:w-[320px] shrink-0 space-y-5 overflow-auto">
          <SubtitlePanel
            subtitleStyle={state.subtitleStyle}
            subtitleCustomization={state.subtitleCustomization}
            subtitlesEnabled={state.subtitlesEnabled}
            onStyleChange={(style) => dispatch({ type: "SET_SUBTITLE_STYLE", style })}
            onCustomizationChange={(customization) =>
              dispatch({ type: "SET_SUBTITLE_CUSTOMIZATION", customization })
            }
            onColorChange={(color) =>
              dispatch({
                type: "SET_SUBTITLE_CUSTOMIZATION",
                customization: { ...state.subtitleCustomization, color },
              })
            }
            onSubtitlesToggle={(enabled) => dispatch({ type: "SET_SUBTITLES_ENABLED", enabled })}
          />
          <BackgroundMusicSelector
            selectedTrack={state.bgMusic}
            volume={state.bgMusicVolume}
            onTrackChange={(trackId, trackName, audioUrl) => dispatch({ type: "SET_BG_MUSIC", trackId, trackName, trackUrl: audioUrl })}
            onVolumeChange={(volume) => dispatch({ type: "SET_BG_MUSIC_VOLUME", volume })}
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
            subtitlesEnabled={state.subtitlesEnabled}
            aspectRatio={state.aspectRatio}
            words={state.words}
            subtitleCustomization={state.subtitleCustomization}
            bgMusicUrl={state.bgMusicUrl}
            bgMusicVolume={state.bgMusicVolume}
            bgMusicSegments={state.bgMusicSegments}
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
      <div className="mt-2 shrink-0">
        <Timeline
          spriteUrl={spriteUrl}
          trimStart={state.trimStart}
          trimEnd={state.trimEnd}
          currentTime={state.currentTime}
          totalStart={highlight.start_time}
          totalEnd={highlight.end_time}
          words={state.words}
          onTrimChange={handleTrimChange}
          onSeek={handleSeek}
          onWordEdit={handleWordEdit}
          bgMusicName={state.bgMusicName}
          bgMusicVolume={state.bgMusicVolume}
          bgMusicSegments={state.bgMusicSegments}
          bgMusicDuration={state.bgMusicDuration}
          onBgMusicSegmentsChange={(segments) => dispatch({ type: "SET_BG_MUSIC_SEGMENTS", segments })}
          onBgMusicVolumeChange={(volume) => dispatch({ type: "SET_BG_MUSIC_VOLUME", volume })}
          onBgMusicRemove={() => dispatch({ type: "SET_BG_MUSIC", trackId: null, trackName: null, trackUrl: null })}
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
