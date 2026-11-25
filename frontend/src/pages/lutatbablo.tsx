import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export function LutatBabloPage() {
  useEffect(() => {
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  return (
    <main className="relative z-10 flex min-h-svh items-center justify-center bg-background p-6">
      <Button type="button" size="lg" onClick={() => window.location.assign("https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1")}>
        Лутать бабло
      </Button>
    </main>
  );
}
