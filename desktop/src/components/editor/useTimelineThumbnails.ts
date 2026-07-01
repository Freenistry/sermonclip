import { useState, useEffect } from "react";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface UseTimelineThumbnailsOptions {
  projectId: string;
  start: number;
  end: number;
  count?: number;
  height?: number;
}

interface TimelineThumbnails {
  spriteUrl: string | null;
  frameCount: number;
  isLoading: boolean;
}

export function useTimelineThumbnails({
  projectId,
  start,
  end,
  count = 20,
  height = 80,
}: UseTimelineThumbnailsOptions): TimelineThumbnails {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    setIsLoading(true);

    const fetchSprite = async () => {
      try {
        const params = new URLSearchParams({
          start: start.toString(),
          end: end.toString(),
          count: count.toString(),
          height: height.toString(),
        });
        const res = await fetch(
          `${API_URL}/editor/project/${projectId}/thumbnails?${params}`
        );
        if (!res.ok) throw new Error("Failed to fetch thumbnails");

        const blob = await res.blob();
        if (revoked) return;
        const url = URL.createObjectURL(blob);
        setSpriteUrl(url);
      } catch {
        console.error("Failed to fetch timeline thumbnails");
      } finally {
        if (!revoked) setIsLoading(false);
      }
    };

    fetchSprite();

    return () => {
      revoked = true;
      setSpriteUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [projectId, start, end, count, height]);

  return { spriteUrl, frameCount: count, isLoading };
}
