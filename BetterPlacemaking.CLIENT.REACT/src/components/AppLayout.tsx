import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartLine,
  faCube,
  faDownload,
  faEye,
  faFolder,
  faFolderOpen,
  faUser,
  faUserShield,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { useAuth } from "../auth/AuthContext";
import { HasPermission } from "../auth/HasPermission";
import { RequireAuth } from "../routes/RequireAuth";
import * as projectApi from "../services/projectApi";
import { toggleDarkMode, useIsDark } from "../theme/themeService";
import { Menu, type MenuHandle, type MenuItem } from "./prime/Menu";

/** Port of the Angular DefaultLayout (default-layout.html/.ts): title bar + 15rem sidebar + inset content panel. */

type PermissionMenuItem = MenuItem & {
  faIcon?: IconDefinition;
  piIcon?: string;
  permission?: string | string[];
  permissionProjectId?: string | null;
  permissionMode?: "all" | "any";
  items?: PermissionMenuItem[];
};

const PROJECT_SECTION_PERMISSIONS = [
  "Project.Read",
  "Project.Scans.Read",
  "Project.Vision.Read",
  "Project.Devices.Read",
  "Project.Export",
  "Project.Members.AssignEditorViewer",
];
const ADMIN_SECTION_PERMISSIONS = ["Global.Users.Read", "Global.Projects.ReadAll"];

/** Top-level segments that are static routes; anything else in the first segment is a :projectId. */
const STATIC_SEGMENTS = new Set(["projects", "admin", "user-settings", "login", "forgot-password", "reset-password"]);

function projectIdFromPath(pathname: string): string | undefined {
  const first = pathname.split("/").filter(Boolean)[0]?.trim();
  return first && !STATIC_SEGMENTS.has(first) ? first : undefined;
}

function PermissionGate({ item, children }: { item: PermissionMenuItem; children: ReactNode }) {
  if (!item.permission) return <>{children}</>;
  return (
    <HasPermission
      permission={item.permission}
      projectId={item.permissionProjectId ?? undefined}
      mode={item.permissionMode ?? "all"}
    >
      {children}
    </HasPermission>
  );
}

function NavLinkItem({ item }: { item: PermissionMenuItem }) {
  const inner = (
    <>
      {item.faIcon && <FontAwesomeIcon icon={item.faIcon} />}
      <span>{item.label}</span>
    </>
  );
  return (
    <PermissionGate item={item}>
      {item.routerLink ? (
        <Link to={item.routerLink} className="p-menu-item-link">
          {inner}
        </Link>
      ) : (
        <a className="p-menu-item-link">{inner}</a>
      )}
    </PermissionGate>
  );
}

function FooterItem({ item }: { item: PermissionMenuItem }) {
  return (
    <button type="button" className="p-menu-item-link">
      {item.faIcon && <FontAwesomeIcon icon={item.faIcon} />}
      {item.piIcon && <i className={item.piIcon} />}
      <span>{item.label}</span>
    </button>
  );
}

