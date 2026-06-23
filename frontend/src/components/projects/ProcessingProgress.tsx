"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
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
  const router = useRouter();

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";
      const response = await fetch(
        `${apiUrl}/process/project/${projectId}/cancel`,
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
      const apiUrl =
        process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";
      const response = await fetch(
        `${apiUrl}/process/project/${projectId}`,
        { method: "POST" }
      );

      if (response.ok) {
        toast.success("Processing restarted");
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
  const handleStatusChange = useCallback((newStatus: string) => {
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
  }, [status]);

  // Detect stuck processing (timeout varies by stage)
  useEffect(() => {
    const processingStatuses = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights"];
    if (!processingStatuses.includes(status)) return;

    // Transcribing can take 10-15 minutes for long videos, so use longer timeout
    // Other stages should complete within 2 minutes
    const timeoutMs = status === "transcribing" ? 300000 : 120000; // 5 min for transcribing, 2 min for others

    const checkStale = setInterval(() => {
      const elapsed = Date.now() - lastStatusChange;
      if (elapsed > timeoutMs && !showRetry) {
        setShowRetry(true);
      }
    }, 10000);

    return () => clearInterval(checkStale);
  }, [status, lastStatusChange, showRetry]);

  // Poll for transcription progress when transcribing
  useEffect(() => {
    if (status !== "transcribing") {
      setTranscriptionProgress({ percent: null, message: null });
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

    const pollProgress = async () => {
      try {
        const response = await fetch(
          `${apiUrl}/process/project/${projectId}/status`
        );
        if (response.ok) {
          const data = await response.json();
          if (data.progress_percent !== null) {
            setTranscriptionProgress({
              percent: data.progress_percent,
              message: data.progress_message,
            });
          }
          // Also update status if changed
          if (data.status !== status) {
            handleStatusChange(data.status);
          }
        }
      } catch (err) {
        console.error("Failed to poll progress:", err);
      }
    };

    // Poll immediately and then every 3 seconds
    pollProgress();
    const interval = setInterval(pollProgress, 3000);

    return () => clearInterval(interval);
  }, [status, projectId, handleStatusChange]);

  useEffect(() => {
    // If already in a terminal state, refresh the page
    if (status === "completed" || status === "failed" || status === "cancelled") {
      router.refresh();
      return;
    }

    const supabase = createClient();

    // Subscribe to real-time changes on this project
    const channel = supabase
      .channel(`project-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const newStatus = payload.new.status as string;
          console.log("Real-time status update:", newStatus);
          handleStatusChange(newStatus);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Subscribed to project updates");
        }
        if (status === "CHANNEL_ERROR") {
          console.error("Failed to subscribe to project updates");
          // Fall back to polling if realtime fails
          startPollingFallback();
        }
      });

    // Fallback polling function (only used if realtime fails)
    let pollInterval: NodeJS.Timeout | null = null;
    const startPollingFallback = () => {
      if (pollInterval) return; // Already polling

      const pollStatus = async () => {
        try {
          const { data, error } = await supabase
            .from("projects")
            .select("status")
            .eq("id", projectId)
            .single();

          if (!error && data) {
            handleStatusChange(data.status);
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      };

      pollInterval = setInterval(pollStatus, 3000);
    };

    // Cleanup on unmount
    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [projectId, status, router, handleStatusChange]);

  const currentStageIndex = getStageIndex(status);
  const progressPercent = getProgressPercent(status);

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="pt-6 space-y-6">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="font-medium text-blue-900">Processing...</span>
            <span className="text-blue-700">{Math.round(progressPercent)}%</span>
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
                    ? "bg-blue-100 text-blue-900"
                    : isComplete
                    ? "bg-green-100 text-green-700"
                    : "text-gray-400"
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
        <p className="text-sm text-blue-700 text-center">
          {status === "downloading" && "Fetching video from storage..."}
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
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}

        {/* Stuck processing alert */}
        {showRetry && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
            <p className="text-sm text-amber-800 mb-2">
              Processing appears to be stuck. This can happen if the server restarted.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={retrying}
              className="text-amber-700 border-amber-300 hover:bg-amber-100"
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
              className="text-red-600 border-red-200 hover:bg-red-50"
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
