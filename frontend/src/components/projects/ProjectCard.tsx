import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Sparkles } from "lucide-react";
import { extractVideoId } from "@/lib/youtube";
import { VideoThumbnail } from "./VideoThumbnail";
import { DeleteProjectButton } from "./DeleteProjectButton";

interface Project {
  id: string;
  title: string;
  status: string;
  created_at: string;
  video_duration_seconds: number | null;
  source_type: string | null;
  youtube_url: string | null;
  video_url: string | null;
  sermon_highlights: { count: number }[];
}

interface ProjectCardProps {
  project: Project;
}

const statusColors: Record<string, string> = {
  uploading: "bg-yellow-500",
  processing: "bg-blue-500",
  transcribing: "bg-blue-500",
  analyzing: "bg-purple-500",
  completed: "bg-primary/10 text-primary border border-primary/30",
  ready: "bg-green-500",
  error: "bg-red-500",
};

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const videoId =
    project.source_type === "youtube" && project.youtube_url
      ? extractVideoId(project.youtube_url)
      : null;
  const thumbnailUrl = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : null;
  const duration = formatDuration(project.video_duration_seconds);
  const highlightCount = project.sermon_highlights?.[0]?.count ?? 0;

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer group">
        {/* Thumbnail */}
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
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
              <div className="text-center">
                <div className="text-2xl font-bold text-muted-foreground/20">
                  {project.title.charAt(0).toUpperCase()}
                </div>
              </div>
            </div>
          )}
          {thumbnailUrl && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="rounded-full bg-black/60 p-3">
                <Play className="h-6 w-6 text-white fill-white" />
              </div>
            </div>
          )}
          {duration && (
            <span className="absolute bottom-2 right-2 bg-black/75 text-white text-xs font-medium px-1.5 py-0.5 rounded">
              {duration}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold line-clamp-1 text-sm">{project.title}</h3>
            <div className="flex items-center gap-1 shrink-0">
              <DeleteProjectButton projectId={project.id} projectTitle={project.title} />
              <Badge className={`text-xs ${statusColors[project.status] || "bg-gray-500"}`}>
                {project.status}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(project.created_at), { addSuffix: true })}
            </p>
            {highlightCount > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                {highlightCount} clip{highlightCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
