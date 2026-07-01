import { useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Music,
  Search,
  Play,
  Pause,
  Loader2,
  X,
  Upload,
  Trash2,
  Link,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

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

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:18080";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MusicLibrary() {
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

      await fetchUploads();
      toast.success("Track uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteUpload = async (trackId: string) => {
    const fileId = trackId.split(":")[1];
    try {
      await fetch(`${API_URL}/editor/music/upload/${fileId}`, {
        method: "DELETE",
      });
      await fetchUploads();
      toast.success("Track deleted");
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

      await fetchUploads();
      setYoutubeUrl("");
      toast.success("Track imported from YouTube");
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

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const renderTrackCard = (track: MusicTrack, showDelete = false) => {
    const isPreviewing = previewingId === track.id;

    return (
      <div
        key={track.id}
        className="group flex items-center gap-3 p-3 rounded-xl hover:bg-muted/60 transition-all"
      >
        <div
          className="relative w-12 h-12 rounded-lg bg-muted shrink-0 overflow-hidden cursor-pointer"
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
              <Music className="w-5 h-5 text-primary/50" />
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

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{track.name}</div>
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

        {showDelete && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-lg hover:bg-destructive/10 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              }
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete track?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{track.name}&quot;. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleDeleteUpload(track.id)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Upload / Import section */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Upload Music</h2>
        <div className="flex flex-col sm:flex-row gap-3">
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
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 sm:w-64"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Upload audio file
              </>
            )}
          </button>

          <div className="flex gap-2 flex-1">
            <div className="relative flex-1">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleYoutubeImport();
                }}
                placeholder="Import from YouTube URL..."
                disabled={isImporting}
                className="w-full pl-9 pr-3 py-3 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              />
            </div>
            <button
              onClick={handleYoutubeImport}
              disabled={isImporting || !youtubeUrl.trim()}
              className="px-4 py-3 text-sm rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 shrink-0 flex items-center gap-1.5"
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
      </div>

      {/* Uploaded tracks */}
      {uploadedTracks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Your Uploads</h2>
          <div className="space-y-0.5">
            {uploadedTracks.map((t) => renderTrackCard(t, true))}
          </div>
        </div>
      )}

      {/* Jamendo browse section */}
      {hasJamendo && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Browse Music</h2>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search music..."
              className="w-full pl-9 pr-9 py-2.5 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setJamendoTracks([]);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat)}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  activeCategory === cat.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted-foreground/20 text-muted-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {isSearching && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-sm">Searching...</span>
            </div>
          )}

          {!isSearching && jamendoTracks.length > 0 && (
            <div className="space-y-0.5">
              {jamendoTracks.map((t) => renderTrackCard(t))}
            </div>
          )}

          {!isSearching &&
            jamendoTracks.length === 0 &&
            !searchQuery &&
            !activeCategory && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Browse categories or search to find music
              </p>
            )}

          {!isSearching &&
            jamendoTracks.length === 0 &&
            (searchQuery || activeCategory) && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No tracks found
              </p>
            )}

          <p className="text-xs text-muted-foreground/50">
            Music from Jamendo - CC licensed
          </p>
        </div>
      )}
    </div>
  );
}
