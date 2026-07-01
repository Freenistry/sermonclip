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
