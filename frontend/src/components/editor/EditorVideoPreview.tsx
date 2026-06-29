"use client";

import { useRef, useEffect, useCallback } from "react";
import { SubtitleOverlay } from "./SubtitleOverlay";
import type { SubtitleStyle } from "./SubtitleStyleSelector";
import type { AspectRatio } from "./AspectRatioSelector";
import type { WordTimestamp, SubtitleCustomization } from "./types";
import type { BgMusicSegment } from "./ClipEditor";

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
  bgMusicSegments?: BgMusicSegment[];
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
  bgMusicSegments = [],
  onTimeUpdate,
  onPlayPause,
}: EditorVideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  // Find the active segment for a given video time
  const findActiveSegment = useCallback(
    (videoTime: number): BgMusicSegment | null => {
      for (const seg of bgMusicSegments) {
        const segDuration = seg.musicEnd - seg.musicStart;
        if (videoTime >= seg.timelineStart && videoTime < seg.timelineStart + segDuration) {
          return seg;
        }
      }
      return null;
    },
    [bgMusicSegments]
  );

  const updateTime = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!video.paused) {
      onTimeUpdate(video.currentTime);

      // Loop within trim bounds
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart;
      }

      // Sync background music with active segment
      const bgAudio = bgAudioRef.current;
      if (bgAudio) {
        const activeSeg = findActiveSegment(video.currentTime);
        if (activeSeg) {
          const expectedMusicTime = activeSeg.musicStart + (video.currentTime - activeSeg.timelineStart);
          if (bgAudio.paused) {
            bgAudio.currentTime = expectedMusicTime;
            bgAudio.play().catch(() => {});
          } else if (Math.abs(bgAudio.currentTime - expectedMusicTime) > 0.3) {
            bgAudio.currentTime = expectedMusicTime;
          }
        } else if (!bgAudio.paused) {
          bgAudio.pause();
        }
      }
    }

    rafRef.current = requestAnimationFrame(updateTime);
  }, [trimStart, trimEnd, findActiveSegment, onTimeUpdate]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateTime]);

  // Manage background music audio element — reuse a single Audio to keep browser trust
  useEffect(() => {
    if (!bgMusicUrl) {
      if (bgAudioRef.current) {
        bgAudioRef.current.pause();
        bgAudioRef.current.removeAttribute("src");
      }
      return;
    }

    if (!bgAudioRef.current) {
      const audio = new Audio();
      audio.loop = false;
      audio.preload = "auto";
      bgAudioRef.current = audio;
    }

    const audio = bgAudioRef.current;
    audio.pause();
    audio.volume = bgMusicVolume;
    audio.src = bgMusicUrl;

    // If video is already playing, start bg music once audio is ready
    const video = videoRef.current;
    if (video && !video.paused) {
      const startPlayback = () => {
        const activeSeg = findActiveSegment(video.currentTime);
        if (activeSeg) {
          audio.currentTime = activeSeg.musicStart + (video.currentTime - activeSeg.timelineStart);
        }
        audio.play().catch(() => {});
      };
      if (audio.readyState >= 2) {
        startPlayback();
      } else {
        audio.addEventListener("canplay", startPlayback, { once: true });
      }
    }

    return () => {
      audio.removeEventListener("canplay", () => {});
    };
  }, [bgMusicUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (bgAudioRef.current) {
        bgAudioRef.current.pause();
        bgAudioRef.current.removeAttribute("src");
        bgAudioRef.current = null;
      }
    };
  }, []);

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
      // Start bg music on user-initiated play
      if (bgAudioRef.current) {
        const activeSeg = findActiveSegment(video.currentTime);
        if (activeSeg) {
          bgAudioRef.current.currentTime = activeSeg.musicStart + (video.currentTime - activeSeg.timelineStart);
        }
        bgAudioRef.current.play().catch(() => {});
      }
    } else if (!isPlaying && !video.paused) {
      video.pause();
      bgAudioRef.current?.pause();
    }
  }, [isPlaying, findActiveSegment]);

  // Seek when currentTime changes externally (e.g., timeline click)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.paused) return;
    if (Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime;
      // Seek bg music to matching segment position
      if (bgAudioRef.current) {
        const activeSeg = findActiveSegment(currentTime);
        if (activeSeg) {
          bgAudioRef.current.currentTime = activeSeg.musicStart + (currentTime - activeSeg.timelineStart);
        }
      }
    }
  }, [currentTime, findActiveSegment]);

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
