import { createContext, useContext, useEffect, useState } from "react";
import { API_URL, apiFetch } from "@/lib/api";

interface AuthContext {
  churchName: string | null;
  loading: boolean;
  setChurchName: (name: string) => void;
}

const AuthContext = createContext<AuthContext>({
  churchName: null,
  loading: true,
  setChurchName: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [churchName, setChurchName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const fetchSettings = async () => {
      try {
        const r = await apiFetch(`${API_URL}/settings`);
        const data = await r.json();
        if (!cancelled) {
          setChurchName(data.church_name || null);
          setLoading(false);
        }
      } catch {
        attempts++;
        if (attempts < 20 && !cancelled) {
          setTimeout(fetchSettings, 2000);
        } else if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchSettings();
    return () => { cancelled = true; };
  }, []);

  return (
    <AuthContext.Provider value={{ churchName, loading, setChurchName }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