export function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dark = useIsDark();
  const userMenu = useRef<MenuHandle>(null);

  const projectId = projectIdFromPath(pathname);
  const [currentProjectName, setCurrentProjectName] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setCurrentProjectName(null);
      return;
    }
    let cancelled = false;
    projectApi
      .getProject(projectId)
      .then((p) => !cancelled && setCurrentProjectName(p.Title || null))
      .catch(() => !cancelled && setCurrentProjectName(null));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const navItems = useMemo<PermissionMenuItem[]>(
    () => [{ label: "Select Project", faIcon: faFolder, routerLink: projectId ? `/${projectId}/projects` : "/projects" }],
    [projectId],
  );

  const navItemsIfSelected = useMemo<PermissionMenuItem[]>(() => {
    if (!projectId) return [];
    const base = projectId;
    return [
      {
        label: "Project",
        items: [
          { label: "Dashboard", faIcon: faChartLine, routerLink: `/${base}/dashboard`, permission: "Project.Read", permissionProjectId: base },
          { label: "Floor Plan", faIcon: faCube, routerLink: `/${base}/model`, permission: "Project.Scans.Read", permissionProjectId: base },
          { label: "Calibration", faIcon: faEye, routerLink: `/${base}/calibration`, permission: "Project.Vision.Read", permissionProjectId: base },
          { label: "Permissions", faIcon: faUserShield, routerLink: `/${base}/admin/permissions`, permission: "Project.Members.AssignEditorViewer", permissionProjectId: base },
          {
            label: "Export Data",
            faIcon: faDownload,
            // TODO(export-modal): open the ported ExportModal (Angular: DialogService.open(ExportModal, { header: 'Configure Export', width: '720px' })).
            command: () => undefined,
            permission: "Project.Export",
            permissionProjectId: base,
          },
        ],
      },
    ];
  }, [projectId]);

  const navItemsAdmin = useMemo<PermissionMenuItem[]>(() => {
    const prefix = projectId ? `/${projectId}` : "";
    return [
      {
        label: "Admin",
        items: [
          { label: "Users", faIcon: faUserShield, routerLink: `${prefix}/admin/users`, permission: "Global.Users.Read" },
          { label: "Manage Projects", faIcon: faFolderOpen, routerLink: `${prefix}/admin/projects`, permission: "Global.Projects.ReadAll" },
        ],
      },
    ];
  }, [projectId]);

  const footerItems: PermissionMenuItem[] = [
    { label: "Toggle appearance", piIcon: dark ? "pi pi-sun" : "pi pi-moon", command: () => toggleDarkMode() },
    { label: "User", faIcon: faUser, command: ({ originalEvent }) => userMenu.current?.toggle(originalEvent) },
  ];

  const userMenuItems: MenuItem[] = [
    { label: "Settings", icon: "pi pi-cog", routerLink: projectId ? `/${projectId}/user-settings` : "/user-settings" },
    {
      label: "Logout",
      icon: "pi pi-sign-out",
      command: () => {
        void logout().finally(() => navigate("/login"));
      },
    },
  ];

  return (
    <RequireAuth>
      <div className="main-wrapper flex flex-col h-screen overflow-hidden">
        <div className="content-background h-16">
          <div className="flex items-center justify-start w-full">
            <Link to="/" className="flex items-center gap-3 p-3 no-underline justify-start">
              <span className="text-3xl font-semibold tracking-tight text-on-surface-900">Better Placemaking Tracking &amp; Modeling</span>
              {currentProjectName && <span className="text-xl text-muted-color">{currentProjectName}</span>}
            </Link>
          </div>
        </div>

        <div className="flex grow min-h-0 overflow-hidden">
          <div className="w-60 min-h-0 content-background flex flex-col">
            <div>
              <nav className="px-3 mb-7 mt-3">
                <Menu model={navItems} itemTemplate={(item) => <NavLinkItem item={item} />} />
              </nav>
            </div>

            {navItemsIfSelected.length > 0 && (
              <HasPermission permission={PROJECT_SECTION_PERMISSIONS} projectId={projectId} mode="any">
                <nav className="px-3 mb-7">
                  <Menu model={navItemsIfSelected} itemTemplate={(item) => <NavLinkItem item={item} />} />
                </nav>
              </HasPermission>
            )}

            <HasPermission permission={ADMIN_SECTION_PERMISSIONS} mode="any">
              <nav className="px-3 mb-7">
                <Menu model={navItemsAdmin} itemTemplate={(item) => <NavLinkItem item={item} />} />
              </nav>
            </HasPermission>

            <nav className="px-3 mt-auto mb-4">
              <Menu model={footerItems} itemTemplate={(item) => <FooterItem item={item} />} />
              <Menu ref={userMenu} popup model={userMenuItems} styleClass="w-48" />
            </nav>
          </div>

          <div className="grow min-h-0 overflow-y-auto inset-shadow-sm surface-ground p-8 rounded-lg">
            <Outlet />
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
