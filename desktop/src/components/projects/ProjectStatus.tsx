import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Clock, Download, AudioWaveform, Brain, FileText, Ban } from "lucide-react";

interface ProjectStatusProps {
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; style?: React.CSSProperties }> = {
  uploading: { label: "Uploading", variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  processing: { label: "Processing", variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  downloading: { label: "Downloading Video", variant: "secondary", icon: <Download className="h-3 w-3 animate-pulse" /> },
  extracting_audio: { label: "Extracting Audio", variant: "secondary", icon: <AudioWaveform className="h-3 w-3 animate-pulse" /> },
  transcribing: { label: "Transcribing", variant: "secondary", icon: <FileText className="h-3 w-3 animate-pulse" /> },
  analyzing: { label: "Analyzing Quotes", variant: "secondary", icon: <Brain className="h-3 w-3 animate-pulse" /> },
  completed: { label: "Completed", variant: "outline", icon: <CheckCircle className="h-3 w-3" />, style: { borderColor: "var(--primary)", backgroundColor: "color-mix(in oklch, var(--primary) 10%, transparent)", color: "var(--primary)" } },
  failed: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  cancelling: { label: "Cancelling", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  cancelled: { label: "Cancelled", variant: "outline", icon: <Ban className="h-3 w-3" /> },
  pending: { label: "Pending", variant: "outline", icon: <Clock className="h-3 w-3" /> },
};

export function ProjectStatus({ status }: ProjectStatusProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;

  return (
    <Badge variant={config.variant} className="gap-1" style={config.style}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
