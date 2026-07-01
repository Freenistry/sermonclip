import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipEditor } from "@/components/editor/ClipEditor";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { API_URL } from "@/lib/api";

export default function ClipEditorPage() {
  const { id, highlightId } = useParams<{ id: string; highlightId: string }>();

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/process/project/${id}/detail`);
      if (!response.ok) throw new Error("Failed to fetch project");
      const data = await response.json();
      return data.project;
    },
  });

  const { data: highlight } = useQuery({
    queryKey: ["highlight", highlightId],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/process/project/${id}/detail`);
      if (!response.ok) throw new Error("Failed to fetch project details");
      const data = await response.json();
      return (data.highlights || []).find((h: { id: string }) => h.id === highlightId) || null;
    },
  });

  if (!project || !highlight) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const videoSrc = `${API_URL}/editor/project/${id}/video-stream`;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex items-center gap-4 shrink-0 mb-4">
        <Link to={`/projects/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Edit Clip</h1>
          <p className="text-sm text-muted-foreground">{highlight.title}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ClipEditor
          projectId={id!}
          highlightId={highlightId!}
          highlight={highlight}
          videoSrc={videoSrc}
        />
      </div>
    </div>
  );
}
