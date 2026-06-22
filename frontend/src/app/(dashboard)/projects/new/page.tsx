import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "@/components/projects/UploadForm";

export default async function NewProjectPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: userData } = await supabase
    .from("users")
    .select("church_id")
    .eq("id", user.id)
    .single();

  if (!userData?.church_id) {
    redirect("/projects");
  }

  return (
    <div className="max-w-2xl mx-auto">
      <UploadForm userId={user.id} churchId={userData.church_id} />
    </div>
  );
}
