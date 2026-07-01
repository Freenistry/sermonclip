import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClipLibrary, type SavedClip } from "@/components/library/ClipLibrary";

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

      return (clips || []).map((clip) => {
        const { projects: projectInfo, ...rest } = clip as Record<string, unknown> & { projects?: { title: string } | null };
        return {
          ...rest,
          project_title: projectInfo?.title ?? undefined,
        } as SavedClip;
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
      <ClipLibrary clips={data || []} churchId={churchId ?? undefined} />
    </div>
  );
}
