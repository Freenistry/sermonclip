import { useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
import { DependencyCheck } from "@/components/setup/DependencyCheck";
import LoginPage from "@/routes/Login";
import RegisterPage from "@/routes/Register";
import ProjectsPage from "@/routes/Projects";
import ProjectNewPage from "@/routes/ProjectNew";
import ProjectDetailPage from "@/routes/ProjectDetail";
import ClipEditorPage from "@/routes/ClipEditor";
import LibraryVideosPage from "@/routes/LibraryVideos";
import LibraryMusicPage from "@/routes/LibraryMusic";
import LibraryClipsPage from "@/routes/LibraryClips";

function DashboardLayout() {
  const { user } = useAuth();
  return (
    <DashboardShell user={{ email: user?.email ?? "" }}>
      <Outlet />
    </DashboardShell>
  );
}

export default function App() {
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

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected routes */}
      <Route element={<RequireAuth />}>
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
      </Route>
    </Routes>
  );
}
