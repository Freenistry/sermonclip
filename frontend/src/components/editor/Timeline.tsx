"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Music, Volume2, VolumeX, X } from "lucide-react";

interface TimelineProps {
  waveformPeaks: number[];
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  totalStart: number;
  totalEnd: number;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  bgMusicName?: string | null;
  bgMusicVolume?: number;
  onBgMusicVolumeChange?: (volume: number) => void;
  onBgMusicRemove?: () => void;
}

const MIN_TRIM_DURATION = 10;
const HANDLE_WIDTH = 8;

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function Timeline({
  waveformPeaks,
  trimStart,
  trimEnd,
  currentTime,
  totalStart,
  totalEnd,
  onTrimChange,
  onSeek,
  bgMusicName,
  bgMusicVolume = 0.15,
  onBgMusicVolumeChange,
  onBgMusicRemove,
}: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  const totalDuration = totalEnd - totalStart;

  const timeToX = useCallback(
    (time: number, width: number) => {
      return ((time - totalStart) / totalDuration) * width;
    },
    [totalStart, totalDuration]
  );

  const xToTime = useCallback(
    (x: number, width: number) => {
      return totalStart + (x / width) * totalDuration;
    },
    [totalStart, totalDuration]
  );

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Draw waveform bars
    const barWidth = Math.max(1, w / waveformPeaks.length - 1);
    const trimStartX = timeToX(trimStart, w);
    const trimEndX = timeToX(trimEnd, w);

    waveformPeaks.forEach((peak, i) => {
      const x = (i / waveformPeaks.length) * w;
      const barHeight = peak * h * 0.8;
      const y = (h - barHeight) / 2;

      const inTrim = x >= trimStartX && x <= trimEndX;
      ctx.fillStyle = inTrim
        ? "hsl(var(--primary))"
        : "hsl(var(--muted-foreground) / 0.3)";
      ctx.fillRect(x, y, barWidth, barHeight);
    });

    // Draw playhead
    const playheadX = timeToX(currentTime, w);
    if (playheadX >= 0 && playheadX <= w) {
      ctx.strokeStyle = "hsl(var(--foreground))";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.stroke();
    }
  }, [waveformPeaks, trimStart, trimEnd, currentTime, timeToX]);

  const handlePointerDown = (e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;

    const startX = timeToX(trimStart, w);
    const endX = timeToX(trimEnd, w);

    // Check if clicking near a handle
    if (Math.abs(x - startX) < HANDLE_WIDTH * 2) {
      setDragging("start");
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (Math.abs(x - endX) < HANDLE_WIDTH * 2) {
      setDragging("end");
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (x > startX && x < endX) {
      // Click within trim region to seek
      onSeek(xToTime(x, w));
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const time = xToTime(x, rect.width);

    if (dragging === "start") {
      const newStart = Math.max(
        totalStart,
        Math.min(time, trimEnd - MIN_TRIM_DURATION)
      );
      onTrimChange(newStart, trimEnd);
    } else {
      const newEnd = Math.min(
        totalEnd,
        Math.max(time, trimStart + MIN_TRIM_DURATION)
      );
      onTrimChange(trimStart, newEnd);
    }
  };

  const handlePointerUp = () => {
    setDragging(null);
  };

  const startPct = ((trimStart - totalStart) / totalDuration) * 100;
  const endPct = ((trimEnd - totalStart) / totalDuration) * 100;

  return (
    <div className="space-y-1">
      {/* Track label */}
      <div className="flex items-center gap-1.5 px-1 mb-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Video
        </span>
      </div>

      {/* Video waveform timeline */}
      <div
        ref={containerRef}
        className="relative h-20 bg-muted/30 rounded-lg border select-none touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Trim handles */}
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-primary rounded-l cursor-col-resize z-10"
          style={{ left: `${startPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-primary rounded-r cursor-col-resize z-10"
          style={{ left: `${endPct}%` }}
        />
      </div>

      {/* Music track bar — only visible when music is selected */}
      {bgMusicName && (
        <>
          <div className="flex items-center gap-1.5 px-1 mt-2 mb-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Music
            </span>
          </div>
          <div className="relative h-10 rounded-lg border border-violet-500/30 bg-violet-500/5 overflow-hidden">
            {/* Repeating pattern to show it spans the whole clip */}
            <div
              className="absolute top-0 bottom-0 bg-violet-500/10"
              style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
            />

            <div className="relative h-full flex items-center px-3 gap-2">
              <Music className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-xs font-medium text-violet-300 truncate flex-1">
                {bgMusicName}
              </span>

              {/* Inline volume */}
              {onBgMusicVolumeChange && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <VolumeX className="w-3 h-3 text-muted-foreground" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(bgMusicVolume * 100)}
                    onChange={(e) =>
                      onBgMusicVolumeChange(Number(e.target.value) / 100)
                    }
                    className="w-16 h-1 accent-violet-500 cursor-pointer"
                  />
                  <Volume2 className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">
                    {Math.round(bgMusicVolume * 100)}%
                  </span>
                </div>
              )}

              {/* Remove button */}
              {onBgMusicRemove && (
                <button
                  onClick={onBgMusicRemove}
                  className="w-5 h-5 flex items-center justify-center rounded hover:bg-violet-500/20 transition-colors shrink-0"
                  title="Remove music"
                >
                  <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Time labels */}
      <div className="flex justify-between text-xs text-muted-foreground px-1">
        <span>{formatTime(trimStart)}</span>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(trimEnd)}</span>
      </div>
    </div>
  );
}
