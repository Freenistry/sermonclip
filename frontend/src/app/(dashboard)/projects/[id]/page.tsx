import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProjectStatus } from "@/components/projects/ProjectStatus";
import { QuoteCard } from "@/components/projects/QuoteCard";
import { HighlightCard } from "@/components/projects/HighlightCard";
import { TranscriptView } from "@/components/projects/TranscriptView";
import { ProcessingProgress } from "@/components/projects/ProcessingProgress";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { ProcessButton } from "./ProcessButton";

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

  const shortHighlights = highlights?.filter((h) => h.duration_tier === "short") || [];
  const mediumHighlights = highlights?.filter((h) => h.duration_tier === "medium") || [];
  const longHighlights = highlights?.filter((h) => h.duration_tier === "long") || [];
  const hasHighlights = (highlights?.length ?? 0) > 0;

  const isProcessing = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights", "cancelling"].includes(project.status);
  const canProcess = project.status === "uploading" || project.status === "failed" || project.status === "cancelled";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <p className="text-muted-foreground">
              Created {new Date(project.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ProjectStatus status={project.status} />
          {canProcess && <ProcessButton projectId={id} />}
          {isProcessing && (
            <Button disabled>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Processing...
            </Button>
          )}
        </div>
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

      {/* Sermon Highlights Section */}
      {hasHighlights && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Sermon Highlights</h2>

          {shortHighlights.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Short (~30s)
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {shortHighlights.map((h) => (
                  <HighlightCard key={h.id} highlight={h} />
                ))}
              </div>
            </div>
          )}

          {mediumHighlights.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Medium (~1 min)
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {mediumHighlights.map((h) => (
                  <HighlightCard key={h.id} highlight={h} />
                ))}
              </div>
            </div>
          )}

          {longHighlights.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Long (~1:30)
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {longHighlights.map((h) => (
                  <HighlightCard key={h.id} highlight={h} />
                ))}
              </div>
            </div>
          )}
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
