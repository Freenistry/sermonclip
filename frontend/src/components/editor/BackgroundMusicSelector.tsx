"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Music,
  Search,
  Play,
  Pause,
  Plus,
  Loader2,
  X,
  Check,
  Upload,
  Trash2,
  Link,
} from "lucide-react";

interface MusicTrack {
  id: string;
  name: string;
  artist?: string;
  duration?: number;
  audio?: string;
  image?: string;
  source: "bundled" | "jamendo" | "upload";
}

interface MusicCategory {
  id: string;
  label: string;
  tags: string;
}

interface BackgroundMusicSelectorProps {
  selectedTrack: string | null;
  volume: number;
  onTrackChange: (
    trackId: string | null,
    trackName: string | null,
    audioUrl: string | null,
    duration: number | null
  ) => void;
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
  const [uploadedTracks, setUploadedTracks] = useState<MusicTrack[]>([]);
  const [categories, setCategories] = useState<MusicCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [hasJamendo, setHasJamendo] = useState(true);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch categories and uploaded tracks on mount
  useEffect(() => {
    fetchCategories();
    fetchUploads();
  }, []);

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

  async function fetchUploads() {
    try {
      const res = await fetch(`${API_URL}/editor/music/uploads`);
      if (res.ok) {
        const data = await res.json();
        setUploadedTracks(
          data.tracks.map((t: MusicTrack) => ({
            ...t,
            audio: t.audio ? `${API_URL}${t.audio}` : undefined,
          }))
        );
      }
    } catch {
      console.error("Failed to fetch uploads");
    }
  }

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_URL}/editor/music/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || "Upload failed");
        return;
      }

      const track = await res.json();
      const audioUrl = `${API_URL}${track.audio}`;

      // Add to uploaded list and auto-select
      await fetchUploads();
      onTrackChange(track.id, track.name, audioUrl, track.duration || null);
    } catch {
      toast.error("Upload failed");
    } finally {
      setIsUploading(false);
      // Reset input so same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteUpload = async (trackId: string) => {
    const fileId = trackId.split(":")[1];
    try {
      await fetch(`${API_URL}/editor/music/upload/${fileId}`, {
        method: "DELETE",
      });
      // If deleting the selected track, clear selection
      if (selectedTrack === trackId) {
        onTrackChange(null, null, null, null);
      }
      await fetchUploads();
    } catch {
      console.error("Failed to delete");
    }
  };

  const handleYoutubeImport = async () => {
    const url = youtubeUrl.trim();
    if (!url) return;

    setIsImporting(true);
    try {
      const res = await fetch(`${API_URL}/editor/music/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.detail || "Import failed");
        return;
      }

      const track = await res.json();
      const audioUrl = `${API_URL}${track.audio}`;

      await fetchUploads();
      onTrackChange(track.id, track.name, audioUrl, track.duration || null);
      setYoutubeUrl("");
    } catch {
      toast.error("Failed to import from YouTube");
    } finally {
      setIsImporting(false);
    }
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

  const renderTrackCard = (track: MusicTrack, showDelete = false) => {
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

        {/* Delete button for uploads */}
        {showDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteUpload(track.id);
            }}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete"
          >
            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
          </button>
        )}

        {/* Add / Selected button */}
        {isSelected ? (
          <button
            onClick={() => onTrackChange(null, null, null, null)}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0"
            title="Remove"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => {
              // Stop any preview audio when selecting a track
              audioRef.current?.pause();
              setPreviewingId(null);
              onTrackChange(track.id, track.name, track.audio || null, track.duration || null);
            }}
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

      {/* Upload / Import section */}
      <div className="space-y-2">
        {/* File upload button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/mp4,.mp3,.wav,.ogg,.aac,.m4a"
          onChange={handleUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Upload MP3 file
            </>
          )}
        </button>

        {/* YouTube URL import */}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleYoutubeImport();
              }}
              placeholder="YouTube URL..."
              disabled={isImporting}
              className="w-full pl-8 pr-2 py-1.5 text-sm bg-muted/50 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <button
            onClick={handleYoutubeImport}
            disabled={isImporting || !youtubeUrl.trim()}
            className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0 flex items-center gap-1.5"
          >
            {isImporting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Importing...
              </>
            ) : (
              "Import"
            )}
          </button>
        </div>
      </div>

      {/* Uploaded tracks */}
      {uploadedTracks.length > 0 && (
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-1">
            Your Music
          </div>
          <div className="space-y-0.5">
            {uploadedTracks.map((t) => renderTrackCard(t, true))}
          </div>
        </div>
      )}

      {/* Jamendo section */}
      {hasJamendo && (
        <>
          {(uploadedTracks.length > 0) && (
            <div className="border-t border-border pt-3">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">
                Music Library
              </div>
            </div>
          )}

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
