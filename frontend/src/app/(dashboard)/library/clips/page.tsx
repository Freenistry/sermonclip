"use client";

import { useEffect, useState } from "react";
import { ClipLibrary } from "@/components/library/ClipLibrary";

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

interface ClipData {
  id: string;
  project_id: string;
  highlight_id: string;
  title: string;
  filename: string;
  video_path: string;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  quote_text: string | null;
  created_at: string;
  project_title: string | null;
  signed_url: string | null;
  thumbnail_url: string | null;
}

export default function ClipsPage() {
  const [clips, setClips] = useState<ClipData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchClips() {
      try {
        const res = await fetch(`${API_URL}/clip/saved`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setClips(data.clips || []);
      } catch {
        // silently fail
      } finally {
        setIsLoading(false);
      }
    }
    fetchClips();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clips</h1>
        <p className="text-muted-foreground">
          Browse your saved sermon clips
        </p>
      </div>
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : (
        <ClipLibrary clips={clips} />
      )}
    </div>
  );
}
