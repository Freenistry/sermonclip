import { useState } from "react";
import { CheckCircle, XCircle, Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useDependencyCheck } from "@/hooks/useDependencyCheck";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

function StatusIcon({ value }: { value: boolean | null }) {
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
  const [installError, setInstallError] = useState<Record<string, string>>({});

  const handleInstall = async (dep: string) => {
    setInstalling((prev) => ({ ...prev, [dep]: true }));
    setInstallError((prev) => ({ ...prev, [dep]: "" }));

    try {
      const response = await fetch(`${API_URL}/health/install/${dep}`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to install ${dep}`);
      }

      // Re-check dependencies after install
      await recheck();
    } catch (err) {
      setInstallError((prev) => ({
        ...prev,
        [dep]: err instanceof Error ? err.message : "Installation failed",
      }));
    } finally {
      setInstalling((prev) => ({ ...prev, [dep]: false }));
    }
  };

  const deps = [
    {
      key: "ffmpeg",
      label: "FFmpeg",
      description: "Required for video processing",
      status: ffmpeg,
      installable: true,
    },
    {
      key: "ollama",
      label: "Ollama",
      description: "Required for AI quote extraction",
      status: ollama,
      installable: true,
    },
    {
      key: "whisper",
      label: "Whisper MLX",
      description: "Required for speech-to-text transcription",
      status: whisper,
      installable: true,
    },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">System Setup</CardTitle>
          <CardDescription>
            SermonClip needs a few dependencies to work properly. Let's check what's installed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deps.map((dep) => (
            <div key={dep.key} className="space-y-1">
              <div className="flex items-center justify-between rounded-lg border bg-background p-3">
                <div className="flex items-center gap-3">
                  <StatusIcon value={loading ? null : dep.status} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{dep.label}</span>
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                        Required
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{dep.description}</p>
                  </div>
                </div>
                {!loading && dep.status === false && dep.installable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleInstall(dep.key)}
                    disabled={installing[dep.key]}
                  >
                    {installing[dep.key] ? (
                      <>
                        <Loader2 className="mr-1 size-3.5 animate-spin" />
                        Installing...
                      </>
                    ) : (
                      <>
                        <Download className="mr-1 size-3.5" />
                        Install
                      </>
                    )}
                  </Button>
                )}
              </div>
              {installError[dep.key] && (
                <p className="text-xs text-destructive px-3">{installError[dep.key]}</p>
              )}
            </div>
          ))}

          {!loading && (ffmpeg === false || ollama === false) && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">
                Click <strong>Install</strong> to automatically download and set up missing dependencies. No technical knowledge required.
              </p>
            </div>
          )}

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
