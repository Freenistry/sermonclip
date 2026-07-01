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
    apiFetch(`${API_URL}/settings`)
      .then((r) => r.json())
      .then((data) => {
        setChurchName(data.church_name || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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
