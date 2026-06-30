"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";

interface VideoThumbnailProps {
  videoUrl: string;
}

export function VideoThumbnail({ videoUrl }: VideoThumbnailProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Upload className="h-10 w-10 text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={`${videoUrl}#t=2`}
      muted
      preload="metadata"
      playsInline
      className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
      onLoadedData={() => setLoaded(true)}
      onError={() => setError(true)}
    />
  );
}
