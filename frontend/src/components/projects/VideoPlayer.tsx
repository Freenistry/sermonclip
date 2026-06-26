"use client";

import { useEffect, useRef, useCallback } from "react";
import { extractVideoId } from "@/lib/youtube";

interface VideoPlayerProps {
  sourceType: "youtube" | "upload";
  youtubeUrl?: string;
  videoUrl?: string;
  startTime: number;
  endTime: number;
}

export function VideoPlayer({
  sourceType,
  youtubeUrl,
  videoUrl,
  startTime,
  endTime,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameRef = useRef<number>(0);

  const checkTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime >= endTime) {
      video.pause();
      video.currentTime = startTime;
      return;
    }
    if (!video.paused) {
      animationFrameRef.current = requestAnimationFrame(checkTime);
    }
  }, [startTime, endTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || sourceType !== "upload") return;

    video.currentTime = startTime;

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
  }, [sourceType, startTime, endTime, checkTime]);

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
