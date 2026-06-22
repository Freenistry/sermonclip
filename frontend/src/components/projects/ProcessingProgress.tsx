"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Download,
  AudioWaveform,
  FileText,
  Brain,
  CheckCircle,
  Loader2,
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
  // Each stage is roughly 25% of progress
  return Math.min(((stageIndex + 1) / STAGES.length) * 100, 95);
}

export function ProcessingProgress({
  projectId,
  initialStatus,
}: ProcessingProgressProps) {
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (status === "completed" || status === "failed") {
      // Refresh the page to show results
      router.refresh();
      return;
    }

    const pollStatus = async () => {
      try {
        const apiUrl =
          process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";
        const response = await fetch(
          `${apiUrl}/process/project/${projectId}/status`
        );

        if (response.ok) {
          const data = await response.json();
          setStatus(data.status);

          if (data.status === "failed") {
            setError("Processing failed. Please try again.");
          }
        }
      } catch (err) {
        console.error("Failed to poll status:", err);
      }
    };

    // Poll every 3 seconds
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [projectId, status, router]);

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
        <div className="grid grid-cols-5 gap-2">
          {STAGES.map((stage, index) => {
            const Icon = stage.icon;
            const isActive = index === currentStageIndex;
            const isComplete = index < currentStageIndex;
            const isPending = index > currentStageIndex;

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
          {status === "transcribing" &&
            "Running Whisper MLX speech-to-text (this is the slowest step)..."}
          {status === "analyzing" &&
            "Using Ollama to extract inspirational quotes..."}
          {status === "processing" && "Initializing processing pipeline..."}
          {status === "completed" && "Processing complete! Loading results..."}
        </p>

        {error && (
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
