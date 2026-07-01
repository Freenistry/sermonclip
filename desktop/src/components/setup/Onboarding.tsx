import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const API_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

interface OnboardingProps {
  onComplete: (churchName: string) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [churchName, setChurchName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!churchName.trim()) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ church_name: churchName.trim() }),
      });
      onComplete(churchName.trim());
    } catch {
      onComplete(churchName.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to SermonClip</CardTitle>
          <p className="text-muted-foreground">Let's get you set up</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="churchName">Church Name</Label>
              <Input
                id="churchName"
                value={churchName}
                onChange={(e) => setChurchName(e.target.value)}
                placeholder="e.g., Grace Community Church"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={!churchName.trim() || saving}>
              {saving ? "Setting up..." : "Get Started"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
