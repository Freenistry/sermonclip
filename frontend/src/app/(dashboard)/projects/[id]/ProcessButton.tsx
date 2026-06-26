"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ProcessButtonProps {
  projectId: string;
  reprocess?: boolean;
}

export function ProcessButton({ projectId, reprocess }: ProcessButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleProcess = async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";
      const response = await fetch(`${apiUrl}/process/project/${projectId}`, {
        method: "POST",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to start processing");
      }

      toast.success("Processing started! This may take several minutes.");
      router.refresh();
    } catch (error) {
      console.error("Processing error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to start processing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleProcess} disabled={loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Play className="h-4 w-4 mr-2" />
      )}
      {loading ? "Starting..." : reprocess ? "Reprocess" : "Start Processing"}
    </Button>
  );
}
