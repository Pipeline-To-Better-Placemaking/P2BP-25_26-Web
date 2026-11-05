import type { ReactNode } from "react";
import type { ProjectDto } from "../lib/projectTypes";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-sm text-ink">{children || "—"}</div>
    </div>
  );
}

export function ProjectCard({
  project,
  online,
  actions,
}: {
  project: ProjectDto;
  online: boolean;
  actions: ReactNode;
}) {
  return (
    <div className="bp-card flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">{project.Title}</h2>
        <span className="flex shrink-0 items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-ink">
          <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-green-500" : "bg-red-500"}`} />
          {online ? "Online" : "Offline"}
        </span>
      </div>

      <Field label="Description">{project.Description}</Field>
      <Field label="Location">{project.Location}</Field>

      <div className="mt-auto flex justify-end gap-2 border-t border-slate-200 pt-4">{actions}</div>
    </div>
  );
}
