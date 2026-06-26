import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClipEditor } from "@/components/editor/ClipEditor";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

interface EditorPageProps {
  params: Promise<{ id: string; highlightId: string }>;
}

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

export default async function EditorPage({ params }: EditorPageProps) {
  const { id, highlightId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user's church_id
  const { data: userData } = await supabase
    .from("users")
    .select("church_id")
    .eq("id", user.id)
    .single();

  if (!userData?.church_id) {
    redirect("/projects");
  }

  // Get project
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("church_id", userData.church_id)
    .single();

  if (!project) {
    notFound();
  }

  // Get highlight
  const { data: highlight } = await supabase
    .from("sermon_highlights")
    .select("*")
    .eq("id", highlightId)
    .eq("project_id", id)
    .single();

  if (!highlight) {
    notFound();
  }

  // Resolve video URL for the editor
  let videoSrc: string;
  if (project.source_type === "youtube") {
    videoSrc = `${API_URL}/editor/project/${id}/video-stream`;
  } else {
    videoSrc = project.video_url || "";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Edit Clip</h1>
          <p className="text-sm text-muted-foreground">{highlight.title}</p>
        </div>
      </div>

      <ClipEditor
        projectId={id}
        highlightId={highlightId}
        highlight={highlight}
        videoSrc={videoSrc}
      />
    </div>
  );
}
