"use client";

import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Image, Video, Clock } from "lucide-react";
import { toast } from "sonner";

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

export function QuoteCard({ quote }: QuoteCardProps) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(quote.text);
    toast.success("Quote copied to clipboard");
  };

  return (
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
          <span>{formatTime(quote.start_time)} - {formatTime(quote.end_time)}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-1" />
            Copy
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Image className="h-4 w-4 mr-1" />
            Image
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Video className="h-4 w-4 mr-1" />
            Clip
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
