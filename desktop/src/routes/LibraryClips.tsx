import { useQuery } from "@tanstack/react-query";
import { ClipLibrary, type SavedClip } from "@/components/library/ClipLibrary";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

export default function LibraryClipsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["libraryClips"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/clip/saved`);
      if (!response.ok) throw new Error("Failed to fetch clips");
      const result = await response.json();
      return (result.clips || []) as SavedClip[];
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
        <h1 className="text-3xl font-bold">Clips</h1>
        <p className="text-muted-foreground">Browse your saved sermon clips</p>
      </div>
      <ClipLibrary clips={data || []} />
    </div>
  );
}
