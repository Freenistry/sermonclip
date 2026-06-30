import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProjectStatus } from "@/components/projects/ProjectStatus";
import { QuoteCard } from "@/components/projects/QuoteCard";
import { ClipBrowser } from "@/components/projects/ClipBrowser";
import { TranscriptView } from "@/components/projects/TranscriptView";
import { ProcessingProgress } from "@/components/projects/ProcessingProgress";
import { ArrowLeft, RefreshCw, Play } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { ProcessButton } from "./ProcessButton";
import { ReprocessHighlightsButton } from "./ReprocessHighlightsButton";
import { MergeSuggestionsPanel } from "@/components/projects/MergeSuggestionsPanel";
import { extractVideoId } from "@/lib/youtube";
import { VideoThumbnail } from "@/components/projects/VideoThumbnail";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Get user's church_id
  const { data: userData } = await supabase
    .from("users")
    .select("church_id")
    .eq("id", user.id)
    .single();

  if (!userData?.church_id) {
    redirect("/projects");
  }

  const churchId = userData.church_id;

  // Get project
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("church_id", churchId)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Get transcript if exists
  // Note: RLS policy ensures church isolation through project relationship
  const { data: transcript } = await supabase
    .from("transcripts")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Get sermon highlights
  const { data: highlights } = await supabase
    .from("sermon_highlights")
    .select("*")
    .eq("project_id", id)
    .order("start_time", { ascending: true });

  // Get quotes (fallback for projects without highlights)
  const { data: quotes } = await supabase
    .from("quotes")
    .select("*")
    .eq("project_id", id)
    .order("start_time", { ascending: true });

  // Get highlight IDs involved in pending merge suggestions
  const { data: mergeSuggestions } = await supabase
    .from("merge_suggestions")
    .select("highlight_ids")
    .eq("project_id", id)
    .eq("status", "pending");

  const mergedHighlightIds = new Set(
    (mergeSuggestions ?? []).flatMap((s: { highlight_ids: string[] }) => s.highlight_ids)
  );

  const hasHighlights = (highlights?.length ?? 0) > 0;

  const isProcessing = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights", "cancelling"].includes(project.status);
  const canProcess = project.status === "uploading" || project.status === "failed" || project.status === "cancelled" || project.status === "completed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/projects" className="mt-1">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        <Card className="flex-1 overflow-hidden">
          <div className="flex">
            {/* Thumbnail */}
            <div className="relative w-48 min-h-[108px] shrink-0 bg-muted">
              {project.source_type === "youtube" && project.youtube_url && extractVideoId(project.youtube_url) ? (
                <>
                  <Image
                    src={`https://img.youtube.com/vi/${extractVideoId(project.youtube_url)}/mqdefault.jpg`}
                    alt={project.title}
                    fill
                    className="object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full bg-black/60 p-2">
                      <Play className="h-5 w-5 text-white fill-white" />
                    </div>
                  </div>
                </>
              ) : project.video_url ? (
                <VideoThumbnail videoUrl={project.video_url} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
                  <div className="text-2xl font-bold text-muted-foreground/20">
                    {project.title.charAt(0).toUpperCase()}
                  </div>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
              <div>
                <h1 className="text-xl font-bold truncate">{project.title}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Created {new Date(project.created_at).toLocaleDateString()}
                  {project.video_duration_seconds && (
                    <span className="ml-2">
                      · {Math.floor(project.video_duration_seconds / 60)}:{(project.video_duration_seconds % 60).toString().padStart(2, "0")}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <ProjectStatus status={project.status} />
                {canProcess && <ProcessButton projectId={id} reprocess={project.status === "completed"} />}
                {isProcessing && (
                  <Button disabled size="sm">
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Processing Progress */}
      {isProcessing && (
        <ProcessingProgress projectId={id} initialStatus={project.status} />
      )}

      {/* Error Message */}
      {project.status === "failed" && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div>
              <p className="font-medium text-red-900">Processing failed</p>
              <p className="text-sm text-red-700">
                {project.error_message || "An error occurred during processing. Please try again."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancelled Message */}
      {project.status === "cancelled" && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-6">
            <div>
              <p className="font-medium text-orange-900">Processing cancelled</p>
              <p className="text-sm text-orange-700">
                Processing was cancelled. Click "Start Processing" to try again.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clip Browser */}
      {hasHighlights && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Sermon Highlights</h2>
            {project.status === "completed" && (
              <ReprocessHighlightsButton projectId={id} />
            )}
          </div>
          {project.status === "completed" && (
            <MergeSuggestionsPanel projectId={id} />
          )}
          <ClipBrowser
            highlights={highlights!}
            sourceType={(project.source_type ?? "upload") as "youtube" | "upload"}
            youtubeUrl={project.youtube_url}
            videoUrl={project.video_url}
            projectId={id}
            mergedHighlightIds={Array.from(mergedHighlightIds)}
          />
        </div>
      )}

      {/* Fallback: Quotes Section (for older projects without highlights) */}
      {!hasHighlights && quotes && quotes.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Extracted Quotes ({quotes.length})</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {quotes.map((quote) => (
              <QuoteCard key={quote.id} quote={quote} />
            ))}
          </div>
        </div>
      )}

      {/* Transcript Section */}
      {transcript && <TranscriptView transcript={transcript} />}

      {/* Empty State */}
      {project.status === "uploading" && (
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Ready to Process</CardTitle>
            <CardDescription>
              Your video has been uploaded. Click the button above to start
              extracting quotes and generating content.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ProcessButton projectId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
