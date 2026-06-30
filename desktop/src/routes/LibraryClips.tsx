import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClipLibrary } from "@/components/library/ClipLibrary";

export default function LibraryClipsPage() {
  const { churchId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["libraryClips", churchId],
    queryFn: async () => {
      const { data: clips } = await supabase
        .from("saved_clips")
        .select("*, projects(title)")
        .eq("church_id", churchId!)
        .order("created_at", { ascending: false });

      return (clips || []).map((clip: Record<string, unknown>) => {
        const projectInfo = clip.projects as { title: string } | null;
        return {
          ...clip,
          project_title: projectInfo?.title || null,
          projects: undefined,
        };
      });
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
        <h1 className="text-3xl font-bold">Clips</h1>
        <p className="text-muted-foreground">Browse your saved sermon clips</p>
      </div>
      <ClipLibrary clips={data || []} churchId={churchId} />
    </div>
  );
}
