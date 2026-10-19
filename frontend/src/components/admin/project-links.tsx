import { Bug, Github } from "lucide-react";
import { PROJECT_GITHUB_URL, PROJECT_REPORTS_URL } from "@/lib/project-links";

export function ProjectLinks() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-2.5 pt-2 text-[11px] text-muted-foreground">
      <a href={PROJECT_GITHUB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <Github className="h-3.5 w-3.5" aria-hidden="true" /> GitHub
      </a>
      <a href={PROJECT_REPORTS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1.5 rounded transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <Bug className="h-3.5 w-3.5" aria-hidden="true" /> Сообщить об ошибке
      </a>
    </div>
  );
}
