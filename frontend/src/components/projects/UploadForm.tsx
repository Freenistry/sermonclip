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
import { Upload, File, X } from "lucide-react";

interface UploadFormProps {
  userId: string;
  churchId: string;
}

export function UploadForm({ userId, churchId }: UploadFormProps) {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const router = useRouter();
  const supabase = createClient();

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

  const isValidVideoFile = (file: File) => {
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

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setUploading(true);
    setProgress(0);

    try {
      // Create project first
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({
          title,
          church_id: churchId,
          user_id: userId,
          status: "uploading",
        })
        .select()
        .single();

      if (projectError) throw projectError;

      setProgress(10);

      // Upload video to storage
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

      // Get signed URL (since bucket is private)
      const { data: urlData } = await supabase.storage
        .from("videos")
        .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 day expiry

      // Update project with video URL
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
        <CardTitle>Upload Sermon Video</CardTitle>
        <CardDescription>
          Upload your sermon recording to generate quotes and clips
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
