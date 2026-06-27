"use client";

import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import { Music, Volume2, VolumeX, X } from "lucide-react";
import type { WordTimestamp } from "./types";

interface TimelineProps {
  spriteUrl: string | null;
  frameCount: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  totalStart: number;
  totalEnd: number;
  words: WordTimestamp[];
  onTrimChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  onWordEdit: (index: number, newText: string) => void;
  bgMusicName?: string | null;
  bgMusicVolume?: number;
  onBgMusicVolumeChange?: (volume: number) => void;
  onBgMusicRemove?: () => void;
}

const MIN_TRIM_DURATION = 5;
const TRACK_LABEL_W = 32;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getTickInterval(duration: number): { major: number; minor: number } {
  if (duration <= 15) return { major: 1, minor: 0.5 };
  if (duration <= 60) return { major: 5, minor: 1 };
  if (duration <= 180) return { major: 10, minor: 5 };
  return { major: 30, minor: 10 };
}

function groupIntoPhrases(words: WordTimestamp[], size: number = 8): WordTimestamp[][] {
  const phrases: WordTimestamp[][] = [];
  for (let i = 0; i < words.length; i += size) {
    phrases.push(words.slice(i, i + size));
  }
  return phrases;
}

export function Timeline({
  spriteUrl,
  frameCount,
  trimStart,
  trimEnd,
  currentTime,
  totalStart,
  totalEnd,
  words,
  onTrimChange,
  onSeek,
  onWordEdit,
  bgMusicName,
  bgMusicVolume = 0.15,
  onBgMusicVolumeChange,
  onBgMusicRemove,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | "playhead" | null>(null);
  const [editingPhrase, setEditingPhrase] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  const totalDuration = totalEnd - totalStart;

  const timeToPercent = useCallback(
    (time: number) => ((time - totalStart) / totalDuration) * 100,
    [totalStart, totalDuration]
  );

  const phrases = useMemo(() => groupIntoPhrases(words), [words]);

  // Close popover on outside click
  useEffect(() => {
    if (editingPhrase === null) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setEditingPhrase(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editingPhrase]);

  // --- Pointer handlers for trim/seek ---
  const getTimeFromPointer = useCallback(
    (clientX: number): number | null => {
      const tracks = tracksRef.current;
      if (!tracks) return null;
      const rect = tracks.getBoundingClientRect();
      const x = clientX - rect.left;
      const w = rect.width;
      if (w <= 0) return null;
      return totalStart + (Math.max(0, Math.min(x, w)) / w) * totalDuration;
    },
    [totalStart, totalDuration]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    const tracks = tracksRef.current;
    if (!tracks) return;

    const rect = tracks.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    if (w <= 0) return;

    const startX = (timeToPercent(trimStart) / 100) * w;
    const endX = (timeToPercent(trimEnd) / 100) * w;

    if (Math.abs(x - startX) < 12) {
      setDragging("start");
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(x - endX) < 12) {
      setDragging("end");
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      const time = getTimeFromPointer(e.clientX);
      if (time !== null) {
        onSeek(Math.max(trimStart, Math.min(trimEnd, time)));
        setDragging("playhead");
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const time = getTimeFromPointer(e.clientX);
    if (time === null) return;

    if (dragging === "start") {
      onTrimChange(Math.max(totalStart, Math.min(time, trimEnd - MIN_TRIM_DURATION)), trimEnd);
    } else if (dragging === "end") {
      onTrimChange(trimStart, Math.min(totalEnd, Math.max(time, trimStart + MIN_TRIM_DURATION)));
    } else if (dragging === "playhead") {
      onSeek(Math.max(trimStart, Math.min(trimEnd, time)));
    }
  };

  const handlePointerUp = () => setDragging(null);

  // --- Subtitle popover ---
  const handlePhraseClick = (phraseIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const phrase = phrases[phraseIdx];
    setEditText(phrase.map((w) => w.word).join(" "));
    setEditingPhrase(phraseIdx);
  };

  const handlePhraseEditSubmit = () => {
    if (editingPhrase === null) return;
    const phrase = phrases[editingPhrase];
    const newWords = editText.trim().split(/\s+/);
    let globalIdx = 0;
    for (let i = 0; i < editingPhrase; i++) {
      globalIdx += phrases[i].length;
    }
    for (let i = 0; i < phrase.length; i++) {
      const newWord = i < newWords.length ? newWords[i] : "";
      if (newWord !== phrase[i].word) {
        onWordEdit(globalIdx + i, newWord);
      }
    }
    setEditingPhrase(null);
  };

  // --- Ticks ---
  const { major, minor } = getTickInterval(totalDuration);
  const ticks: { time: number; label: string | null }[] = [];
  for (let t = totalStart; t <= totalEnd + 0.001; t += minor) {
    const relT = t - totalStart;
    const isMajor = Math.abs(relT % major) < 0.01 || Math.abs(relT % major - major) < 0.01;
    ticks.push({ time: t, label: isMajor ? formatTime(t) : null });
  }

  const startPct = timeToPercent(trimStart);
  const endPct = timeToPercent(trimEnd);
  const playheadPct = timeToPercent(currentTime);

  return (
    <div className="relative select-none touch-none">
      {/* Container with label gutter + tracks area */}
      <div className="flex">
        {/* Track labels column */}
        <div className="shrink-0" style={{ width: TRACK_LABEL_W }} />

        {/* Time Ruler */}
        <div className="relative flex-1 h-7 border-b border-border">
          {ticks.map((tick, i) => {
            const pct = timeToPercent(tick.time);
            return (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: `${pct}%` }}>
                <div
                  className="bg-muted-foreground/40 mx-auto"
                  style={{
                    width: 1,
                    height: tick.label ? 12 : 6,
                    marginTop: tick.label ? 0 : 6,
                  }}
                />
                {tick.label && (
                  <span className="absolute top-[13px] -translate-x-1/2 text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
                    {tick.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tracks container — pointer events + playhead reference */}
      <div
        ref={containerRef}
        className="relative"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="flex">
          {/* Track labels */}
          <div className="shrink-0 flex flex-col" style={{ width: TRACK_LABEL_W }}>
            {/* Video label */}
            <div className="h-[56px] flex items-center justify-center text-muted-foreground mt-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
            </div>
            {/* Audio label */}
            {bgMusicName && (
              <div className="h-9 flex items-center justify-center text-muted-foreground mt-1">
                <Music className="w-3.5 h-3.5" />
              </div>
            )}
            {/* Subtitle label */}
            <div className="h-8 flex items-center justify-center text-muted-foreground mt-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" />
                <line x1="6" y1="14" x2="18" y2="14" />
                <line x1="8" y1="18" x2="16" y2="18" />
              </svg>
            </div>
          </div>

          {/* Track content area */}
          <div ref={tracksRef} className="flex-1 relative">
            {/* ── Video Track ── */}
            <div className="relative h-[56px] rounded-md overflow-hidden border border-border bg-zinc-900 mt-1">
              {/* Sprite filmstrip */}
              {spriteUrl ? (
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${spriteUrl})`,
                    backgroundSize: `${frameCount * 100}% 100%`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "left center",
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground animate-pulse">
                  Loading frames...
                </div>
              )}

              {/* Dimmed regions outside trim */}
              <div
                className="absolute top-0 bottom-0 left-0 bg-black/60 pointer-events-none"
                style={{ width: `${startPct}%` }}
              />
              <div
                className="absolute top-0 bottom-0 right-0 bg-black/60 pointer-events-none"
                style={{ width: `${100 - endPct}%` }}
              />

              {/* Trim border */}
              <div
                className="absolute top-0 bottom-0 border-y-2 border-primary pointer-events-none z-[5]"
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
              />

              {/* Trim handles */}
              <div
                className="absolute top-0 bottom-0 w-[6px] bg-primary cursor-col-resize z-10 rounded-l-sm"
                style={{ left: `${startPct}%` }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-4 bg-primary-foreground/60 rounded-full" />
              </div>
              <div
                className="absolute top-0 bottom-0 w-[6px] bg-primary cursor-col-resize z-10 rounded-r-sm"
                style={{ left: `${endPct}%`, transform: "translateX(-100%)" }}
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[2px] h-4 bg-primary-foreground/60 rounded-full" />
              </div>
            </div>

            {/* ── Audio Track ── */}
            {bgMusicName && (
              <div className="relative h-9 rounded-md border border-violet-500/30 bg-violet-500/5 overflow-hidden mt-1">
                <div
                  className="absolute top-0 bottom-0 bg-violet-500/10"
                  style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                />
                <div className="relative h-full flex items-center px-3 gap-2">
                  <span className="text-xs font-medium text-violet-300 truncate flex-1">
                    {bgMusicName}
                  </span>
                  {onBgMusicVolumeChange && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <VolumeX className="w-3 h-3 text-muted-foreground" />
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(bgMusicVolume * 100)}
                        onChange={(e) => onBgMusicVolumeChange(Number(e.target.value) / 100)}
                        className="w-16 h-1 accent-violet-500 cursor-pointer"
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                      <Volume2 className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">
                        {Math.round(bgMusicVolume * 100)}%
                      </span>
                    </div>
                  )}
                  {onBgMusicRemove && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onBgMusicRemove(); }}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-violet-500/20 transition-colors shrink-0"
                      title="Remove music"
                    >
                      <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Subtitle Track ── */}
            <div className="relative h-8 rounded-md border border-border bg-muted/20 overflow-visible mt-1">
              {phrases.map((phrase, idx) => {
                if (phrase.length === 0) return null;
                const pStart = timeToPercent(phrase[0].start);
                const pEnd = timeToPercent(phrase[phrase.length - 1].end);
                const widthPct = Math.max(pEnd - pStart, 0.5);
                return (
                  <div
                    key={idx}
                    className={`absolute top-[3px] bottom-[3px] rounded cursor-pointer transition-colors flex items-center px-1.5 overflow-hidden border ${
                      editingPhrase === idx
                        ? "bg-sky-500/30 border-sky-400"
                        : "bg-sky-500/15 border-sky-500/30 hover:bg-sky-500/25"
                    }`}
                    style={{ left: `${pStart}%`, width: `${widthPct}%` }}
                    onClick={(e) => handlePhraseClick(idx, e)}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className="text-[9px] text-sky-200 truncate leading-none whitespace-nowrap">
                      {phrase.map((w) => w.word).join(" ")}
                    </span>
                  </div>
                );
              })}

              {/* Popover editor */}
              {editingPhrase !== null && phrases[editingPhrase] && (
                <div
                  ref={popoverRef}
                  className="absolute z-50 bg-popover border border-border rounded-lg shadow-xl p-3 w-64"
                  style={{
                    left: `${Math.min(timeToPercent(phrases[editingPhrase][0].start), 70)}%`,
                    bottom: "calc(100% + 8px)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <label className="text-[11px] text-muted-foreground font-medium mb-1.5 block">
                    Edit subtitle text
                  </label>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handlePhraseEditSubmit();
                      }
                      if (e.key === "Escape") setEditingPhrase(null);
                    }}
                    className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={2}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <button
                      onClick={() => setEditingPhrase(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePhraseEditSubmit}
                      className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded hover:bg-primary/90"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Playhead ── */}
            {playheadPct >= 0 && playheadPct <= 100 && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-20"
                style={{ left: `${playheadPct}%` }}
              >
                <div className="absolute top-0 bottom-0 w-[2px] bg-white -translate-x-1/2" />
                <div className="absolute -top-1 w-3 h-3 bg-white rounded-full -translate-x-1/2" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Time display */}
      <div className="flex justify-between text-xs text-muted-foreground mt-1.5" style={{ paddingLeft: TRACK_LABEL_W }}>
        <span>{formatTime(trimStart)}</span>
        <span className="font-medium text-foreground">{formatTime(currentTime)}</span>
        <span>{formatTime(trimEnd)}</span>
      </div>
    </div>
  );
}
