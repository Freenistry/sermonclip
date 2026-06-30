import { useEffect, useRef, useCallback } from "react";
import { extractVideoId } from "@/lib/youtube";

interface VideoPlayerProps {
  sourceType: "youtube" | "upload";
  youtubeUrl?: string;
  videoUrl?: string;
  startTime: number;
  endTime: number;
  timeRanges?: { start: number; end: number }[];
}

export function VideoPlayer({
  sourceType,
  youtubeUrl,
  videoUrl,
  startTime,
  endTime,
  timeRanges,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number>(0);
  const segmentIndexRef = useRef<number>(0);

  const hasMultiSegment = timeRanges && timeRanges.length >= 2;

  const checkTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (hasMultiSegment) {
      const idx = segmentIndexRef.current;
      const currentSegment = timeRanges[idx];
      if (video.currentTime >= currentSegment.end) {
        if (idx < timeRanges.length - 1) {
          // Jump to next segment
          segmentIndexRef.current = idx + 1;
          video.currentTime = timeRanges[idx + 1].start;
        } else {
          // Last segment ended — pause and reset
          video.pause();
          segmentIndexRef.current = 0;
          video.currentTime = timeRanges[0].start;
          return;
        }
      }
    } else {
      if (video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        return;
      }
    }

    if (!video.paused) {
      animationFrameRef.current = requestAnimationFrame(checkTime);
    }
  }, [startTime, endTime, hasMultiSegment, timeRanges]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || sourceType !== "upload") return;

    segmentIndexRef.current = 0;
    video.currentTime = hasMultiSegment ? timeRanges[0].start : startTime;

    const handlePlay = () => {
      animationFrameRef.current = requestAnimationFrame(checkTime);
    };
    const handlePause = () => {
      cancelAnimationFrame(animationFrameRef.current);
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [sourceType, startTime, endTime, checkTime, hasMultiSegment, timeRanges]);

  if (sourceType === "youtube" && youtubeUrl) {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) return <div className="text-muted-foreground text-center p-8">Invalid YouTube URL</div>;

    const start = Math.floor(startTime);
    const end = Math.floor(endTime);

    return (
      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?start=${start}&end=${end}&autoplay=0&rel=0`}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Clip preview"
        />
        {hasMultiSegment && (
          <div className="absolute bottom-2 left-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
            Multi-segment preview limited to first segment for YouTube. Full preview available with uploaded video.
          </div>
        )}
      </div>
    );
  }

  if (sourceType === "upload" && videoUrl) {
    return (
      <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>
    );
  }

  return <div className="text-muted-foreground text-center p-8">No video source available</div>;
}
