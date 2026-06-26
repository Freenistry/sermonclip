"use client";

import { useEffect, useState } from "react";
import { Music, Volume2, VolumeX } from "lucide-react";

interface MusicTrack {
  id: string;
  name: string;
}

interface BackgroundMusicSelectorProps {
  selectedTrack: string | null;
  volume: number;
  onTrackChange: (trackId: string | null) => void;
  onVolumeChange: (volume: number) => void;
}

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

export function BackgroundMusicSelector({
  selectedTrack,
  volume,
  onTrackChange,
  onVolumeChange,
}: BackgroundMusicSelectorProps) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);

  useEffect(() => {
    async function fetchTracks() {
      try {
        const res = await fetch(`${API_URL}/editor/music`);
        if (res.ok) {
          const data = await res.json();
          setTracks(data.tracks);
        }
      } catch {
        console.error("Failed to fetch music tracks");
      }
    }
    fetchTracks();
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Music className="w-4 h-4" />
        Background Music
      </h3>

      {/* Track list */}
      <div className="space-y-1">
        <button
          onClick={() => onTrackChange(null)}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            selectedTrack === null
              ? "bg-primary/10 text-primary font-medium"
              : "hover:bg-muted text-muted-foreground"
          }`}
        >
          None
        </button>
        {tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => onTrackChange(track.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              selectedTrack === track.id
                ? "bg-primary/10 text-primary font-medium"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            {track.name}
          </button>
        ))}
      </div>

      {/* Volume slider — only show when a track is selected */}
      {selectedTrack && (
        <div className="flex items-center gap-2 px-1">
          <VolumeX className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(volume * 100)}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            className="flex-1 h-1.5 accent-primary cursor-pointer"
          />
          <Volume2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}
    </div>
  );
}
