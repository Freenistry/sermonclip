"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Scissors, Download, Trash2, Loader2, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

interface SavedClip {
  id: string;
  church_id: string;
  project_id: string;
  highlight_id: string;
  title: string;
  filename: string;
  video_path: string;
  duration_seconds: number | null;
  quote_text: string | null;
  created_at: string;
  project_title: string | null;
}

interface EnrichedClip extends SavedClip {
  signed_url: string | null;
  thumbnail_url: string | null;
}

interface ClipLibraryProps {
  clips: SavedClip[];
  churchId?: string;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ClipLibrary({ clips: initialClips, churchId }: ClipLibraryProps) {
  const [clips, setClips] = useState<EnrichedClip[]>(
    initialClips.map((c) => ({ ...c, signed_url: null, thumbnail_url: null }))
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [playingClip, setPlayingClip] = useState<EnrichedClip | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch signed URLs on mount
  useEffect(() => {
    if (!churchId || initialClips.length === 0) {
      setIsLoading(false);
      return;
    }

    async function fetchSignedUrls() {
      try {
        const res = await fetch(`${API_URL}/clip/saved?church_id=${churchId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const urlMap = new Map<string, { signed_url: string | null; thumbnail_url: string | null }>();
        for (const c of data.clips) {
          urlMap.set(c.id, { signed_url: c.signed_url, thumbnail_url: c.thumbnail_url });
        }
        setClips((prev) =>
          prev.map((clip) => ({
            ...clip,
            signed_url: urlMap.get(clip.id)?.signed_url || null,
            thumbnail_url: urlMap.get(clip.id)?.thumbnail_url || null,
          }))
        );
      } catch {
        // Signed URLs are optional — cards still render
      } finally {
        setIsLoading(false);
      }
    }

    fetchSignedUrls();
  }, [churchId, initialClips.length]);

  const handleDelete = async (clipId: string) => {
    setDeletingId(clipId);
    try {
      const res = await fetch(`${API_URL}/clip/saved/${clipId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete clip");
      setClips((prev) => prev.filter((c) => c.id !== clipId));
      if (playingClip?.id === clipId) setPlayingClip(null);
      toast.success("Clip deleted");
    } catch {
      toast.error("Failed to delete clip");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (clip: EnrichedClip) => {
    if (!clip.signed_url) {
      toast.error("Download not available");
      return;
    }
    const link = document.createElement("a");
    link.href = clip.signed_url;
    link.download = clip.filename;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (clips.length === 0) {
    return (
      <div className="text-center py-16">
        <Scissors className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">No saved clips yet.</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Generate a clip from a highlight and click &quot;Save to Library&quot; to see it here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {clips.map((clip) => {
          const duration = formatDuration(clip.duration_seconds);

          return (
            <Card key={clip.id} className="overflow-hidden group">
              <div
                className="relative aspect-video bg-muted cursor-pointer"
                onClick={() => clip.signed_url && setPlayingClip(clip)}
              >
                {clip.thumbnail_url ? (
                  <img
                    src={clip.thumbnail_url}
                    alt={clip.title}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Scissors className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                )}
                {clip.signed_url && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="h-5 w-5 text-white ml-0.5" fill="white" />
                    </div>
                  </div>
                )}
                {duration && (
                  <span className="absolute bottom-2 right-2 bg-black/75 text-white text-xs font-medium px-1.5 py-0.5 rounded">
                    {duration}
                  </span>
                )}
              </div>
              <div className="p-3 space-y-2">
                <h3 className="font-semibold text-sm line-clamp-1">{clip.title}</h3>

                {clip.quote_text && (
                  <p className="text-xs text-muted-foreground line-clamp-2 italic">
                    &quot;{clip.quote_text}&quot;
                  </p>
                )}

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  {clip.project_title ? (
                    <Link
                      href={`/projects/${clip.project_id}`}
                      className="hover:text-primary truncate max-w-[60%]"
                    >
                      {clip.project_title}
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span>{formatDate(clip.created_at)}</span>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleDownload(clip)}
                    disabled={!clip.signed_url}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Download
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="hover:bg-destructive/10"
                          disabled={deletingId === clip.id}
                        />
                      }
                    >
                      {deletingId === clip.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete clip?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete &quot;{clip.title}&quot;. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(clip.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Video playback modal */}
      <Dialog open={!!playingClip} onOpenChange={(open) => !open && setPlayingClip(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {playingClip?.title}
              {playingClip?.duration_seconds && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({formatDuration(playingClip.duration_seconds)})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="bg-muted rounded-lg overflow-hidden">
            {playingClip?.signed_url && (
              <video
                key={playingClip.id}
                src={playingClip.signed_url}
                controls
                autoPlay
                className="w-full max-h-[400px]"
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
