import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

export function useProjects() {
  const { churchId } = useAuth();

  return useQuery({
    queryKey: ["projects", churchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, title, status, created_at, video_duration_seconds, source_type, youtube_url, video_url, sermon_highlights(count)")
        .eq("church_id", churchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!churchId,
  });
}
