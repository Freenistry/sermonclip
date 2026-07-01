"use client";

import { useEffect, useState } from "react";
import { VideoLibrary } from "@/components/library/VideoLibrary";

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

export default function VideosPage() {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch(`${API_URL}/process/projects`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setProjects(data);
      } catch {
        // silently fail
      } finally {
        setIsLoading(false);
      }
    }
    fetchProjects();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Videos</h1>
        <p className="text-muted-foreground">
          Browse all your sermon videos
        </p>
      </div>
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : (
        <VideoLibrary projects={projects} />
      )}
    </div>
  );
}
