"use client";

import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Clock, Download, AudioWaveform, Brain, FileText } from "lucide-react";

interface ProjectStatusProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  uploading: { label: "Uploading", variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  processing: { label: "Processing", variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  downloading: { label: "Downloading Video", variant: "secondary", icon: <Download className="h-3 w-3 animate-pulse" /> },
  extracting_audio: { label: "Extracting Audio", variant: "secondary", icon: <AudioWaveform className="h-3 w-3 animate-pulse" /> },
  transcribing: { label: "Transcribing", variant: "secondary", icon: <FileText className="h-3 w-3 animate-pulse" /> },
  analyzing: { label: "Analyzing Quotes", variant: "secondary", icon: <Brain className="h-3 w-3 animate-pulse" /> },
  completed: { label: "Completed", variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
  failed: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  pending: { label: "Pending", variant: "outline", icon: <Clock className="h-3 w-3" /> },
};

export function ProjectStatus({ status }: ProjectStatusProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}
