import { UploadForm } from "@/components/projects/UploadForm";
import { useAuth } from "@/hooks/useAuth";

export default function ProjectNewPage() {
  const { user, churchId } = useAuth();

  if (!user || !churchId) return null;

  return (
    <div className="max-w-2xl mx-auto">
      <UploadForm userId={user.id} churchId={churchId} />
    </div>
  );
}
