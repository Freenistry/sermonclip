import { createClient } from "@/lib/supabase/server";
import { VideoLibrary } from "@/components/library/VideoLibrary";

export default async function VideosPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userData } = await supabase
    .from("users")
    .select("church_id")
    .eq("id", user!.id)
    .single();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, title, status, created_at, video_duration_seconds, source_type, youtube_url, video_url")
    .eq("church_id", userData?.church_id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Videos</h1>
        <p className="text-muted-foreground">
          Browse all your sermon videos
        </p>
      </div>
      <VideoLibrary projects={projects || []} />
    </div>
  );
}
