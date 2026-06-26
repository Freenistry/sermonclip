"use client";

import { useRef, useEffect, useCallback, useState } from "react";

interface TimelineProps {
  waveformPeaks: number[];
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  totalStart: number;
  totalEnd: number;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
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
      ctx.fillStyle = inTrim ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.3)";
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
      const newStart = Math.max(totalStart, Math.min(time, trimEnd - MIN_TRIM_DURATION));
      onTrimChange(newStart, trimEnd);
    } else {
      const newEnd = Math.min(totalEnd, Math.max(time, trimStart + MIN_TRIM_DURATION));
      onTrimChange(trimStart, newEnd);
    }
  };

  const handlePointerUp = () => {
    setDragging(null);
  };

  const containerWidth = containerRef.current?.getBoundingClientRect().width || 1;
  const startHandleX = timeToX(trimStart, containerWidth);
  const endHandleX = timeToX(trimEnd, containerWidth);

  return (
    <div className="space-y-1">
      <div
        ref={containerRef}
        className="relative h-20 bg-muted/30 rounded-lg border select-none touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Trim handles - visual overlay */}
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-primary rounded-l cursor-col-resize z-10"
          style={{ left: startHandleX - HANDLE_WIDTH / 2 }}
        />
        <div
          className="absolute top-0 bottom-0 w-1.5 bg-primary rounded-r cursor-col-resize z-10"
          style={{ left: endHandleX - HANDLE_WIDTH / 2 }}
        />
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-xs text-muted-foreground px-1">
        <span>{formatTime(trimStart)}</span>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(trimEnd)}</span>
      </div>
    </div>
  );
}
