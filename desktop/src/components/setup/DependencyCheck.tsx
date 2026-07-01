import { useState, useRef, useEffect, useCallback } from "react";
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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

interface InstallState {
  installing: boolean;
  percent: number;
  step: string;
  logs: string[];
  error: string;
}

export function DependencyCheck({ onContinue }: DependencyCheckProps) {
  const { ffmpeg, ollama, whisper, loading, allRequired, recheck } = useDependencyCheck();
  const [installState, setInstallState] = useState<Record<string, InstallState>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const logEndRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const installingRef = useRef<Set<string>>(new Set());

  const handleInstall = useCallback(async (dep: string) => {
    setInstallState((prev) => ({
      ...prev,
      [dep]: { installing: true, percent: 0, step: "Starting...", logs: [], error: "" },
    }));
    setExpandedLogs((prev) => ({ ...prev, [dep]: true }));

    try {
      const response = await fetch(`${API_URL}/health/install/${dep}`, {
        method: "POST",
      });

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));

              if (currentEvent === "progress") {
                setInstallState((prev) => ({
                  ...prev,
                  [dep]: {
                    ...prev[dep],
                    percent: data.percent,
                    step: data.step,
                  },
                }));
              } else if (currentEvent === "log") {
                setInstallState((prev) => ({
                  ...prev,
                  [dep]: {
                    ...prev[dep],
                    logs: [...prev[dep].logs, data.message],
                  },
                }));
                setTimeout(() => {
                  logEndRefs.current[dep]?.scrollIntoView({ behavior: "smooth" });
                }, 50);
              } else if (currentEvent === "done") {
                setInstallState((prev) => ({
                  ...prev,
                  [dep]: { ...prev[dep], installing: false, percent: 100, step: "Installed!" },
                }));
                await recheck();
              } else if (currentEvent === "error") {
                setInstallState((prev) => ({
                  ...prev,
                  [dep]: { ...prev[dep], installing: false, error: data.message },
                }));
              }
            } catch {
              // ignore malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      setInstallState((prev) => ({
        ...prev,
        [dep]: {
          ...prev[dep],
          installing: false,
          error: err instanceof Error ? err.message : "Installation failed",
        },
      }));
    } finally {
      installingRef.current.delete(dep);
    }
  }, [recheck]);

  // Auto-install missing dependencies once check completes
  useEffect(() => {
    if (loading) return;
    const missing: [string, boolean | null][] = [
      ["ffmpeg", ffmpeg],
      ["ollama", ollama],
      ["whisper", whisper],
    ];
    for (const [key, status] of missing) {
      if (status === false && !installingRef.current.has(key) && !installState[key]?.error) {
        installingRef.current.add(key);
        handleInstall(key);
      }
    }
  }, [loading, ffmpeg, ollama, whisper, handleInstall, installState]);

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
            SermonClip needs a few dependencies to work properly. Missing ones will be installed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deps.map((dep) => {
            const state = installState[dep.key];
            const isInstalling = state?.installing;
            const hasLogs = state && state.logs.length > 0;
            const logsExpanded = expandedLogs[dep.key];

            return (
              <div key={dep.key} className="space-y-1">
                <div className="rounded-lg border bg-background overflow-hidden">
                  <div className="flex items-center justify-between p-3">
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
                    {state?.error && !isInstalling && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setInstallState((prev) => ({
                            ...prev,
                            [dep.key]: { ...prev[dep.key], error: "" },
                          }));
                        }}
                      >
                        Retry
                      </Button>
                    )}
                  </div>

                  {/* Progress bar during installation */}
                  {isInstalling && state && (
                    <div className="px-3 pb-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{state.step}</span>
                        <span className="text-muted-foreground tabular-nums">{state.percent}%</span>
                      </div>
                      <Progress value={state.percent} />
                    </div>
                  )}

                  {/* Log toggle and display */}
                  {hasLogs && (
                    <>
                      <button
                        className="flex w-full items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t bg-muted/30 transition-colors"
                        onClick={() => setExpandedLogs((prev) => ({ ...prev, [dep.key]: !prev[dep.key] }))}
                      >
                        {logsExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                        Logs ({state.logs.length})
                      </button>
                      {logsExpanded && (
                        <div className="max-h-32 overflow-y-auto bg-black/50 px-3 py-2 font-mono text-[10px] leading-relaxed text-green-400">
                          {state.logs.map((log, i) => (
                            <div key={i}>{log}</div>
                          ))}
                          <div ref={(el) => { logEndRefs.current[dep.key] = el; }} />
                        </div>
                      )}
                    </>
                  )}
                </div>

                {state?.error && (
                  <p className="text-xs text-destructive px-3">{state.error}</p>
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
