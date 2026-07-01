import { useQuery } from "@tanstack/react-query";
import { API_URL, apiFetch } from "@/lib/api";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await apiFetch(`${API_URL}/process/projects`);
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });
}
