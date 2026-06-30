"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, File, X, Link, Loader2 } from "lucide-react";

interface UploadFormProps {
  userId: string;
  churchId: string;
}

interface YouTubeMetadata {
  title: string;
  thumbnail_url: string;
  duration_seconds: number;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function UploadForm({ userId, churchId }: UploadFormProps) {
  const [sourceTab, setSourceTab] = useState<"upload" | "youtube">("upload");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<globalThis.File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  // Language state
  const [sermonLanguage, setSermonLanguage] = useState("");
  const [customLanguage, setCustomLanguage] = useState("");

  // YouTube state
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeMetadata, setYoutubeMetadata] = useState<YouTubeMetadata | null>(null);
  const [validating, setValidating] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  const FASTAPI_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

  const resolvedLanguage = sermonLanguage === "other" ? customLanguage.trim() || null : sermonLanguage || null;

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (isValidVideoFile(droppedFile)) {
        setFile(droppedFile);
        if (!title) {
          setTitle(droppedFile.name.replace(/\.[^/.]+$/, ""));
        }
      } else {
        toast.error("Please upload a video file (MP4, MOV, or WebM)");
      }
    }
  }, [title]);

  const isValidVideoFile = (file: globalThis.File) => {
    const validTypes = ["video/mp4", "video/quicktime", "video/webm"];
    return validTypes.includes(file.type);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (isValidVideoFile(selectedFile)) {
        setFile(selectedFile);
        if (!title) {
          setTitle(selectedFile.name.replace(/\.[^/.]+$/, ""));
        }
      } else {
        toast.error("Please upload a video file (MP4, MOV, or WebM)");
      }
    }
  };

  const handleValidateYoutube = async () => {
    if (!youtubeUrl.trim()) return;

    setValidating(true);
    setYoutubeMetadata(null);

    try {
      const res = await fetch(`${FASTAPI_URL}/youtube/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to validate URL");
      }

      const metadata: YouTubeMetadata = await res.json();
      setYoutubeMetadata(metadata);
      if (!title) {
        setTitle(metadata.title);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid YouTube URL");
    } finally {
      setValidating(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setUploading(true);
    setProgress(0);

    try {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          title,
          church_id: churchId,
          user_id: userId,
          status: "uploading",
          ...(resolvedLanguage && { sermon_language: resolvedLanguage }),
        })
        .select()
        .single();

      if (projectError) throw projectError;

      setProgress(10);

      const fileExt = file.name.split(".").pop();
      const filePath = `${churchId}/${project.id}/video.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("videos")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setProgress(80);

      const { data: urlData } = await supabase.storage
        .from("videos")
        .createSignedUrl(filePath, 60 * 60 * 24 * 7);

      const { error: updateError } = await supabase
        .from("projects")
        .update({
          video_url: urlData?.signedUrl || filePath,
          status: "processing",
        })
        .eq("id", project.id);

      if (updateError) throw updateError;

      setProgress(100);
      toast.success("Video uploaded successfully!");
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload video. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeMetadata || !title) return;

    setUploading(true);

    try {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          title,
          church_id: churchId,
          user_id: userId,
          source_type: "youtube",
          youtube_url: youtubeUrl.trim(),
          status: "processing",
          ...(resolvedLanguage && { sermon_language: resolvedLanguage }),
        })
        .select()
        .single();

      if (projectError) throw projectError;

      // Trigger backend processing pipeline
      const processRes = await fetch(`${FASTAPI_URL}/process/project/${project.id}`, {
        method: "POST",
      });

      if (!processRes.ok) {
        const err = await processRes.json().catch(() => ({}));
        toast.error(err.detail || "Failed to start processing");
      } else {
        toast.success("Project created! Processing will begin shortly.");
      }
      router.push(`/projects/${project.id}`);
    } catch (error) {
      console.error("YouTube project error:", error);
      toast.error("Failed to create project. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Sermon Project</CardTitle>
        <CardDescription>
          Upload a video or paste a YouTube link to generate quotes and clips
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Tab Toggle */}
        <div className="flex border-b mb-6">
          <button
            type="button"
            className={`flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium transition-colors ${
              sourceTab === "upload"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setSourceTab("upload"); setTitle(""); }}
          >
            <Upload className="h-4 w-4" />
            Upload Video
          </button>
          <button
            type="button"
            className={`flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium transition-colors ${
              sourceTab === "youtube"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => { setSourceTab("youtube"); setTitle(""); }}
          >
            <Link className="h-4 w-4" />
            YouTube Link
          </button>
        </div>

        {sourceTab === "upload" ? (
          <form onSubmit={handleUpload} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Project Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sunday Sermon - June 22, 2026"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sermon-language">Sermon Language (optional)</Label>
              <select
                id="sermon-language"
                value={sermonLanguage}
                onChange={(e) => setSermonLanguage(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Auto-detect</option>
                <option value="en">English</option>
                <option value="tl">Filipino / English</option>
                <option value="ceb">Bisaya / English</option>
                <option value="other">Other</option>
              </select>
              {sermonLanguage === "other" && (
                <Input
                  placeholder="e.g. Hiligaynon, Korean, Spanish"
                  value={customLanguage}
                  onChange={(e) => setCustomLanguage(e.target.value)}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label>Video File</Label>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-4">
                    <File className="h-8 w-8 text-muted-foreground" />
                    <div className="text-left">
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setFile(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-2">
                      Drag and drop your video file here, or
                    </p>
                    <label>
                      <Input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <span className="text-primary cursor-pointer hover:underline">
                        browse to upload
                      </span>
                    </label>
                    <p className="text-xs text-muted-foreground mt-2">
                      Supports MP4, MOV, WebM up to 5GB
                    </p>
                  </>
                )}
              </div>
            </div>

            {uploading && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm text-muted-foreground text-center">
                  {progress < 80
                    ? "Uploading video..."
                    : progress < 100
                    ? "Creating project..."
                    : "Complete!"}
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!file || !title || uploading}
            >
              {uploading ? "Uploading..." : "Upload Video"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleYoutubeSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="youtube-url">YouTube URL</Label>
              <div className="flex gap-2">
                <Input
                  id="youtube-url"
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    setYoutubeMetadata(null);
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  required
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleValidateYoutube}
                  disabled={!youtubeUrl.trim() || validating}
                >
                  {validating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Fetch"
                  )}
                </Button>
              </div>
            </div>

            {youtubeMetadata && (
              <>
                <div className="rounded-lg border p-4 space-y-3">
                  {youtubeMetadata.thumbnail_url && (
                    <img
                      src={youtubeMetadata.thumbnail_url}
                      alt="Video thumbnail"
                      className="w-full rounded-md aspect-video object-cover"
                    />
                  )}
                  <p className="text-sm text-muted-foreground">
                    Duration: {formatDuration(youtubeMetadata.duration_seconds)}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="yt-title">Project Title</Label>
                  <Input
                    id="yt-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="yt-sermon-language">Sermon Language (optional)</Label>
                  <select
                    id="yt-sermon-language"
                    value={sermonLanguage}
                    onChange={(e) => setSermonLanguage(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="">Auto-detect</option>
                    <option value="en">English</option>
                    <option value="tl">Filipino / English</option>
                    <option value="ceb">Bisaya / English</option>
                    <option value="other">Other</option>
                  </select>
                  {sermonLanguage === "other" && (
                    <Input
                      placeholder="e.g. Hiligaynon, Korean, Spanish"
                      value={customLanguage}
                      onChange={(e) => setCustomLanguage(e.target.value)}
                    />
                  )}
                </div>
              </>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!youtubeMetadata || !title || uploading}
            >
              {uploading ? "Creating..." : "Create Project"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
