import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { VideoLibrary } from "@/components/library/VideoLibrary";

export default function LibraryVideosPage() {
  const { churchId } = useAuth();

  const { data: projects, isLoading } = useQuery({
    queryKey: ["libraryVideos", churchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, title, status, created_at, video_duration_seconds, source_type, youtube_url, video_url")
        .eq("church_id", churchId!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!churchId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Videos</h1>
        <p className="text-muted-foreground">Browse all your sermon videos</p>
      </div>
      <VideoLibrary projects={projects || []} />
    </div>
  );
}
