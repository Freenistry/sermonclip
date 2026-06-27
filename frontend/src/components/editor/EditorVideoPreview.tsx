"use client";

import { useRef, useEffect, useCallback } from "react";
import { SubtitleOverlay } from "./SubtitleOverlay";
import type { SubtitleStyle } from "./SubtitleStyleSelector";
import type { AspectRatio } from "./AspectRatioSelector";
import type { WordTimestamp, SubtitleCustomization } from "./types";

interface EditorVideoPreviewProps {
  videoSrc: string;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  isPlaying: boolean;
  subtitleStyle: SubtitleStyle;
  subtitlesEnabled?: boolean;
  aspectRatio: AspectRatio;
  words: WordTimestamp[];
  subtitleCustomization?: SubtitleCustomization;
  bgMusicUrl?: string | null;
  bgMusicVolume?: number;
  onTimeUpdate: (time: number) => void;
  onPlayPause: (playing: boolean) => void;
}

const ASPECT_SIZES: Record<AspectRatio, { w: number; h: number }> = {
  "9:16": { w: 270, h: 480 },
  "16:9": { w: 480, h: 270 },
  "1:1": { w: 360, h: 360 },
};

export function EditorVideoPreview({
  videoSrc,
  trimStart,
  trimEnd,
  currentTime,
  isPlaying,
  subtitleStyle,
  subtitlesEnabled = true,
  aspectRatio,
  words,
  subtitleCustomization,
  bgMusicUrl,
  bgMusicVolume = 0.15,
  onTimeUpdate,
  onPlayPause,
}: EditorVideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  const updateTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!video.paused) {
      onTimeUpdate(video.currentTime);

      // Loop within trim bounds
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart;
      }
    }

    rafRef.current = requestAnimationFrame(updateTime);
  }, [trimStart, trimEnd, onTimeUpdate]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateTime]);

  // Manage background music audio element
  useEffect(() => {
    if (!bgMusicUrl) {
      if (bgAudioRef.current) {
        bgAudioRef.current.pause();
        bgAudioRef.current = null;
      }
      return;
    }

    const audio = new Audio(bgMusicUrl);
    audio.loop = true;
    audio.volume = bgMusicVolume;
    bgAudioRef.current = audio;

    return () => {
      audio.pause();
      bgAudioRef.current = null;
    };
  }, [bgMusicUrl]); // only recreate when URL changes

  // Update volume on the bg audio element
  useEffect(() => {
    if (bgAudioRef.current) {
      bgAudioRef.current.volume = bgMusicVolume;
    }
  }, [bgMusicVolume]);

  // Sync play/pause state (video + bg music)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && video.paused) {
      video.play().catch(() => {});
      bgAudioRef.current?.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
      bgAudioRef.current?.pause();
    }
  }, [isPlaying]);

  // Seek when currentTime changes externally (e.g., timeline click)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.paused) return;
    if (Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime;
      // Reset bg music to start on seek (it loops independently)
      if (bgAudioRef.current) {
        bgAudioRef.current.currentTime = 0;
      }
    }
  }, [currentTime]);

  const size = ASPECT_SIZES[aspectRatio];

  const handleClick = () => {
    onPlayPause(!isPlaying);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative bg-black rounded-lg overflow-hidden cursor-pointer"
        style={{ width: size.w, height: size.h }}
        onClick={handleClick}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full h-full object-cover"
          playsInline
          onPlay={() => onPlayPause(true)}
          onPause={() => onPlayPause(false)}
        />
        {subtitlesEnabled && (
          <SubtitleOverlay
            words={words}
            currentTime={currentTime}
            style={subtitleStyle}
            customization={subtitleCustomization}
          />
        )}
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center">
              <div className="w-0 h-0 border-l-[16px] border-l-black border-t-[10px] border-t-transparent border-b-[10px] border-b-transparent ml-1" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
