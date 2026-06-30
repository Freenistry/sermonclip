import { createClient } from "@/lib/supabase/server";
import { ClipLibrary } from "@/components/library/ClipLibrary";

export default async function ClipsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: userData } = await supabase
    .from("users")
    .select("church_id")
    .eq("id", user!.id)
    .single();

  const { data: clips } = await supabase
    .from("saved_clips")
    .select("*, projects(title)")
    .eq("church_id", userData?.church_id)
    .order("created_at", { ascending: false });

  const formattedClips = (clips || []).map((clip) => {
    const projectInfo = clip.projects as { title: string } | null;
    return {
      ...clip,
      project_title: projectInfo?.title || null,
      projects: undefined,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clips</h1>
        <p className="text-muted-foreground">
          Browse your saved sermon clips
        </p>
      </div>
      <ClipLibrary clips={formattedClips} churchId={userData?.church_id} />
    </div>
  );
}
