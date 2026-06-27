"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ReprocessHighlightsButtonProps {
  projectId: string;
}

export function ReprocessHighlightsButton({ projectId }: ReprocessHighlightsButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleReprocess = async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/process/project/${projectId}/reprocess-highlights`, {
        method: "POST",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to reprocess highlights");
      }

      toast.success("Reprocessing highlights... This may take a minute.");
      router.refresh();
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
