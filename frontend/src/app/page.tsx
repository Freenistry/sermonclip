import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center space-y-6">
        <h1 className="text-4xl font-bold">SermonClip</h1>
        <p className="text-xl text-muted-foreground">
          Transform your sermons into shareable social media content
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/login">
            <Button>Sign In</Button>
          </Link>
          <Link href="/register">
            <Button variant="outline">Get Started</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
