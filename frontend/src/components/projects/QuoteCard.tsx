"use client";

import { useState } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";
import { ImagePreviewModal } from "./ImagePreviewModal";

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

const API_URL = process.env.NEXT_PUBLIC_FASTAPI_URL || "http://localhost:8000";

export function QuoteCard({ quote }: QuoteCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [filename, setFilename] = useState("quote.png");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(quote.text);
    toast.success("Quote copied to clipboard");
  };

  const generateImage = async () => {
    setIsGenerating(true);
    setShowModal(true);

    try {
      const response = await fetch(`${API_URL}/image/quote/${quote.id}`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to generate image");
      }

      const data = await response.json();
      setImageData(data.image);
      setFilename(data.filename);
    } catch (error) {
      toast.error("Failed to generate image");
      console.error("Image generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImageClick = () => {
    if (imageData) {
      setShowModal(true);
    } else {
      generateImage();
    }
  };

  const handleRegenerate = () => {
    generateImage();
  };

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <blockquote className="text-lg font-medium italic border-l-4 border-primary pl-4">
            "{quote.text}"
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
              disabled={isGenerating}
            >
              <Image className={`h-4 w-4 mr-1 ${isGenerating ? "animate-pulse" : ""}`} />
              Image
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Video className="h-4 w-4 mr-1" />
              Clip
            </Button>
          </div>
        </CardFooter>
      </Card>

      <ImagePreviewModal
        open={showModal}
        onOpenChange={setShowModal}
        imageData={imageData}
        filename={filename}
        isLoading={isGenerating}
        onRegenerate={handleRegenerate}
      />
    </>
  );
}
