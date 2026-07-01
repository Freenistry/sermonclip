import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClipEditor } from "@/components/editor/ClipEditor";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { API_URL } from "@/lib/api";

export default function ClipEditorPage() {
  const { id, highlightId } = useParams<{ id: string; highlightId: string }>();
  const { churchId } = useAuth();

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id!)
        .eq("church_id", churchId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!churchId,
  });

  const { data: highlight } = useQuery({
    queryKey: ["highlight", highlightId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sermon_highlights")
        .select("*")
        .eq("id", highlightId!)
        .eq("project_id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!churchId,
  });

  if (!project || !highlight) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  let videoSrc: string;
  if (project.source_type === "youtube") {
    videoSrc = `${API_URL}/editor/project/${id}/video-stream`;
  } else {
    videoSrc = project.video_url || "";
  }

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
