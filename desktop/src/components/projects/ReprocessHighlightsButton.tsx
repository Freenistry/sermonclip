import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ReprocessHighlightsButtonProps {
  projectId: string;
}

export function ReprocessHighlightsButton({ projectId }: ReprocessHighlightsButtonProps) {
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleReprocess = async () => {
    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_FASTAPI_URL || "http://localhost:18080";
      const res = await fetch(`${apiUrl}/process/project/${projectId}/reprocess-highlights`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to reprocess highlights");
      }

      toast.success("Reprocessing highlights... This may take a minute.");
      queryClient.invalidateQueries({ queryKey: ["project"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reprocess");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleReprocess} disabled={loading}>
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
      )}
      {loading ? "Reprocessing..." : "Reprocess Highlights"}
    </Button>
  );
}
