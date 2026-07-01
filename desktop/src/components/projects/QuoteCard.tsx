import { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { ClipPreviewModal } from "./ClipPreviewModal";

interface QuoteCardProps {
  quote: {
    id: string;
    text: string;
    start_time: number;
    end_time: number;
    context: string;
    status: string;
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

export function QuoteCard({ quote }: QuoteCardProps) {
  // Image state
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageFilename, setImageFilename] = useState("quote.png");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Clip state
  const [showClipModal, setShowClipModal] = useState(false);
  const [clipData, setClipData] = useState<string | null>(null);
  const [clipFilename, setClipFilename] = useState("clip.mp4");
  const [clipDuration, setClipDuration] = useState(0);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(quote.text);
    toast.success("Quote copied to clipboard");
  };

  // Image generation
  const generateImage = async () => {
    setIsGeneratingImage(true);
    setShowImageModal(true);

    try {
      const response = await fetch(`${API_URL}/image/quote/${quote.id}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate image");
      }

      const data = await response.json();
      setImageData(data.image);
      setImageFilename(data.filename);
    } catch (error) {
      toast.error("Failed to generate image");
      console.error("Image generation error:", error);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleImageClick = () => {
    if (imageData) {
      setShowImageModal(true);
    } else {
      generateImage();
    }
  };

  const handleImageRegenerate = () => {
    generateImage();
  };

  // Clip generation
  const generateClip = async () => {
    setIsGeneratingClip(true);
    setShowClipModal(true);

    try {
      const response = await fetch(`${API_URL}/clip/quote/${quote.id}?smart=true`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate clip");
      }

      const data = await response.json();
      setClipData(data.video);
      setClipFilename(data.filename);
      setClipDuration(data.duration);
    } catch (error) {
      toast.error("Failed to generate clip");
      console.error("Clip generation error:", error);
    } finally {
      setIsGeneratingClip(false);
    }
  };

  const handleClipClick = () => {
    if (clipData) {
      setShowClipModal(true);
    } else {
      generateClip();
    }
  };

  const handleClipRegenerate = () => {
    generateClip();
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <blockquote className="text-lg font-medium italic border-l-4 border-primary pl-4">
            &quot;{quote.text}&quot;
          </blockquote>
          {quote.context && (
            <p className="text-sm text-muted-foreground mt-4 line-clamp-2">
              Context: {quote.context}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {formatTime(quote.start_time)} - {formatTime(quote.end_time)}
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
              <Image className={`h-4 w-4 mr-1 ${isGeneratingImage ? "animate-pulse" : ""}`} />
              Image
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClipClick}
              disabled={isGeneratingClip}
            >
              <Video className={`h-4 w-4 mr-1 ${isGeneratingClip ? "animate-pulse" : ""}`} />
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
        onRegenerate={handleImageRegenerate}
      />

      <ClipPreviewModal
        open={showClipModal}
        onOpenChange={setShowClipModal}
        videoData={clipData}
        filename={clipFilename}
        duration={clipDuration}
        isLoading={isGeneratingClip}
        onRegenerate={handleClipRegenerate}
      />
    </>
  );
}
