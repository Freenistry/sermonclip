import { useState, useRef, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useDependencyCheck } from "@/hooks/useDependencyCheck";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:18080";

function StatusIcon({ value, installing }: { value: boolean | null; installing?: boolean }) {
  if (installing) return <Loader2 className="size-5 animate-spin text-indigo-400" />;
  if (value === null) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (value) return <CheckCircle className="size-5 text-green-500" />;
  return <XCircle className="size-5 text-red-500" />;
}

interface DependencyCheckProps {
  onContinue: () => void;
}

export function DependencyCheck({ onContinue }: DependencyCheckProps) {
  const { ffmpeg, ollama, whisper, loading, allRequired, recheck } = useDependencyCheck();
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const autoInstallStarted = useRef(false);

  const installDep = useCallback(async (dep: string): Promise<boolean> => {
    setInstalling((prev) => ({ ...prev, [dep]: true }));
    setErrors((prev) => ({ ...prev, [dep]: "" }));

    try {
      const resp = await fetch(`${API_URL}/health/install/${dep}`);

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to install ${dep}`);
      }

      return true;
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [dep]: err instanceof Error ? err.message : "Installation failed",
      }));
      return false;
    } finally {
      setInstalling((prev) => ({ ...prev, [dep]: false }));
    }
  }, []);

  // Auto-install missing dependencies sequentially
  useEffect(() => {
    if (loading || autoInstallStarted.current) return;

    const missing: [string, boolean | null][] = [
      ["ffmpeg", ffmpeg],
      ["ollama", ollama],
      ["whisper", whisper],
    ];

    const toInstall = missing.filter(([, status]) => status === false).map(([key]) => key);
    if (toInstall.length === 0) return;

    autoInstallStarted.current = true;

    (async () => {
      for (const dep of toInstall) {
        await installDep(dep);
      }
      await recheck();
    })();
  }, [loading, ffmpeg, ollama, whisper, installDep, recheck]);

  const handleRetry = async (dep: string) => {
    await installDep(dep);
    await recheck();
  };

  const deps = [
    { key: "ffmpeg", label: "FFmpeg", description: "Required for video processing", status: ffmpeg },
    { key: "ollama", label: "Ollama", description: "Required for AI quote extraction", status: ollama },
    { key: "whisper", label: "Whisper MLX", description: "Required for speech-to-text transcription", status: whisper },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">System Setup</CardTitle>
          <CardDescription>
            SermonClip needs a few dependencies to work properly. Missing ones will be installed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deps.map((dep) => {
            const isInstalling = installing[dep.key];
            const error = errors[dep.key];

            return (
              <div key={dep.key} className="space-y-1">
                <div className="rounded-lg border bg-background overflow-hidden">
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <StatusIcon value={loading ? null : dep.status} installing={isInstalling} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{dep.label}</span>
                          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                            Required
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {isInstalling ? "Installing..." : dep.description}
                        </p>
                      </div>
                    </div>
                    {error && !isInstalling && (
                      <Button variant="outline" size="sm" onClick={() => handleRetry(dep.key)}>
                        Retry
                      </Button>
                    )}
                  </div>

                  {/* Indeterminate progress bar */}
                  {isInstalling && (
                    <div className="px-3 pb-3">
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full w-1/3 rounded-full bg-indigo-500 animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <p className="text-xs text-destructive px-3">{error}</p>
                )}
              </div>
            );
          })}

          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" onClick={recheck} disabled={loading}>
              {loading && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              Re-check
            </Button>
            <Button onClick={onContinue} disabled={!allRequired}>
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
