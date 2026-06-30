import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

export function useProject(id: string) {
  const { churchId } = useAuth();

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .eq("church_id", churchId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!churchId,
  });

  const transcriptQuery = useQuery({
    queryKey: ["transcript", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("transcripts")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
    enabled: !!churchId,
  });

  const highlightsQuery = useQuery({
    queryKey: ["highlights", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("sermon_highlights")
        .select("*")
        .eq("project_id", id)
        .order("start_time", { ascending: true });
      return data ?? [];
    },
    enabled: !!churchId,
  });

  const quotesQuery = useQuery({
    queryKey: ["quotes", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("quotes")
        .select("*")
        .eq("project_id", id)
        .order("start_time", { ascending: true });
      return data ?? [];
    },
    enabled: !!churchId,
  });

  const mergeSuggestionsQuery = useQuery({
    queryKey: ["mergeSuggestions", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("merge_suggestions")
        .select("highlight_ids")
        .eq("project_id", id)
        .eq("status", "pending");
      return data ?? [];
    },
    enabled: !!churchId,
  });

  return {
    project: projectQuery.data,
    transcript: transcriptQuery.data,
    highlights: highlightsQuery.data ?? [],
    quotes: quotesQuery.data ?? [],
    mergeSuggestions: mergeSuggestionsQuery.data ?? [],
    isLoading: projectQuery.isLoading,
    error: projectQuery.error,
  };
}
