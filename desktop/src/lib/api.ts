export const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:18080";

// Use Tauri's HTTP plugin for all API requests to bypass WebView CORS restrictions.
// Falls back to regular fetch in browser (dev mode without Tauri).
let tauriFetch: typeof globalThis.fetch | null = null;
let tauriFetchLoaded = false;

async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (tauriFetchLoaded) return tauriFetch ?? globalThis.fetch;
  tauriFetchLoaded = true;
  try {
    const mod = await import("@tauri-apps/plugin-http");
    tauriFetch = mod.fetch;
  } catch {
    // Not in Tauri environment, use browser fetch
  }
  return tauriFetch ?? globalThis.fetch;
}

export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const fetchFn = await getTauriFetch();
  return fetchFn(input, init);
}
