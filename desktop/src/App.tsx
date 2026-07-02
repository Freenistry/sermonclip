import { useState, useEffect } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { UpdateChecker } from "@/components/UpdateChecker";
import { apiFetch, API_URL } from "@/lib/api";
import { DependencyCheck } from "@/components/setup/DependencyCheck";
import { Onboarding } from "@/components/setup/Onboarding";
import ProjectsPage from "@/routes/Projects";
import ProjectNewPage from "@/routes/ProjectNew";
import ProjectDetailPage from "@/routes/ProjectDetail";
import ClipEditorPage from "@/routes/ClipEditor";
import LibraryVideosPage from "@/routes/LibraryVideos";
import LibraryMusicPage from "@/routes/LibraryMusic";
import LibraryClipsPage from "@/routes/LibraryClips";

function DebugSSL() {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    apiFetch(`${API_URL}/health/debug/ssl`)
      .then((r) => r.json())
      .then(setInfo)
      .catch((e) => setInfo({ error: String(e) }));
  }, []);
  if (!info) return null;
  return (
    <div className="fixed bottom-2 right-2 z-50 max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 font-mono opacity-80 hover:opacity-100">
      <div className="font-bold text-zinc-100 mb-1">SSL Debug</div>
      {Object.entries(info).map(([k, v]) => (
        <div key={k} className="truncate">
          <span className="text-zinc-500">{k}:</span> {String(v)}
        </div>
      ))}
    </div>
  );
}

function DashboardLayout() {
  const { churchName } = useAuth();
  return (
    <DashboardShell churchName={churchName ?? ""}>
      <Outlet />
      <DebugSSL />
    </DashboardShell>
  );
}

export default function App() {
  const { churchName, loading, setChurchName } = useAuth();
  const [setupComplete, setSetupComplete] = useState(() => {
    return localStorage.getItem("sermonclip_setup_complete") === "true";
  });

  if (!setupComplete) {
    return (
      <DependencyCheck
        onContinue={() => {
          localStorage.setItem("sermonclip_setup_complete", "true");
          setSetupComplete(true);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!churchName || churchName === "My Church") {
    return (
      <Onboarding
        onComplete={(name) => {
          setChurchName(name);
        }}
      />
    );
  }

  return (
    <>
    <UpdateChecker />
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route element={<DashboardLayout />}>
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<ProjectNewPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/projects/:id/edit/:highlightId" element={<ClipEditorPage />} />
        <Route path="/library" element={<Navigate to="/library/videos" replace />} />
        <Route path="/library/videos" element={<LibraryVideosPage />} />
        <Route path="/library/music" element={<LibraryMusicPage />} />
        <Route path="/library/clips" element={<LibraryClipsPage />} />
      </Route>
    </Routes>
    </>
  );
}
