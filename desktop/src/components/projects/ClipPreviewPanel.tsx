import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "./VideoPlayer";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ClipPreviewModal } from "./ClipPreviewModal";
import { Copy, Image, Video, Clock, Scissors } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router";

interface Highlight {
  id: string;
  title: string;
  transcript_excerpt: string;
  quote_text: string;
  start_time: number;
  end_time: number;
  duration_tier: string;
  time_ranges?: { start: number; end: number }[];
}

interface ClipPreviewPanelProps {
  highlight: Highlight | null;
  sourceType: "youtube" | "upload";
  youtubeUrl?: string;
  videoUrl?: string;
  projectId: string;
}

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function ClipPreviewPanel({
  highlight,
  sourceType,
  youtubeUrl,
  videoUrl,
  projectId,
}: ClipPreviewPanelProps) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState("quote.png");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const [showClipModal, setShowClipModal] = useState(false);
  const [clipData, setClipData] = useState<string | null>(null);
  const [clipFilename, setClipFilename] = useState("clip.mp4");
  const [clipDuration, setClipDuration] = useState(0);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);

  if (!highlight) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a clip to preview
      </div>
    );
  }

  const hasMultiSegment = highlight.time_ranges && highlight.time_ranges.length >= 2;
  const duration = hasMultiSegment
    ? highlight.time_ranges!.reduce((sum, r) => sum + (r.end - r.start), 0)
    : highlight.end_time - highlight.start_time;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(highlight.quote_text);
    toast.success("Quote copied to clipboard");
  };

  const generateImage = async () => {
    setIsGeneratingImage(true);
    setShowImageModal(true);
    try {
      const response = await fetch(
        `${API_URL}/image/highlight/${highlight.id}`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Failed to generate image");
      const data = await response.json();
      setImageData(data.image);
      setImageFilename(data.filename);
    } catch {
      toast.error("Failed to generate image");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const generateClip = async () => {
    setIsGeneratingClip(true);
    setShowClipModal(true);
    try {
      const response = await fetch(
        `${API_URL}/clip/highlight/${highlight.id}`,
        { method: "POST" }
      );
      if (!response.ok) throw new Error("Failed to generate clip");
      const data = await response.json();
      setClipData(data.video);
      setClipFilename(data.filename);
      setClipDuration(data.duration);
    } catch {
      toast.error("Failed to generate clip");
    } finally {
      setIsGeneratingClip(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <VideoPlayer
        sourceType={sourceType}
        youtubeUrl={youtubeUrl}
        videoUrl={videoUrl}
        startTime={highlight.start_time}
        endTime={highlight.end_time}
        timeRanges={highlight.time_ranges}
      />

      <div className="mt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-lg">{highlight.title}</h3>
          <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
            <Clock className="h-4 w-4" />
            <span>
              {hasMultiSegment
                ? highlight.time_ranges!.map((r, i) => (
                    <span key={i}>
                      {i > 0 && " + "}
                      {formatTime(r.start)}&ndash;{formatTime(r.end)}
                    </span>
                  ))
                : `${formatTime(highlight.start_time)} - ${formatTime(highlight.end_time)}`}
            </span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        <blockquote className="text-sm italic text-muted-foreground border-l-4 border-primary pl-3">
          &quot;{highlight.quote_text}&quot;
        </blockquote>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-1" />
            Copy Quote
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (imageData ? setShowImageModal(true) : generateImage())}
            disabled={isGeneratingImage}
          >
            <Image
              className={`h-4 w-4 mr-1 ${isGeneratingImage ? "animate-pulse" : ""}`}
            />
            Generate Image
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (clipData ? setShowClipModal(true) : generateClip())}
            disabled={isGeneratingClip}
          >
            <Video
              className={`h-4 w-4 mr-1 ${isGeneratingClip ? "animate-pulse" : ""}`}
            />
            Generate Clip
          </Button>
          <Link to={`/projects/${projectId}/edit/${highlight.id}`}>
            <Button variant="default" size="sm">
              <Scissors className="h-4 w-4 mr-1" />
              Edit Clip
            </Button>
          </Link>
        </div>
      </div>

      <ImagePreviewModal
        open={showImageModal}
        onOpenChange={setShowImageModal}
        imageData={imageData}
        filename={imageFilename}
        isLoading={isGeneratingImage}
        onRegenerate={generateImage}
      />

      <ClipPreviewModal
        open={showClipModal}
        onOpenChange={setShowClipModal}
        videoData={clipData}
        filename={clipFilename}
        duration={clipDuration}
        isLoading={isGeneratingClip}
        onRegenerate={generateClip}
        highlightId={highlight.id}
      />
    </div>
  );
}
