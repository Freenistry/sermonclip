import { useQuery } from "@tanstack/react-query";
import { VideoLibrary } from "@/components/library/VideoLibrary";
import { API_URL, apiFetch } from "@/lib/api";

export default function LibraryVideosPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ["libraryVideos"],
    queryFn: async () => {
      const response = await apiFetch(`${API_URL}/process/projects`);
      if (!response.ok) throw new Error("Failed to fetch projects");
      return response.json();
    },
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
