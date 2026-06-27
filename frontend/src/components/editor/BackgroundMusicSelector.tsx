"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Music,
  Search,
  Play,
  Pause,
  Plus,
  Loader2,
  X,
  Check,
} from "lucide-react";

interface MusicTrack {
  id: string;
  name: string;
  artist?: string;
  duration?: number;
  audio?: string;
  image?: string;
  source: "bundled" | "jamendo";
}

interface MusicCategory {
  id: string;
  label: string;
  tags: string;
}

interface BackgroundMusicSelectorProps {
  selectedTrack: string | null;
  volume: number;
  onTrackChange: (trackId: string | null, trackName: string | null, audioUrl: string | null) => void;
  onVolumeChange: (volume: number) => void;
}

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function BackgroundMusicSelector({
  selectedTrack,
  volume,
  onTrackChange,
  onVolumeChange,
}: BackgroundMusicSelectorProps) {
  const [jamendoTracks, setJamendoTracks] = useState<MusicTrack[]>([]);
  const [categories, setCategories] = useState<MusicCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hasJamendo, setHasJamendo] = useState(true);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Fetch categories on mount
  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch(`${API_URL}/editor/music/categories`);
        if (res.ok) {
          const data = await res.json();
          setCategories(data.categories);
        }
      } catch {
        setHasJamendo(false);
      }
    }
    fetchCategories();
  }, []);

  const searchJamendo = useCallback(
    async (query: string, tags: string) => {
      setIsSearching(true);
      try {
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (tags) params.set("tags", tags);
        params.set("limit", "20");

        const res = await fetch(`${API_URL}/editor/music/search?${params}`);
        if (res.status === 503) {
          setHasJamendo(false);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setJamendoTracks(data.tracks);
        }
      } catch {
        console.error("Failed to search music");
      } finally {
        setIsSearching(false);
      }
    },
    []
  );

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!searchQuery.trim()) {
      if (!activeCategory) setJamendoTracks([]);
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      setActiveCategory(null);
      searchJamendo(searchQuery.trim(), "");
    }, 400);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, activeCategory, searchJamendo]);

  const handleCategoryClick = (cat: MusicCategory) => {
    if (activeCategory === cat.id) {
      setActiveCategory(null);
      setJamendoTracks([]);
      return;
    }
    setActiveCategory(cat.id);
    setSearchQuery("");
    searchJamendo("", cat.tags);
  };

  const togglePreview = (track: MusicTrack) => {
    if (previewingId === track.id) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }

    const audioUrl = track.audio;
    if (!audioUrl) return;

    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(audioUrl);
    audio.volume = 0.5;
    audio.onended = () => setPreviewingId(null);
    audio.play();
    audioRef.current = audio;
    setPreviewingId(track.id);
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const renderTrackCard = (track: MusicTrack) => {
    const isSelected = selectedTrack === track.id;
    const isPreviewing = previewingId === track.id;

    return (
      <div
        key={track.id}
        className={`group flex items-center gap-2.5 p-2 rounded-xl transition-all ${
          isSelected
            ? "bg-primary/10 ring-1 ring-primary/30"
            : "hover:bg-muted/60"
        }`}
      >
        {/* Album art / play overlay */}
        <div
          className="relative w-11 h-11 rounded-lg bg-muted shrink-0 overflow-hidden cursor-pointer"
          onClick={() => togglePreview(track)}
        >
          {track.image ? (
            <img
              src={track.image}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
              <Music className="w-4 h-4 text-primary/50" />
            </div>
          )}
          {/* Play/pause overlay */}
          <div
            className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${
              isPreviewing
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {isPreviewing ? (
              <Pause className="w-4 h-4 text-white" fill="white" />
            ) : (
              <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
            )}
          </div>
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm truncate ${isSelected ? "font-medium text-primary" : ""}`}
          >
            {track.name}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {track.artist && <span className="truncate">{track.artist}</span>}
            {track.artist && track.duration ? (
              <span className="shrink-0">·</span>
            ) : null}
            {track.duration ? (
              <span className="tabular-nums shrink-0">
                {formatDuration(track.duration)}
              </span>
            ) : null}
          </div>
        </div>

        {/* Add / Selected button */}
        {isSelected ? (
          <button
            onClick={() => onTrackChange(null, null, null)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0"
            title="Remove"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => onTrackChange(track.id, track.name, track.audio || null)}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-border hover:bg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Add to clip"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Music className="w-4 h-4" />
        Background Music
      </h3>

      {hasJamendo && (
        <>
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search music..."
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setJamendoTracks([]);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  activeCategory === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted-foreground/20 text-muted-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Results */}
          {isSearching && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-sm">Searching...</span>
            </div>
          )}

          {!isSearching && jamendoTracks.length > 0 && (
            <div className="space-y-0.5 max-h-[340px] overflow-y-auto -mx-1 px-1">
              {jamendoTracks.map((t) => renderTrackCard(t))}
            </div>
          )}

          {!isSearching &&
            jamendoTracks.length === 0 &&
            !searchQuery &&
            !activeCategory && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Browse categories or search to find music
              </p>
            )}

          {!isSearching &&
            jamendoTracks.length === 0 &&
            (searchQuery || activeCategory) && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No tracks found
              </p>
            )}

          <p className="text-[10px] text-muted-foreground/50 px-1">
            Music from Jamendo — CC licensed
          </p>
        </>
      )}
    </div>
  );
}
