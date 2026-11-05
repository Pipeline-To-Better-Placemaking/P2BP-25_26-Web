import { PageHeader } from "../components/PageHeader";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import * as authStore from "../auth/authStore";
import * as userSettingsApi from "../services/userSettingsApi";
import type {
  ProjectNotificationPrefsInput,
  UserProjectRoleAssignmentsDto,
} from "../services/userSettingsApi";

interface AssignedProjectRow {
  projectId: string;
  name: string;
  role: string;
  notifyOnOwnScan: boolean;
  notifyOnOthersScan: boolean;
  notifyOnScheduledScan: boolean;
  notifyOnSystemToggle: boolean;
  notifyOnHealthAlert: boolean;
  emailPdfOnSystemOff: boolean;
}

type NotificationField = Exclude<keyof AssignedProjectRow, "projectId" | "name" | "role">;

function toAssignedRows(
  all: UserProjectRoleAssignmentsDto[],
  userId: string | null | undefined,
): AssignedProjectRow[] {
  const mine = all.find((a) => a.UserId === userId);
  if (!mine?.Assignments) return [];
  return mine.Assignments
    .filter((a) => (a.Roles?.length ?? 0) > 0)
    .map((a) => ({
      projectId: a.ProjectId || "",
      name: a.ProjectName || a.ProjectId || "(unknown)",
      role: a.Roles[0],
      notifyOnOwnScan: a.NotifyOnOwnScan ?? false,
      notifyOnOthersScan: a.NotifyOnOthersScan ?? false,
      notifyOnScheduledScan: a.NotifyOnScheduledScan ?? false,
      notifyOnSystemToggle: a.NotifyOnSystemToggle ?? false,
      notifyOnHealthAlert: a.NotifyOnHealthAlert ?? false,
      emailPdfOnSystemOff: a.EmailPdfOnSystemOff ?? false,
    }));
}

function toPrefsInput(row: AssignedProjectRow): ProjectNotificationPrefsInput {
  return {
    NotifyOnOwnScan: row.notifyOnOwnScan,
    NotifyOnOthersScan: row.notifyOnOthersScan,
    NotifyOnScheduledScan: row.notifyOnScheduledScan,
    NotifyOnSystemToggle: row.notifyOnSystemToggle,
    NotifyOnHealthAlert: row.notifyOnHealthAlert,
    EmailPdfOnSystemOff: row.emailPdfOnSystemOff,
  };
}

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none";

const NOTIFICATION_COLUMNS: { field: NotificationField; label: string }[] = [
  { field: "notifyOnOwnScan", label: "Own Scan" },
  { field: "notifyOnOthersScan", label: "Others' Scans" },
  { field: "notifyOnScheduledScan", label: "Scheduled" },
  { field: "notifyOnSystemToggle", label: "On/Off" },
  { field: "notifyOnHealthAlert", label: "Health" },
  { field: "emailPdfOnSystemOff", label: "Email PDF" },
];

