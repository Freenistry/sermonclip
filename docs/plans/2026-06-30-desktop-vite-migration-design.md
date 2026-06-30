# Design: Frontend Migration (Next.js to Vite + React SPA)

Phase 1 of converting SermonClip into a Tauri desktop app.

## Decisions

- **Keep Supabase** for auth and data storage (client-side only, no SSR)
- **Separate `desktop/` directory** — keep existing `frontend/` intact
- **Copy-and-convert** approach — copy components, convert Next.js patterns to React Router + React Query

## Project Structure

```
desktop/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Router setup
│   ├── globals.css
│   ├── lib/
│   │   ├── supabase.ts       # Client-side Supabase (replaces server.ts + client.ts)
│   │   ├── utils.ts
│   │   ├── youtube.ts
│   │   └── api.ts            # API base URL config for FastAPI
│   ├── hooks/
│   │   ├── useAuth.tsx       # AuthProvider context + useUser hook
│   │   └── useProject.ts     # React Query hook for project data
│   ├── components/
│   │   ├── ui/               # Shadcn components (copied as-is)
│   │   ├── layout/           # DashboardShell, Sidebar, Navbar (convert next imports)
│   │   ├── projects/         # Project components (convert next imports)
│   │   ├── editor/           # Editor components (mostly unchanged)
│   │   ├── library/          # Library components (convert next imports)
│   │   └── providers/        # QueryProvider, ThemeProvider
│   └── routes/
│       ├── Login.tsx
│       ├── Register.tsx
│       ├── Projects.tsx
│       ├── ProjectDetail.tsx  # Biggest change — SSR data fetch → React Query
│       ├── ProjectNew.tsx
│       ├── ClipEditor.tsx
│       ├── Library.tsx
│       ├── LibraryVideos.tsx
│       ├── LibraryMusic.tsx
│       └── LibraryClips.tsx
```

## Key Conversions

### Auth (SSR → Client-side)

**Before** (Next.js): Server-side Supabase client via cookies, middleware refreshes session, server components check `getUser()` and `redirect()`.

**After** (Vite SPA): Client-side `AuthProvider` using `supabase.auth.onAuthStateChange()`. Protected routes via `<RequireAuth>` wrapper. OAuth callback handled by Supabase client's `detectSessionInUrl`.

Files removed: `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`, `app/auth/callback/route.ts`

### Data Fetching (Server Components → React Query)

**Before**: `ProjectPage` is an async server component that queries Supabase directly (project, transcript, highlights, quotes, merge suggestions).

**After**: `ProjectDetail` route component uses React Query hooks:
- `useProject(id)` — fetches project
- `useTranscript(projectId)` — fetches transcript
- `useHighlights(projectId)` — fetches highlights
- `useQuotes(projectId)` — fetches quotes
- `useMergeSuggestions(projectId)` — fetches merge suggestions

### Routing

| Next.js route | React Router path |
|---|---|
| `/` | `/` → redirect to `/projects` |
| `/(auth)/login` | `/login` |
| `/(auth)/register` | `/register` |
| `/(dashboard)/projects` | `/projects` |
| `/(dashboard)/projects/new` | `/projects/new` |
| `/(dashboard)/projects/[id]` | `/projects/:id` |
| `/(dashboard)/projects/[id]/edit/[highlightId]` | `/projects/:id/edit/:highlightId` |
| `/(dashboard)/library` | `/library` → redirect to `/library/videos` |
| `/(dashboard)/library/videos` | `/library/videos` |
| `/(dashboard)/library/music` | `/library/music` |
| `/(dashboard)/library/clips` | `/library/clips` |

### Import Replacements

| Next.js | Vite/React Router |
|---|---|
| `next/link` → `Link` | `react-router` → `Link` |
| `next/navigation` → `useRouter` | `react-router` → `useNavigate` |
| `next/navigation` → `useParams` | `react-router` → `useParams` |
| `next/navigation` → `usePathname` | `react-router` → `useLocation` |
| `next/navigation` → `redirect` | `useNavigate` or `<Navigate>` |
| `next/navigation` → `notFound` | `throw new Response("", { status: 404 })` or navigate to 404 |
| `next/image` → `Image` | Standard `<img>` tag |
| `next/font/google` | Google Fonts via CSS `@import` |
| `process.env.NEXT_PUBLIC_*` | `import.meta.env.VITE_*` |

## Dependencies

**Keep**: react, react-dom, @supabase/supabase-js, @tanstack/react-query, react-hook-form, @hookform/resolvers, zod, sonner, lucide-react, class-variance-authority, clsx, tailwind-merge, tw-animate-css, date-fns, next-themes, shadcn

**Add**: react-router (v7), vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite

**Drop**: next, eslint-config-next, @supabase/ssr, @tailwindcss/postcss

## Verification

- `vite build` produces a working static build
- App runs in browser at `localhost:5173`
- Auth flow works (login, register, logout, session persistence)
- All routes navigate correctly
- Project detail page loads data via React Query
- Clip editor works with video playback
- Library pages display content
