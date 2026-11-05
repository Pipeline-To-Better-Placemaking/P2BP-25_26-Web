import { PageHeader } from "../../components/PageHeader";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Modal } from "../../components/Modal";
import * as projectPermissionApi from "../../services/projectPermissionApi";
import type { ProjectMemberRoleDto, PublicUserDto } from "../../services/projectPermissionApi";

function userLabel(user: PublicUserDto): string {
  const fullName = `${user.FirstName ?? ""} ${user.LastName ?? ""}`.trim();
  if (fullName) return `${fullName} (${user.Email ?? "no email"})`;
  return user.Email ?? "Unknown User";
}

function memberName(member: ProjectMemberRoleDto): string {
  const fullName = `${member.FirstName ?? ""} ${member.LastName ?? ""}`.trim();
  return fullName || member.Email || member.UserId || "";
}

/** Project-scoped admin page - manage which users have which role within the current project. */
export function ProjectPermissions() {
  const { projectId } = useParams();

  const [users, setUsers] = useState<PublicUserDto[]>([]);
  const [roleOptions, setRoleOptions] = useState<string[]>([]);
  const [members, setMembers] = useState<ProjectMemberRoleDto[]>([]);
  const [draftRoleByUserId, setDraftRoleByUserId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState("");
  const [removing, setRemoving] = useState<ProjectMemberRoleDto | null>(null);

  function applyMembers(assignments: ProjectMemberRoleDto[]) {
    const rows = assignments
      .filter((m) => m.UserId && m.Role)
      .sort((a, b) => memberName(a).localeCompare(memberName(b)));
    setMembers(rows);
    setDraftRoleByUserId(Object.fromEntries(rows.map((m) => [m.UserId as string, m.Role as string])));
  }

  function load() {
    if (!projectId) return;
    setLoading(true);
    Promise.all([
      projectPermissionApi.getUsers(),
      projectPermissionApi.getProjectRoleOptions(),
      projectPermissionApi.getProjectMemberRoles(projectId),
    ])
      .then(([u, roles, assignments]) => {
        setUsers(u);
        setRoleOptions(roles);
        applyMembers(assignments);
      })
      .catch(() => setError("Failed to load project permissions"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  function reloadMembers() {
    if (!projectId) return;
    projectPermissionApi.getProjectMemberRoles(projectId).then(applyMembers);
  }

  const assignedUserIds = new Set(members.map((m) => m.UserId));
  const availableUsers = users
    .filter((u) => !assignedUserIds.has(u.Id))
    .sort((a, b) => userLabel(a).localeCompare(userLabel(b)));

  function openAddDialog() {
    setNewUserId("");
    setNewRole(roleOptions[0] ?? "");
    setAdding(true);
  }

  async function handleAdd() {
    if (!projectId || !newUserId || !newRole) return;
    setSaving(true);
    try {
      await projectPermissionApi.setProjectMemberRole(projectId, { UserId: newUserId, Role: newRole });
      setAdding(false);
      reloadMembers();
    } catch {
      setError("Failed to add user to this project");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRole(member: ProjectMemberRoleDto) {
    if (!projectId || !member.UserId) return;
    const role = (draftRoleByUserId[member.UserId] ?? "").trim();
    if (!role) {
      setError("Select a role before saving");
      return;
    }
    setSaving(true);
    try {
      await projectPermissionApi.setProjectMemberRole(projectId, { UserId: member.UserId, Role: role });
      setError(null);
    } catch {
      setError("Failed to update role for this user");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!projectId || !removing?.UserId) return;
    setSaving(true);
    try {
      await projectPermissionApi.setProjectMemberRole(projectId, { UserId: removing.UserId, Role: "" });
      setMembers((rows) => rows.filter((m) => m.UserId !== removing.UserId));
      setRemoving(null);
    } catch {
      setError("Failed to remove user from this project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={`Project Permissions (${members.length})`}
        subtitle="Manage roles for users assigned to this project."
        actions={
          <button
            onClick={openAddDialog}
            disabled={roleOptions.length === 0}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
          >
            Add User
          </button>
        }
      />

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-ink-muted">Loading…</p>
      ) : members.length === 0 ? (
        <div className="bp-card p-6 text-sm text-ink-muted">No users have project access yet.</div>
      ) : (
        <table className="mt-4 w-full overflow-hidden bp-card text-sm">
          <thead className="bg-mauve text-left text-white">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.UserId} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-ink">{memberName(member)}</td>
                <td className="px-4 py-2 text-ink-muted">{member.Email || "—"}</td>
                <td className="px-4 py-2">
                  <select
                    value={draftRoleByUserId[member.UserId ?? ""] ?? ""}
                    onChange={(e) =>
                      setDraftRoleByUserId((prev) => ({ ...prev, [member.UserId as string]: e.target.value }))
                    }
                    className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none"
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleSaveRole(member)}
                      disabled={saving}
                      className="text-brand-600 hover:underline disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button onClick={() => setRemoving(member)} className="text-red-600 hover:underline">
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && (
        <Modal title="Add User To Project" onClose={() => setAdding(false)} widthClassName="max-w-md">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-ink">
              User
              <select
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
              >
                <option value="">— Select a user —</option>
                {availableUsers.map((u) => (
                  <option key={u.Id} value={u.Id}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-ink">
              Role
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none"
              >
                <option value="">— Select a role —</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newUserId || !newRole || saving}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
              >
                Add
              </button>
            </div>
          </div>
        </Modal>
      )}

      {removing && (
        <ConfirmDialog
          title="Remove User Access"
          message={`Remove ${memberName(removing)} from this project?`}
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
