import { useQuery } from "@tanstack/react-query";
import { API_URL, apiFetch } from "@/lib/api";

export function useProject(id: string) {
  const detailQuery = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const response = await apiFetch(`${API_URL}/process/project/${id}/detail`);
      if (!response.ok) throw new Error("Failed to fetch project");
      return response.json();
    },
  });

  const data = detailQuery.data;

  return {
    project: data?.project ?? null,
    transcript: data?.transcript ?? null,
    highlights: data?.highlights ?? [],
    quotes: data?.quotes ?? [],
    mergeSuggestions: data?.merge_suggestions ?? [],
    isLoading: detailQuery.isLoading,
    error: detailQuery.error,
  };
}
