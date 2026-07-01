import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Church } from "lucide-react";
import { useTheme } from "next-themes";

interface NavbarProps {
  churchName: string;
}

export function Navbar({ churchName }: NavbarProps) {
  const { theme, setTheme } = useTheme();

  return (
    <nav className="border-b">
      <div className="px-4 h-14 flex items-center justify-between">
        <Link to="/projects" className="flex items-center">
          <img src="/logo.png" alt="SermonClip" className="h-9 w-auto dark:hidden" />
          <img src="/logo-dark.png" alt="SermonClip" className="h-9 w-auto hidden dark:block" />
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Church className="h-3.5 w-3.5" />
            {churchName}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>
      </div>
    </nav>
  );
}
