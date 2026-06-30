import { useState, useEffect, useCallback } from "react";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface DependencyStatus {
  ffmpeg: boolean | null;
  ollama: boolean | null;
  whisper: boolean | null;
  loading: boolean;
  allRequired: boolean;
}

export function useDependencyCheck() {
  const [status, setStatus] = useState<DependencyStatus>({
    ffmpeg: null,
    ollama: null,
    whisper: null,
    loading: true,
    allRequired: false,
  });

  const check = useCallback(async () => {
    setStatus((prev) => ({ ...prev, loading: true }));
    const response = await fetch(`${API_URL}/health/dependencies`);
    if (!response.ok) throw new Error("Health check failed");
    const data = await response.json();
    setStatus({
      ffmpeg: data.ffmpeg ?? false,
      ollama: data.ollama ?? false,
      whisper: data.whisper ?? false,
      loading: false,
      allRequired: data.ffmpeg === true,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    const tryCheck = async () => {
      try {
        await check();
      } catch {
        // Backend might still be starting — retry
        attempts++;
        if (attempts < maxAttempts && !cancelled) {
          setTimeout(tryCheck, 1500);
        } else {
          setStatus((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    tryCheck();
    return () => {
      cancelled = true;
    };
  }, [check]);

  return { ...status, recheck: check };
}
