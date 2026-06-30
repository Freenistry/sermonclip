import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/projects/ProjectList";
import { Plus } from "lucide-react";

export default async function ProjectsPage() {
  const supabase = await createClient();

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get user's church_id
  const { data: userData } = await supabase
    .from("users")
    .select("church_id")
    .eq("id", user!.id)
    .single();

  // Get projects for user's church
  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, created_at, video_duration_seconds, source_type, youtube_url, video_url, sermon_highlights(count)")
    .eq("church_id", userData?.church_id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Upload and manage your sermon videos
          </p>
        </div>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        </Link>
      </div>
      <ProjectList projects={projects || []} />
    </div>
  );
}
