import { PageHeader } from "../../components/PageHeader";
import { useEffect, useMemo, useState } from "react";
import * as permissionApi from "../../services/permissionApi";
import type { UserProjectRoleAssignments } from "../../services/permissionApi";

interface UserRow {
  id: string;
  name: string;
  email: string;
  assignedCount: number;
}

type SortField = "name" | "assignedCount";

function buildAssignedCountMap(assignments: UserProjectRoleAssignments[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const assignment of assignments) {
    const userId = assignment.UserId?.trim();
    if (!userId) continue;
    map.set(userId, assignment.Assignments?.length ?? 0);
  }
  return map;
}

/**
 * Global admin "Permissions" page - React port of the Angular admin/permissions view.
 * Read-only overview of registered users and how many projects each is assigned a role on;
 * per-project role assignment itself happens on the project-permissions page (not ported here).
 */
export function PermissionsList() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([permissionApi.getUsers(), permissionApi.getProjectRoleAssignments()])
      .then(([users, assignments]) => {
        const assignedCountByUserId = buildAssignedCountMap(assignments);
        const nextRows = users
          .map((user) => {
            const id = user.Id?.trim();
            if (!id) return null;
            const name = `${user.FirstName ?? ""} ${user.LastName ?? ""}`.trim() || user.Email || "(unknown user)";
            return { id, name, email: user.Email ?? "", assignedCount: assignedCountByUserId.get(id) ?? 0 };
          })
          .filter((row): row is UserRow => row !== null);
        setRows(nextRows);
      })
      .catch(() => setError("Failed to load users"))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((asc) => !asc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? rows.filter((row) => row.name.toLowerCase().includes(term) || row.email.toLowerCase().includes(term))
      : rows;

    return [...filtered].sort((a, b) => {
      const cmp = sortField === "name" ? a.name.localeCompare(b.name) : a.assignedCount - b.assignedCount;
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, search, sortField, sortAsc]);

  function sortIndicator(field: SortField): string {
    if (sortField !== field) return "";
    return sortAsc ? " ▲" : " ▼";
  }

  return (
    <div>
      <PageHeader
        title={`Users (${filteredRows.length})`}
        subtitle="View registered users and their assigned project counts."
      />

      <div className="mt-4 flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or email"
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="text-sm text-ink-muted hover:underline">
            Clear
          </button>
        )}
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-ink-muted">Loading…</p>
      ) : (
        <table className="mt-4 w-full overflow-hidden bp-card text-sm">
          <thead className="bg-mauve text-left text-white">
            <tr>
              <th
                className="cursor-pointer select-none px-4 py-2 font-medium"
                onClick={() => toggleSort("name")}
              >
                User{sortIndicator("name")}
              </th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th
                className="cursor-pointer select-none px-4 py-2 font-medium"
                onClick={() => toggleSort("assignedCount")}
              >
                Assigned Projects{sortIndicator("assignedCount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-ink">{row.name}</td>
                <td className="px-4 py-2 text-ink-muted">{row.email || "—"}</td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                    {row.assignedCount} project{row.assignedCount === 1 ? "" : "s"}
                  </span>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-muted">
                  No users match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
