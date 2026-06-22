import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Project {
  id: string;
  title: string;
  status: string;
  created_at: string;
  video_duration_seconds: number | null;
}

interface ProjectCardProps {
  project: Project;
}

const statusColors: Record<string, string> = {
  uploading: "bg-yellow-500",
  processing: "bg-blue-500",
  transcribing: "bg-blue-500",
  analyzing: "bg-purple-500",
  ready: "bg-green-500",
  error: "bg-red-500",
};

export function ProjectCard({ project }: ProjectCardProps) {
  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "Unknown duration";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader>
          <div className="flex items-start justify-between">
            <CardTitle className="line-clamp-1">{project.title}</CardTitle>
            <Badge className={statusColors[project.status] || "bg-gray-500"}>
              {project.status}
            </Badge>
          </div>
          <CardDescription>
            {formatDistanceToNow(new Date(project.created_at), {
              addSuffix: true,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Duration: {formatDuration(project.video_duration_seconds)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
