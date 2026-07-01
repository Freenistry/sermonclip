# Desktop Vite Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Vite + React SPA in `desktop/` that replicates the existing Next.js frontend, ready for Tauri integration.

**Architecture:** Copy components from `frontend/src/` into `desktop/src/`, converting server components to client components with React Query hooks. Replace Next.js routing with React Router v7. Replace SSR Supabase auth with client-side auth context.

**Tech Stack:** Vite, React 19, React Router 7, TypeScript, Tailwind CSS 4, Shadcn/ui, Supabase JS, TanStack React Query

---

### Task 1: Scaffold Vite project

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/index.html`
- Create: `desktop/vite.config.ts`
- Create: `desktop/tsconfig.json`
- Create: `desktop/tsconfig.app.json`
- Create: `desktop/.env`

**Step 1: Create the desktop directory**

```bash
mkdir -p desktop
```

**Step 2: Initialize Vite project with React TypeScript template**

```bash
cd desktop && npm create vite@latest . -- --template react-ts
```

Select: ignore overwrite prompt (directory already exists, say yes).

**Step 3: Install dependencies**

```bash
cd desktop && npm install react@19 react-dom@19 react-router@7 @supabase/supabase-js @tanstack/react-query react-hook-form @hookform/resolvers zod sonner lucide-react class-variance-authority clsx tailwind-merge tw-animate-css date-fns next-themes @base-ui/react shadcn
```

```bash
cd desktop && npm install -D tailwindcss @tailwindcss/vite @types/react@19 @types/react-dom@19 typescript
```

**Step 4: Configure `vite.config.ts`**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
```

**Step 5: Configure `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "vite-env.d.ts"],
  "exclude": ["node_modules"]
}
```

**Step 6: Create `.env`**

```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_FASTAPI_URL=http://localhost:8000
```

**Step 7: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SermonClip</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 8: Verify scaffold builds**

```bash
cd desktop && npx tsc --noEmit && npx vite build
```

