import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { API_URL, apiFetch } from "@/lib/api";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  Download,
  AudioWaveform,
  FileText,
  Brain,
  CheckCircle,
  Loader2,
  XCircle,
} from "lucide-react";

interface ProcessingProgressProps {
  projectId: string;
  initialStatus: string;
}

const STAGES = [
  { key: "downloading", label: "Downloading Video", icon: Download },
  { key: "extracting_audio", label: "Extracting Audio", icon: AudioWaveform },
  { key: "transcribing", label: "Transcribing Speech", icon: FileText },
  { key: "analyzing", label: "Extracting Quotes", icon: Brain },
  { key: "extracting_highlights", label: "Finding Highlights", icon: Brain },
  { key: "completed", label: "Complete", icon: CheckCircle },
];

function getStageIndex(status: string): number {
  const index = STAGES.findIndex((s) => s.key === status);
  return index >= 0 ? index : 0;
}

function getProgressPercent(status: string): number {
  const stageIndex = getStageIndex(status);
  if (status === "completed") return 100;
  if (status === "failed") return 0;
  // Each stage is roughly 20% of progress
  return Math.min(((stageIndex + 1) / STAGES.length) * 100, 95);
}

export function ProcessingProgress({
  projectId,
  initialStatus,
}: ProcessingProgressProps) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [lastStatusChange, setLastStatusChange] = useState(Date.now());
  const [showRetry, setShowRetry] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState<{
    percent: number | null;
    message: string | null;
  }>({ percent: null, message: null });
  const handleCancel = async () => {
    setCancelling(true);
    try {
      const response = await apiFetch(
        `${API_URL}/process/project/${projectId}/cancel`,
        { method: "POST" }
      );

      if (response.ok) {
        toast.success("Cancellation requested");
        setStatus("cancelling");
      } else {
        const data = await response.json();
        toast.error(data.detail || "Failed to cancel");
      }
    } catch (err) {
      toast.error("Failed to cancel processing");
    } finally {
      setCancelling(false);
    }
  };

  const handleRetry = async () => {
    setRetrying(true);
    setShowRetry(false);
    try {
      const response = await apiFetch(
        `${API_URL}/process/project/${projectId}`,
        { method: "POST" }
      );

      if (response.ok) {
        toast.success("Resuming processing from where it left off");
        setLastStatusChange(Date.now());
        setError(null);
      } else {
        const data = await response.json();
        toast.error(data.detail || "Failed to restart");
      }
    } catch (err) {
      toast.error("Failed to restart processing");
    } finally {
      setRetrying(false);
    }
  };

  // Handle status changes
  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (newStatus !== status) {
      setLastStatusChange(Date.now());
      setShowRetry(false);
    }
    setStatus(newStatus);

    if (newStatus === "failed") {
      setError("Processing failed. Please try again.");
    }
    if (newStatus === "cancelled") {
      toast.info("Processing was cancelled");
    }

    // Send OS notification for terminal states
    if (newStatus === "completed" || newStatus === "failed") {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === "granted";
        }
        if (granted) {
          await sendNotification({
            title: "SermonClip",
            body:
              newStatus === "completed"
                ? "Your sermon has been processed! Highlights and quotes are ready."
                : "Processing failed. Please try again.",
          });
        }
      } catch {
        // Notification not available — silently ignore
      }
    }
  }, [status]);

  // Detect stuck processing — verify with backend before showing retry
  useEffect(() => {
    const processingStatuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"];
    if (!processingStatuses.includes(status)) return;

    // Generous timeouts: downloading/extracting can be slow for large videos
    const timeoutMs = status === "transcribing" ? 600000
      : status === "downloading" ? 300000
      : status === "extracting_highlights" ? 300000
      : status === "analyzing" ? 300000
      : 180000; // 3 min default for other stages

    const checkStale = setInterval(async () => {
      const elapsed = Date.now() - lastStatusChange;
      if (elapsed > timeoutMs && !showRetry) {
        // Before showing stuck, poll backend to verify actual status
        try {
          const response = await apiFetch(
            `${API_URL}/process/project/${projectId}/status`
          );
          if (response.ok) {
            const data = await response.json();
            if (data.status !== status) {
              // Backend has progressed — update UI instead of showing stuck
              handleStatusChange(data.status);
              return;
            }
          }
        } catch {
          // If polling fails, still show retry as fallback
        }
        setShowRetry(true);
      }
    }, 15000);

    return () => clearInterval(checkStale);
  }, [status, lastStatusChange, showRetry, projectId, handleStatusChange]);

  // Poll backend status for all processing stages (keeps UI in sync if realtime fails)
  useEffect(() => {
    const processingStatuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"];
    if (!processingStatuses.includes(status)) {
      setTranscriptionProgress({ percent: null, message: null });
      return;
    }

    const pollProgress = async () => {
      try {
        const response = await apiFetch(
          `${API_URL}/process/project/${projectId}/status`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.progress_percent !== null) {
            setTranscriptionProgress({
              percent: data.progress_percent,
              message: data.progress_message,
            });
          } else if (status !== "transcribing") {
            setTranscriptionProgress({ percent: null, message: null });
          }
          // Update status if backend has progressed
          if (data.status !== status) {
            handleStatusChange(data.status);
          }
        }
      } catch (err) {
        console.error("Failed to poll progress:", err);
      }
    };

    // Poll immediately; faster during downloading for smoother progress
    pollProgress();
    const pollInterval = status === "downloading" ? 2000 : 5000;
    const interval = setInterval(pollProgress, pollInterval);

    return () => clearInterval(interval);
  }, [status, projectId, handleStatusChange]);

  const currentStageIndex = getStageIndex(status);
  const progressPercent = getProgressPercent(status);

  return (
    <Card className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40">
      <CardContent className="pt-6 space-y-6">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-blue-900 dark:text-blue-100">Processing...</span>
            <span className="text-blue-700 dark:text-blue-300">{Math.round(progressPercent)}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Stage indicators */}
        <div className="grid grid-cols-6 gap-2">
          {STAGES.map((stage, index) => {
            const Icon = stage.icon;
            const isActive = index === currentStageIndex;
            const isComplete = index < currentStageIndex;

            return (
              <div
                key={stage.key}
                className={`flex flex-col items-center text-center p-2 rounded-lg transition-colors ${
                  isActive
                    ? "bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100"
                    : isComplete
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                <div className="relative">
                  {isActive ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : isComplete ? (
                    <CheckCircle className="h-6 w-6" />
                  ) : (
                    <Icon className="h-6 w-6" />
                  )}
                </div>
                <span className="text-xs mt-1 leading-tight">{stage.label}</span>
              </div>
            );
          })}
        </div>

        {/* Current action description */}
        <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
          {status === "downloading" && (
            transcriptionProgress.percent !== null
              ? transcriptionProgress.message || `Downloading video... ${transcriptionProgress.percent}%`
              : "Downloading video..."
          )}
          {status === "extracting_audio" &&
            "Converting video to audio (16kHz mono WAV)..."}
          {status === "transcribing" && (
            <>
              {transcriptionProgress.percent !== null ? (
                <>
                  Transcribing: {transcriptionProgress.percent}% complete
                  {transcriptionProgress.message && ` (${transcriptionProgress.message})`}
                </>
              ) : (
                "Running Whisper MLX speech-to-text (this is the slowest step)..."
              )}
            </>
          )}
          {status === "analyzing" &&
            "Using Ollama to extract inspirational quotes..."}
          {status === "extracting_highlights" &&
            "Finding complete thought arcs for video clips..."}
          {status === "processing" && "Initializing processing pipeline..."}
          {status === "cancelling" && "Cancelling... will stop at next checkpoint"}
          {status === "completed" && "Processing complete! Loading results..."}
        </p>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
        )}

        {/* Stuck processing alert */}
        {showRetry && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center dark:bg-amber-950/30 dark:border-amber-800">
            <p className="text-sm text-amber-800 dark:text-amber-300 mb-2">
              Processing appears to be stuck. This can happen if the server restarted. Retrying will resume from where it left off.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
              className="text-amber-700 border-amber-300 hover:bg-amber-100 dark:text-amber-300 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              {retrying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {retrying ? "Restarting..." : "Retry Processing"}
            </Button>
          </div>
        )}

        {/* Cancel button */}
        {status !== "completed" && status !== "cancelled" && !showRetry && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling || status === "cancelling"}
              className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/40"
            >
              {cancelling || status === "cancelling" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              {status === "cancelling" ? "Cancelling..." : "Cancel Processing"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
