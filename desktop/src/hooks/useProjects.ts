import { useQuery } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/process/projects`);
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
  });
}
