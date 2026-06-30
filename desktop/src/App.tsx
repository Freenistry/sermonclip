import { Routes, Route, Navigate } from "react-router";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<div>SermonClip Desktop - Routes coming soon</div>} />
    </Routes>
  );
}
