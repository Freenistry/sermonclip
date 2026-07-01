import { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ClipPreviewModal } from "./ClipPreviewModal";

interface HighlightCardProps {
  highlight: {
    id: string;
    title: string;
    transcript_excerpt: string;
    quote_text: string;
    start_time: number;
    end_time: number;
    duration_tier: string;
  };
}

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

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

export function HighlightCard({ highlight }: HighlightCardProps) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState("quote.png");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const [showClipModal, setShowClipModal] = useState(false);
  const [clipData, setClipData] = useState<string | null>(null);
  const [clipFilename, setClipFilename] = useState("clip.mp4");
  const [clipDuration, setClipDuration] = useState(0);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);

  const duration = highlight.end_time - highlight.start_time;

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

  const handleImageClick = () => {
    if (imageData) setShowImageModal(true);
    else generateImage();
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

  const handleClipClick = () => {
    if (clipData) setShowClipModal(true);
    else generateClip();
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h3 className="font-semibold text-base">{highlight.title}</h3>
            <Badge variant="secondary" className="shrink-0">
              {formatDuration(duration)}
            </Badge>
          </div>
          <blockquote className="text-sm italic text-muted-foreground border-l-4 border-primary pl-3">
            &quot;{highlight.quote_text}&quot;
          </blockquote>
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {formatTime(highlight.start_time)} -{" "}
              {formatTime(highlight.end_time)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImageClick}
              disabled={isGeneratingImage}
            >
              <Image
                className={`h-4 w-4 mr-1 ${isGeneratingImage ? "animate-pulse" : ""}`}
              />
              Image
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClipClick}
              disabled={isGeneratingClip}
            >
              <Video
                className={`h-4 w-4 mr-1 ${isGeneratingClip ? "animate-pulse" : ""}`}
              />
              Clip
            </Button>
          </div>
        </CardFooter>
      </Card>

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
    </>
  );
}
