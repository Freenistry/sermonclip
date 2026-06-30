"use client";

import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { Film } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { extractVideoId } from "@/lib/youtube";
import { VideoThumbnail } from "@/components/projects/VideoThumbnail";

interface Project {
  id: string;
  title: string;
  status: string;
  created_at: string;
  video_duration_seconds: number | null;
  source_type: string | null;
  youtube_url: string | null;
  video_url: string | null;
}

interface VideoLibraryProps {
  projects: Project[];
}

const statusColors: Record<string, string> = {
  uploading: "bg-yellow-500",
  processing: "bg-blue-500",
  transcribing: "bg-blue-500",
  analyzing: "bg-purple-500",
  ready: "bg-green-500",
  error: "bg-red-500",
};

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VideoLibrary({ projects }: VideoLibraryProps) {
  const videoProjects = projects.filter(
    (p) => p.video_url || p.youtube_url
  );

  if (videoProjects.length === 0) {
    return (
      <div className="text-center py-16">
        <Film className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-muted-foreground">No videos yet.</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Upload a sermon video in Projects to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {videoProjects.map((project) => {
        const videoId =
          project.source_type === "youtube" && project.youtube_url
            ? extractVideoId(project.youtube_url)
            : null;
        const thumbnailUrl = videoId
          ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
          : null;
        const duration = formatDuration(project.video_duration_seconds);

        return (
          <Link key={project.id} href={`/projects/${project.id}`}>
            <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer group">
              <div className="relative aspect-video bg-muted">
                {thumbnailUrl ? (
                  <Image
                    src={thumbnailUrl}
                    alt={project.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : project.video_url ? (
                  <VideoThumbnail videoUrl={project.video_url} />
                ) : null}
                {duration && (
                  <span className="absolute bottom-2 right-2 bg-black/75 text-white text-xs font-medium px-1.5 py-0.5 rounded">
                    {duration}
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold line-clamp-1 text-sm">
                    {project.title}
                  </h3>
                  <Badge
                    className={`text-xs shrink-0 ${statusColors[project.status] || "bg-gray-500"}`}
                  >
                    {project.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(project.created_at), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
