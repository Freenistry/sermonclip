import { MusicLibrary } from "@/components/library/MusicLibrary";

export default function MusicPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Music</h1>
        <p className="text-muted-foreground">
          Manage your music library
        </p>
      </div>
      <MusicLibrary />
    </div>
  );
}
