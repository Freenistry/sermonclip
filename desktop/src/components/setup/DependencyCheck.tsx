import { CheckCircle, XCircle, Loader2, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useDependencyCheck } from "@/hooks/useDependencyCheck";

const INSTALL_LINKS: Record<string, { mac: string; windows: string; linux: string }> = {
  ffmpeg: {
    mac: "https://formulae.brew.sh/formula/ffmpeg",
    windows: "https://www.gyan.dev/ffmpeg/builds/",
    linux: "https://ffmpeg.org/download.html",
  },
  ollama: {
    mac: "https://ollama.com/download/mac",
    windows: "https://ollama.com/download/windows",
    linux: "https://ollama.com/download/linux",
  },
};

function getPlatformLink(dep: string): string {
  const platform = navigator.platform.toLowerCase();
  const links = INSTALL_LINKS[dep];
  if (!links) return "";
  if (platform.includes("mac")) return links.mac;
  if (platform.includes("win")) return links.windows;
  return links.linux;
}

function getQuickInstallCommand(): string | null {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "brew install ffmpeg";
  if (platform.includes("win")) return "winget install ffmpeg";
  if (platform.includes("linux")) return "sudo apt install ffmpeg";
  return null;
}

function StatusIcon({ value }: { value: boolean | null }) {
  if (value === null) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
  if (value) return <CheckCircle className="size-5 text-green-500" />;
  return <XCircle className="size-5 text-red-500" />;
}

function openLink(url: string) {
  open(url).catch(() => {
    window.open(url, "_blank");
  });
}

interface DependencyCheckProps {
  onContinue: () => void;
}

export function DependencyCheck({ onContinue }: DependencyCheckProps) {
  const { ffmpeg, ollama, whisper, loading, allRequired, recheck } = useDependencyCheck();

  const quickCmd = getQuickInstallCommand();

  const deps = [
    {
      key: "ffmpeg",
      label: "FFmpeg",
      description: "Required for video processing",
      required: true,
      status: ffmpeg,
      installKey: "ffmpeg",
    },
    {
      key: "ollama",
      label: "Ollama",
      description: "Optional - used for AI analysis",
      required: false,
      status: ollama,
      installKey: "ollama",
    },
    {
      key: "whisper",
      label: "Whisper MLX",
      description: "Optional - used for transcription",
      required: false,
      status: whisper,
      installKey: null,
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
            <div
              key={dep.key}
              className="flex items-center justify-between rounded-lg border bg-background p-3"
            >
              <div className="flex items-center gap-3">
                <StatusIcon value={loading ? null : dep.status} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{dep.label}</span>
                    {dep.required ? (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                        Required
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        Optional
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{dep.description}</p>
                </div>
              </div>
              {!loading && dep.status === false && dep.installKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openLink(getPlatformLink(dep.installKey!))}
                >
                  Install
                  <ExternalLink className="ml-1 size-3" />
                </Button>
              )}
            </div>
          ))}

          {!loading && ffmpeg === false && quickCmd && (
            <div className="rounded-lg border bg-muted/50 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Quick install via terminal:
              </p>
              <code className="block rounded bg-background px-2 py-1 text-sm text-foreground">
                {quickCmd}
              </code>
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
