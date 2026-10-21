import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { AppLayout } from "./components/AppLayout";
import { RequirePermission } from "./routes/RequirePermission";
import { Permissions } from "./lib/permissions";
import { Login } from "./pages/Login";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { SelectProject } from "./pages/projects/SelectProject";
import { ProjectsList } from "./pages/projects/ProjectsList";
import { ProjectWorkspace } from "./pages/projects/ProjectWorkspace";
import { ProjectPermissions } from "./pages/projects/ProjectPermissions";
import { DevicesList } from "./pages/devices/DevicesList";
import { PermissionsList } from "./pages/admin/PermissionsList";
import { UserSettings } from "./pages/UserSettings";
import { Dashboard } from "./pages/projects/Dashboard";
import { Vision } from "./pages/projects/vision/Vision";
import { Fusion } from "./pages/projects/fusion/Fusion";
import { Calibration } from "./pages/projects/calibration/Calibration";
import { Puzzle } from "./pages/projects/calibration/Puzzle";
import { RequirePuzzleReady } from "./routes/RequirePuzzleReady";
import { MultiLidarCalibration } from "./pages/projects/MultiLidarCalibration";
import { Scanner } from "./pages/projects/Scanner";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<AppLayout />}>
          <Route path="/projects" element={<SelectProject />} />
          {/* Mirrors the Angular route table's `user-settings` - no permission guard, any
              signed-in user manages their own profile/password/notifications. */}
          <Route path="/user-settings" element={<UserSettings />} />
          <Route
            path="/admin/projects"
            element={
              <RequirePermission scope="global" permission={Permissions.Global.ProjectsReadAll}>
                <ProjectsList />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequirePermission scope="global" permission={Permissions.Global.UsersRead}>
                <PermissionsList />
              </RequirePermission>
            }
          />
          {/* The Angular table keeps `admin/permissions` as a redirect to `admin/users`;
              preserved so existing links/bookmarks keep working. */}
          <Route path="/admin/permissions" element={<Navigate to="/admin/users" replace />} />
          <Route
            path="/:projectId"
            element={
              <RequirePermission permission={Permissions.Project.Read}>
                <ProjectWorkspace />
              </RequirePermission>
            }
          >
            <Route index element={<Dashboard />} />
            <Route
              path="dashboard"
              element={
                <RequirePermission permission={Permissions.Project.Read}>
                  <Dashboard />
                </RequirePermission>
              }
            />
            <Route
              path="vision"
              element={
                <RequirePermission permission={Permissions.Project.VisionRead}>
                  <Vision />
                </RequirePermission>
              }
            />
            <Route
              path="fusion"
              element={
                <RequirePermission permission={Permissions.Project.ScansRead}>
                  <Fusion />
                </RequirePermission>
              }
            />
            <Route
              path="calibration"
              element={
                <RequirePermission permission={Permissions.Project.VisionRead}>
                  <Calibration />
                </RequirePermission>
              }
            />
            <Route
              path="calibration/puzzle"
              element={
                <RequirePermission permission={Permissions.Project.VisionRead}>
                  <RequirePuzzleReady>
                    <Puzzle />
                  </RequirePuzzleReady>
                </RequirePermission>
              }
            />
            <Route
              path="lidar-calibration"
              element={
                <RequirePermission permission={Permissions.Project.Update}>
                  <MultiLidarCalibration />
                </RequirePermission>
              }
            />
            <Route
              path="model"
              element={
                <RequirePermission permission={Permissions.Project.ScansRead}>
                  <Scanner />
                </RequirePermission>
              }
            />
            <Route
              path="admin/projects"
              element={
                <RequirePermission scope="global" permission={Permissions.Global.ProjectsReadAll}>
                  <ProjectsList />
                </RequirePermission>
              }
            />
            <Route
              path="admin/users"
              element={
                <RequirePermission scope="global" permission={Permissions.Global.UsersRead}>
                  <PermissionsList />
                </RequirePermission>
              }
            />
            {/* Project-scoped member/role management. Note this path is `admin/permissions`
                under a :projectId, whereas the top-level `/admin/permissions` redirects to
                the global user list - same split as the Angular route table. */}
            <Route
              path="admin/permissions"
              element={
                <RequirePermission permission={Permissions.Project.MembersAssignEditorViewer}>
                  <ProjectPermissions />
                </RequirePermission>
              }
            />
            <Route
              path="devices"
              element={
                <RequirePermission permission={Permissions.Project.DevicesRead}>
                  <DevicesList />
                </RequirePermission>
              }
            />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </AuthProvider>
  );
}