Expected: Build succeeds (may have warnings about missing src files, that's fine at this stage).

**Step 9: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): scaffold Vite + React project"
```

---

### Task 2: Copy and set up shared files (CSS, lib, UI components)

**Files:**
- Create: `desktop/src/globals.css` (copy from `frontend/src/app/globals.css`)
- Create: `desktop/src/lib/utils.ts` (copy from `frontend/src/lib/utils.ts`)
- Create: `desktop/src/lib/youtube.ts` (copy from `frontend/src/lib/youtube.ts`)
- Create: `desktop/src/lib/api.ts` (new)
- Create: `desktop/src/components/ui/*` (copy all from `frontend/src/components/ui/`)
- Create: `desktop/public/logo.png` (copy from `frontend/public/logo.png`)
- Create: `desktop/public/logo-dark.png` (copy from `frontend/public/logo-dark.png`)
- Create: `desktop/public/favicon.ico` (copy from `frontend/public/favicon.ico`)

**Step 1: Copy CSS**

```bash
cp frontend/src/app/globals.css desktop/src/globals.css
```

**Step 2: Copy lib files**

```bash
mkdir -p desktop/src/lib
cp frontend/src/lib/utils.ts desktop/src/lib/utils.ts
cp frontend/src/lib/youtube.ts desktop/src/lib/youtube.ts
```

**Step 3: Create `desktop/src/lib/api.ts`**

```typescript
export const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";
```

**Step 4: Copy UI components**

```bash
mkdir -p desktop/src/components/ui
cp frontend/src/components/ui/*.tsx desktop/src/components/ui/
```

**Step 5: Copy public assets**

```bash
mkdir -p desktop/public
cp frontend/public/logo.png desktop/public/ 2>/dev/null || true
cp frontend/public/logo-dark.png desktop/public/ 2>/dev/null || true
cp frontend/public/favicon.ico desktop/public/ 2>/dev/null || true
```

**Step 6: Verify no Next.js imports in copied files**

```bash
grep -r "from ['\"]next/" desktop/src/components/ui/ desktop/src/lib/ || echo "No next imports found - good"
```

Expected: No matches (UI components and lib files should be framework-agnostic).

**Step 7: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): copy shared CSS, lib, and UI components"
```

---

### Task 3: Set up Supabase client and auth context

**Files:**
- Create: `desktop/src/lib/supabase.ts`
- Create: `desktop/src/hooks/useAuth.tsx`

**Step 1: Create client-side Supabase client**

Create `desktop/src/lib/supabase.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

**Step 2: Create auth context with `useAuth` hook**

Create `desktop/src/hooks/useAuth.tsx`:

```typescript
import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContext {
  user: User | null;
  churchId: string | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContext>({
  user: null,
  churchId: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [churchId, setChurchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) fetchChurchId(user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const newUser = session?.user ?? null;
        setUser(newUser);
        if (newUser) {
          fetchChurchId(newUser.id);
        } else {
          setChurchId(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchChurchId(userId: string) {
    const { data } = await supabase
      .from("users")
      .select("church_id")
      .eq("id", userId)
      .single();
    setChurchId(data?.church_id ?? null);
    setLoading(false);
  }

  return (
    <AuthContext.Provider value={{ user, churchId, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

**Step 3: Commit**

```bash
git add desktop/src/lib/supabase.ts desktop/src/hooks/useAuth.tsx
git commit -m "feat(desktop): add Supabase client and auth context"
```

---

### Task 4: Set up providers and app entry point

**Files:**
- Create: `desktop/src/components/providers/QueryProvider.tsx`
- Create: `desktop/src/components/providers/ThemeProvider.tsx`
- Create: `desktop/src/main.tsx`
- Create: `desktop/src/App.tsx`

**Step 1: Create QueryProvider**

Create `desktop/src/components/providers/QueryProvider.tsx`:

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

**Step 2: Create ThemeProvider**

Create `desktop/src/components/providers/ThemeProvider.tsx`:

```typescript
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
```

**Step 3: Create `main.tsx` entry point**

Create `desktop/src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import QueryProvider from "@/components/providers/QueryProvider";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            <App />
            <Toaster />
          </AuthProvider>
        </QueryProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
```

**Step 4: Create placeholder `App.tsx`**

Create `desktop/src/App.tsx`:

```typescript
import { Routes, Route, Navigate } from "react-router";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route path="*" element={<div>SermonClip Desktop - Routes coming soon</div>} />
    </Routes>
  );
}
```

**Step 5: Delete Vite template files that were auto-generated**

```bash
rm -f desktop/src/App.css desktop/src/index.css desktop/src/assets/react.svg
```

**Step 6: Verify dev server starts**

```bash
cd desktop && npx vite --open
```

Expected: Browser opens at `localhost:5173` showing "SermonClip Desktop - Routes coming soon".

**Step 7: Commit**

```bash
git add desktop/
git commit -m "feat(desktop): add providers, auth context, and app entry point"
```

---

### Task 5: Convert layout components (Sidebar, Navbar, DashboardShell)

**Files:**
- Create: `desktop/src/components/layout/Sidebar.tsx`
- Create: `desktop/src/components/layout/Navbar.tsx`
- Create: `desktop/src/components/layout/DashboardShell.tsx`
- Create: `desktop/src/components/layout/RequireAuth.tsx`

**Step 1: Create `RequireAuth` wrapper**

Create `desktop/src/components/layout/RequireAuth.tsx`:

```typescript
import { Navigate, Outlet } from "react-router";
import { useAuth } from "@/hooks/useAuth";

export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
```

**Step 2: Convert `Sidebar.tsx`**

Copy `frontend/src/components/layout/Sidebar.tsx` to `desktop/src/components/layout/Sidebar.tsx` and replace:
- `import Link from "next/link"` → `import { Link } from "react-router"`
- `import { usePathname } from "next/navigation"` → `import { useLocation } from "react-router"`
- `const pathname = usePathname()` → `const { pathname } = useLocation()`
- Remove `"use client";` (not needed in Vite)

**Step 3: Convert `Navbar.tsx`**

Copy `frontend/src/components/layout/Navbar.tsx` to `desktop/src/components/layout/Navbar.tsx` and replace:
- `import Link from "next/link"` → `import { Link } from "react-router"`
- `import Image from "next/image"` → remove (use `<img>` instead)
- `import { useRouter } from "next/navigation"` → `import { useNavigate } from "react-router"`
- `const router = useRouter()` → `const navigate = useNavigate()`
- `router.push("/login")` → `navigate("/login")`
- Remove `router.refresh()` calls
- `import { createClient } from "@/lib/supabase/client"` → `import { supabase } from "@/lib/supabase"`
- `const supabase = createClient()` → remove (use imported singleton)
- Replace `<Image src="/logo.png" ... />` with `<img src="/logo.png" alt="SermonClip" className="h-9 w-auto dark:hidden" />`
- Replace `<Image src="/logo-dark.png" ... />` with `<img src="/logo-dark.png" alt="SermonClip" className="h-9 w-auto hidden dark:block" />`
- Remove `"use client";`

**Step 4: Convert `DashboardShell.tsx`**

Copy `frontend/src/components/layout/DashboardShell.tsx` to `desktop/src/components/layout/DashboardShell.tsx`.
- Remove `"use client";`
- No other changes needed (no Next.js imports).

**Step 5: Commit**

```bash
git add desktop/src/components/layout/
git commit -m "feat(desktop): convert layout components to React Router"
```

---

### Task 6: Create auth routes (Login, Register)

**Files:**
- Create: `desktop/src/routes/Login.tsx`
- Create: `desktop/src/routes/Register.tsx`

**Step 1: Convert Login page**

Copy `frontend/src/app/(auth)/login/page.tsx` to `desktop/src/routes/Login.tsx` and replace:
- `import { useRouter } from "next/navigation"` → `import { useNavigate } from "react-router"`
- `import Link from "next/link"` → `import { Link } from "react-router"`
- `import { createClient } from "@/lib/supabase/client"` → `import { supabase } from "@/lib/supabase"`
- `const router = useRouter()` → `const navigate = useNavigate()`
- `const supabase = createClient()` → remove (use imported singleton)
- `router.push("/projects")` → `navigate("/projects")`
- Remove `router.refresh()`
- Remove `"use client";`
- Rename `export default function LoginPage` → keep as `export default function LoginPage`

**Step 2: Convert Register page**

Copy `frontend/src/app/(auth)/register/page.tsx` to `desktop/src/routes/Register.tsx` and apply same replacements as Login:
- Same import swaps (`useRouter` → `useNavigate`, `Link`, `createClient` → `supabase`)
- `router.push("/login")` → `navigate("/login")`
- Remove `router.refresh()`, `"use client";`

**Step 3: Commit**

```bash
git add desktop/src/routes/
git commit -m "feat(desktop): convert login and register pages"
```

---

### Task 7: Copy project and editor components

**Files:**
- Create: `desktop/src/components/projects/*` (copy all from frontend, convert Next.js imports)
- Create: `desktop/src/components/editor/*` (copy all from frontend)
- Create: `desktop/src/components/library/*` (copy all from frontend, convert Next.js imports)

**Step 1: Copy all component directories**

```bash
mkdir -p desktop/src/components/projects desktop/src/components/editor desktop/src/components/library
cp frontend/src/components/projects/*.tsx desktop/src/components/projects/
cp frontend/src/components/editor/*.tsx desktop/src/components/editor/
cp frontend/src/components/library/*.tsx desktop/src/components/library/
```

Also copy any additional editor files (types, hooks):

```bash
cp frontend/src/components/editor/*.ts desktop/src/components/editor/ 2>/dev/null || true
```

**Step 2: Fix Next.js imports across all copied components**

For each file in `desktop/src/components/projects/`, `desktop/src/components/library/`:

Search and replace across all files:
- `"use client";` or `'use client';` → remove
- `import Link from "next/link"` → `import { Link } from "react-router"`
- `import Image from "next/image"` → remove (replace `<Image>` with `<img>`)
- `import { useRouter } from "next/navigation"` → `import { useNavigate } from "react-router"`
- `const router = useRouter()` → `const navigate = useNavigate()`
- `router.push(...)` → `navigate(...)`
- `router.refresh()` → remove (use React Query `invalidateQueries` instead)
- `import { createClient } from "@/lib/supabase/client"` → `import { supabase } from "@/lib/supabase"`
- `const supabase = createClient()` → remove (use imported singleton)
- `process.env.NEXT_PUBLIC_FASTAPI_URL` → `import.meta.env.VITE_FASTAPI_URL`
- `process.env.NEXT_PUBLIC_SUPABASE_URL` → `import.meta.env.VITE_SUPABASE_URL`

For `<Image>` → `<img>` conversions:
- `<Image src={...} alt={...} fill className={...} />` → `<img src={...} alt={...} className={... + " object-cover w-full h-full absolute inset-0"} />`
- `<Image src={...} alt={...} width={N} height={N} className={...} />` → `<img src={...} alt={...} className={...} />`
- Remove `priority` prop

**Step 3: Fix editor components**

Editor components (`desktop/src/components/editor/`) mostly don't use Next.js imports. Just:
- Remove `"use client";` directives
- Replace any `process.env.NEXT_PUBLIC_*` with `import.meta.env.VITE_*`

**Step 4: Verify no remaining Next.js imports**

```bash
grep -r "from ['\"]next/" desktop/src/components/ || echo "All clean"
grep -r "process\.env\.NEXT_PUBLIC" desktop/src/ || echo "All clean"
grep -r '"use client"' desktop/src/ || echo "All clean"
```

Expected: No matches for any of these.

**Step 5: Commit**

```bash
git add desktop/src/components/
git commit -m "feat(desktop): copy and convert project, editor, and library components"
```

---

### Task 8: Create React Query hooks for data fetching

**Files:**
- Create: `desktop/src/hooks/useProjects.ts`
- Create: `desktop/src/hooks/useProject.ts`

**Step 1: Create `useProjects` hook**

Create `desktop/src/hooks/useProjects.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

export function useProjects() {
  const { churchId } = useAuth();

  return useQuery({
    queryKey: ["projects", churchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, title, status, created_at, video_duration_seconds, source_type, youtube_url, video_url, sermon_highlights(count)")
        .eq("church_id", churchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!churchId,
  });
}
```

**Step 2: Create `useProject` hook**

Create `desktop/src/hooks/useProject.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

export function useProject(id: string) {
  const { churchId } = useAuth();

  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id)
        .eq("church_id", churchId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!churchId,
  });

  const transcriptQuery = useQuery({
    queryKey: ["transcript", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("transcripts")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
    enabled: !!churchId,
  });

  const highlightsQuery = useQuery({
    queryKey: ["highlights", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("sermon_highlights")
        .select("*")
        .eq("project_id", id)
        .order("start_time", { ascending: true });
      return data ?? [];
    },
    enabled: !!churchId,
  });

  const quotesQuery = useQuery({
    queryKey: ["quotes", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("quotes")
        .select("*")
        .eq("project_id", id)
        .order("start_time", { ascending: true });
      return data ?? [];
    },
    enabled: !!churchId,
  });

  const mergeSuggestionsQuery = useQuery({
    queryKey: ["mergeSuggestions", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("merge_suggestions")
        .select("highlight_ids")
        .eq("project_id", id)
        .eq("status", "pending");
      return data ?? [];
    },
    enabled: !!churchId,
  });

  return {
    project: projectQuery.data,
    transcript: transcriptQuery.data,
    highlights: highlightsQuery.data ?? [],
    quotes: quotesQuery.data ?? [],
    mergeSuggestions: mergeSuggestionsQuery.data ?? [],
    isLoading: projectQuery.isLoading,
    error: projectQuery.error,
  };
}
```

**Step 3: Commit**

```bash
git add desktop/src/hooks/
git commit -m "feat(desktop): add React Query hooks for data fetching"
```

---

### Task 9: Create dashboard route pages

**Files:**
- Create: `desktop/src/routes/Projects.tsx`
- Create: `desktop/src/routes/ProjectNew.tsx`
- Create: `desktop/src/routes/ProjectDetail.tsx`
- Create: `desktop/src/routes/ClipEditor.tsx`
- Create: `desktop/src/routes/LibraryVideos.tsx`
- Create: `desktop/src/routes/LibraryMusic.tsx`
- Create: `desktop/src/routes/LibraryClips.tsx`

**Step 1: Create `Projects.tsx`**

This was a server component in Next.js. Convert to client-side with React Query.

```typescript
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ProjectList } from "@/components/projects/ProjectList";
import { Plus } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Upload and manage your sermon videos
          </p>
        </div>
        <Link to="/projects/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        </Link>
      </div>
      <ProjectList projects={projects || []} />
    </div>
  );
}
```

**Step 2: Create `ProjectNew.tsx`**

```typescript
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
```

**Step 3: Create `ProjectDetail.tsx`**

This is the biggest conversion — was a large server component. Convert to client-side using `useProject` hook.

```typescript
import { useParams, Link, Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ProjectStatus } from "@/components/projects/ProjectStatus";
import { QuoteCard } from "@/components/projects/QuoteCard";
import { ClipBrowser } from "@/components/projects/ClipBrowser";
import { TranscriptView } from "@/components/projects/TranscriptView";
import { ProcessingProgress } from "@/components/projects/ProcessingProgress";
import { ArrowLeft, RefreshCw, Play } from "lucide-react";
import { ProcessButton } from "@/components/projects/ProcessButton";
import { ReprocessHighlightsButton } from "@/components/projects/ReprocessHighlightsButton";
import { MergeSuggestionsPanel } from "@/components/projects/MergeSuggestionsPanel";
import { extractVideoId } from "@/lib/youtube";
import { VideoThumbnail } from "@/components/projects/VideoThumbnail";
import { useProject } from "@/hooks/useProject";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { project, transcript, highlights, quotes, mergeSuggestions, isLoading, error } = useProject(id!);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !project) {
    return <Navigate to="/projects" replace />;
  }

  const mergedHighlightIds = new Set(
    mergeSuggestions.flatMap((s: { highlight_ids: string[] }) => s.highlight_ids)
  );

  const hasHighlights = highlights.length > 0;
  const isProcessing = ["processing", "downloading", "extracting_audio", "transcribing", "analyzing", "extracting_highlights", "cancelling"].includes(project.status);
  const canProcess = project.status === "uploading" || project.status === "failed" || project.status === "cancelled" || project.status === "completed";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/projects" className="mt-1">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        <div className="flex-1 overflow-hidden rounded-lg">
          <div className="flex">
            {/* Thumbnail */}
            <div className="relative w-48 min-h-[108px] shrink-0 bg-muted">
              {project.source_type === "youtube" && project.youtube_url && extractVideoId(project.youtube_url) ? (
                <>
                  <img
                    src={`https://img.youtube.com/vi/${extractVideoId(project.youtube_url)}/mqdefault.jpg`}
                    alt={project.title}
                    className="object-cover w-full h-full absolute inset-0"
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
                      &middot; {Math.floor(project.video_duration_seconds / 60)}:{(project.video_duration_seconds % 60).toString().padStart(2, "0")}
                    </span>
                  )}
                  {project.sermon_language && (
                    <span className="ml-2">
                      &middot; Language: {
                        { en: "English", tl: "Filipino / English", ceb: "Bisaya / English" }[project.sermon_language as string] ?? project.sermon_language
                      }
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <ProjectStatus status={project.status} />
                {canProcess && <ProcessButton projectId={id!} reprocess={project.status === "completed"} />}
                {isProcessing && (
                  <Button disabled size="sm">
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Processing Progress */}
      {isProcessing && (
        <ProcessingProgress projectId={id!} initialStatus={project.status} />
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
                Processing was cancelled. Click &quot;Start Processing&quot; to try again.
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
              <ReprocessHighlightsButton projectId={id!} />
            )}
          </div>
          {project.status === "completed" && (
            <MergeSuggestionsPanel projectId={id!} />
          )}
          <ClipBrowser
            highlights={highlights}
            sourceType={(project.source_type ?? "upload") as "youtube" | "upload"}
            youtubeUrl={project.youtube_url}
            videoUrl={project.video_url}
            projectId={id!}
            mergedHighlightIds={Array.from(mergedHighlightIds)}
          />
        </div>
      )}

      {/* Fallback: Quotes Section */}
      {!hasHighlights && quotes.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Extracted Quotes ({quotes.length})</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {quotes.map((quote: { id: string; [key: string]: unknown }) => (
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
            <ProcessButton projectId={id!} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**Step 4: Create `ClipEditor.tsx` route**

```typescript
import { useParams, Link, Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClipEditor } from "@/components/editor/ClipEditor";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { API_URL } from "@/lib/api";

export default function ClipEditorPage() {
  const { id, highlightId } = useParams<{ id: string; highlightId: string }>();
  const { churchId } = useAuth();

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id!)
        .eq("church_id", churchId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!churchId,
  });

  const { data: highlight } = useQuery({
    queryKey: ["highlight", highlightId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sermon_highlights")
        .select("*")
        .eq("id", highlightId!)
        .eq("project_id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!churchId,
  });

  if (!project || !highlight) {
    if (!churchId) return null;
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  let videoSrc: string;
  if (project.source_type === "youtube") {
    videoSrc = `${API_URL}/editor/project/${id}/video-stream`;
  } else {
    videoSrc = project.video_url || "";
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex items-center gap-4 shrink-0 mb-4">
        <Link to={`/projects/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Edit Clip</h1>
          <p className="text-sm text-muted-foreground">{highlight.title}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ClipEditor
          projectId={id!}
          highlightId={highlightId!}
          highlight={highlight}
          videoSrc={videoSrc}
        />
      </div>
    </div>
  );
}
```

**Step 5: Create library route pages**

Create `desktop/src/routes/LibraryVideos.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { VideoLibrary } from "@/components/library/VideoLibrary";

export default function LibraryVideosPage() {
  const { churchId } = useAuth();

  const { data: projects, isLoading } = useQuery({
    queryKey: ["libraryVideos", churchId],
    queryFn: async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, title, status, created_at, video_duration_seconds, source_type, youtube_url, video_url")
        .eq("church_id", churchId!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!churchId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Videos</h1>
        <p className="text-muted-foreground">Browse all your sermon videos</p>
      </div>
      <VideoLibrary projects={projects || []} />
    </div>
  );
}
```

Create `desktop/src/routes/LibraryMusic.tsx`:

```typescript
import { MusicLibrary } from "@/components/library/MusicLibrary";

export default function LibraryMusicPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Music</h1>
        <p className="text-muted-foreground">Manage your music library</p>
      </div>
      <MusicLibrary />
    </div>
  );
}
```

Create `desktop/src/routes/LibraryClips.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { ClipLibrary } from "@/components/library/ClipLibrary";

export default function LibraryClipsPage() {
  const { churchId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["libraryClips", churchId],
    queryFn: async () => {
      const { data: clips } = await supabase
        .from("saved_clips")
        .select("*, projects(title)")
        .eq("church_id", churchId!)
        .order("created_at", { ascending: false });

      return (clips || []).map((clip) => {
        const projectInfo = clip.projects as { title: string } | null;
        return {
          ...clip,
          project_title: projectInfo?.title || null,
          projects: undefined,
        };
      });
    },
    enabled: !!churchId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clips</h1>
        <p className="text-muted-foreground">Browse your saved sermon clips</p>
      </div>
      <ClipLibrary clips={data || []} churchId={churchId} />
    </div>
  );
}
```

**Step 6: Commit**

```bash
git add desktop/src/routes/
git commit -m "feat(desktop): create all route pages with client-side data fetching"
```

---

### Task 10: Wire up the router and move ProcessButton/ReprocessHighlightsButton

**Files:**
- Modify: `desktop/src/App.tsx`
- Create: `desktop/src/components/projects/ProcessButton.tsx` (move from routes location)
- Create: `desktop/src/components/projects/ReprocessHighlightsButton.tsx` (move from routes location)

**Step 1: Move ProcessButton and ReprocessHighlightsButton**

In Next.js these lived at `app/(dashboard)/projects/[id]/ProcessButton.tsx`. In the desktop app, move them to `components/projects/` since they're shared components.

Copy `frontend/src/app/(dashboard)/projects/[id]/ProcessButton.tsx` to `desktop/src/components/projects/ProcessButton.tsx` and convert:
- Remove `"use client";`
- `import { useRouter } from "next/navigation"` → `import { useNavigate } from "react-router"`
- `const router = useRouter()` → `const navigate = useNavigate()`
- `router.refresh()` → use `useQueryClient().invalidateQueries({ queryKey: ["project"] })`
- `process.env.NEXT_PUBLIC_FASTAPI_URL` → `import.meta.env.VITE_FASTAPI_URL`

Do the same for `ReprocessHighlightsButton.tsx`.

**Step 2: Update `App.tsx` with full routing**

```typescript
import { Routes, Route, Navigate, Outlet } from "react-router";
import { RequireAuth } from "@/components/layout/RequireAuth";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuth } from "@/hooks/useAuth";
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
```

**Step 3: Commit**

```bash
git add desktop/src/
git commit -m "feat(desktop): wire up React Router with all routes"
```

---

### Task 11: Verify build and fix remaining issues

**Step 1: Run TypeScript check**

```bash
cd desktop && npx tsc --noEmit
```

Fix any type errors that come up. Common issues:
- Missing type imports
- `Image` component props that don't exist on `<img>`
- `router.refresh()` calls that weren't caught

**Step 2: Run Vite build**

```bash
cd desktop && npx vite build
```

Fix any build errors.

**Step 3: Run dev server and test manually**

```bash
cd desktop && npx vite
```

Test:
- Navigate to `http://localhost:5173` — should redirect to `/projects` → `/login`
- Login page renders correctly
- After login, dashboard shell (sidebar + navbar) renders
- Projects page loads data
- Navigate to a project detail page
- Navigate to library pages
- Theme toggle works

**Step 4: Commit any fixes**

```bash
git add desktop/
git commit -m "fix(desktop): resolve build errors and type issues"
```

---

### Task 12: Final cleanup and verification

**Step 1: Verify no Next.js remnants**

```bash
grep -r "from ['\"]next/" desktop/src/ || echo "Clean"
grep -r "process\.env\.NEXT" desktop/src/ || echo "Clean"
grep -r '"use client"' desktop/src/ || echo "Clean"
```

**Step 2: Verify all routes work**

Manual testing checklist:
- [ ] `/login` — login form renders, auth works
- [ ] `/register` — registration form renders
- [ ] `/projects` — project list loads
- [ ] `/projects/new` — upload form renders
- [ ] `/projects/:id` — project detail loads with highlights, transcript
- [ ] `/projects/:id/edit/:highlightId` — clip editor loads
- [ ] `/library/videos` — video library loads
- [ ] `/library/music` — music library loads
- [ ] `/library/clips` — clip library loads
- [ ] Theme toggle (light/dark) works
- [ ] Sign out works
- [ ] Sidebar navigation works
- [ ] Unauthorized access redirects to login

**Step 3: Build for production**

```bash
cd desktop && npx vite build
```

Expected: Builds successfully to `desktop/dist/`.

**Step 4: Final commit**

```bash
git add desktop/
git commit -m "feat(desktop): complete Vite + React SPA migration (Phase 1)"
```
