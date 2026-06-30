import { Link } from "react-router";
import { useNavigate } from "react-router";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

interface NavbarProps {
  user: {
    email: string;
  };
}

export function Navbar({ user }: NavbarProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <nav className="border-b">
      <div className="px-4 h-14 flex items-center justify-between">
        <Link to="/projects" className="flex items-center">
          <img src="/logo.png" alt="SermonClip" className="h-9 w-auto dark:hidden" />
          <img src="/logo-dark.png" alt="SermonClip" className="h-9 w-auto hidden dark:block" />
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </nav>
  );
}