export function UserSettings() {
  const { user } = useAuth();

  // Profile (name) settings
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Per-project notification preferences
  const [assignedProjects, setAssignedProjects] = useState<AssignedProjectRow[]>([]);
  const [notifError, setNotifError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    userSettingsApi
      .getMySettings()
      .then((settings) => {
        if (cancelled) return;
        setFirstName(settings.FirstName ?? "");
        setLastName(settings.LastName ?? "");
      })
      .catch(() => {
        // leave fields blank - user can still retype and save
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user?.Id) return;
    let cancelled = false;
    userSettingsApi
      .getAllProjectRoleAssignments()
      .then((all) => {
        if (!cancelled) setAssignedProjects(toAssignedRows(all, user.Id));
      })
      .catch(() => {
        if (!cancelled) setNotifError("Failed to load assigned projects.");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.Id]);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsError(null);
    setSettingsSuccess(false);

    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (!trimmedFirst) {
      setSettingsError("First name is required.");
      return;
    }

    setSavingSettings(true);
    try {
      await userSettingsApi.updateMySettings({ FirstName: trimmedFirst, LastName: trimmedLast });
      authStore.setProfileNames(trimmedFirst, trimmedLast);
      setSettingsSuccess(true);
    } catch {
      setSettingsError("Failed to save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  function clearPasswordFields() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  const canSubmitPassword =
    currentPassword.trim().length > 0 &&
    newPassword.trim().length >= 8 &&
    newPassword.trim() === confirmPassword.trim();

  async function updatePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    const next = newPassword.trim();
    const confirm = confirmPassword.trim();
    if (next.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      await userSettingsApi.changeMyPassword({ currentPassword: currentPassword.trim(), newPassword: next });
      setPasswordSuccess(true);
      clearPasswordFields();
    } catch {
      setPasswordError("Password update failed.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function toggleNotificationPref(row: AssignedProjectRow, field: NotificationField, value: boolean) {
    const updated = { ...row, [field]: value };
    setAssignedProjects((rows) => rows.map((r) => (r.projectId === row.projectId ? updated : r)));
    setNotifError(null);

    try {
      await userSettingsApi.updateProjectNotificationPrefs(row.projectId, toPrefsInput(updated));
    } catch {
      setAssignedProjects((rows) => rows.map((r) => (r.projectId === row.projectId ? row : r)));
      setNotifError("Couldn't save preference. Check your connection.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="User Settings" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="bp-card p-5">
          <h2 className="mb-4 text-xl font-semibold text-ink">Profile</h2>
          <form className="space-y-4" onSubmit={saveSettings}>
            <div>
              <span className="block text-sm font-medium text-ink">Email</span>
              <div className="mt-1 text-sm text-ink-muted">{user?.Email || "(not available)"}</div>
            </div>
            <label className="block text-sm font-medium text-ink">
              First name
              <input
                required
                disabled={loadingSettings}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Last name
              <input
                disabled={loadingSettings}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputClass}
              />
            </label>

            {settingsError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{settingsError}</p>}
            {settingsSuccess && (
              <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">Settings saved.</p>
            )}

            <button
              type="submit"
              disabled={savingSettings || loadingSettings}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
            >
              {savingSettings ? "Saving…" : "Save"}
            </button>
          </form>
        </section>

        <section className="bp-card p-5">
          <h2 className="mb-4 text-xl font-semibold text-ink">Change Password</h2>
          <form className="space-y-4" onSubmit={updatePassword}>
            <label className="block text-sm font-medium text-ink">
              Current password
              <input
                type="password"
                autoComplete="off"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            {passwordError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{passwordError}</p>}
            {passwordSuccess && (
              <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">Password updated.</p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={!canSubmitPassword || passwordSaving}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
              >
                {passwordSaving ? "Updating…" : "Update Password"}
              </button>
              <button
                type="button"
                onClick={clearPasswordFields}
                className="rounded-md px-3 py-1.5 text-sm text-ink hover:bg-slate-100"
              >
                Clear
              </button>
            </div>

            <Link to="/forgot-password" className="inline-block text-sm text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </form>
        </section>
      </div>

      <section className="bp-card p-5">
        <h2 className="mb-4 text-xl font-semibold text-ink">Notifications Per Assigned Project</h2>

        {notifError && <p className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{notifError}</p>}

        {assignedProjects.length === 0 ? (
          <p className="text-sm text-ink-muted">No projects assigned.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-mauve text-left text-white">
                <tr>
                  <th rowSpan={2} className="px-3 py-2 align-bottom font-medium">
                    Project
                  </th>
                  <th rowSpan={2} className="px-3 py-2 align-bottom font-medium">
                    Role
                  </th>
                  <th colSpan={3} className="px-3 py-1 text-center font-medium">
                    Scan Notifications
                  </th>
                  <th colSpan={3} className="px-3 py-1 text-center font-medium">
                    System Notifications
                  </th>
                </tr>
                <tr>
                  {NOTIFICATION_COLUMNS.map((col) => (
                    <th key={col.field} className="px-3 py-1 text-center font-medium">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assignedProjects.map((row) => (
                  <tr key={row.projectId} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-ink">{row.name}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-ink">
                        {row.role}
                      </span>
                    </td>
                    {NOTIFICATION_COLUMNS.map((col) => (
                      <td key={col.field} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={row[col.field]}
                          onChange={(e) => toggleNotificationPref(row, col.field, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
