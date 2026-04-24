namespace BetterPlacemaking.Authorization
{
    public static class Permissions
    {
        public static class Global
        {
            public static class Projects
            {
                public const string Create = "Global.Projects.Create";
                public const string ReadAll = "Global.Projects.ReadAll";
                public const string ManageGlobal = "Global.Projects.ManageGlobal";

                public static readonly string[] All =
                [
                    Create,
                    ReadAll,
                    ManageGlobal
                ];
            }

            public static class Roles
            {
                public const string ManageDefinitions = "Global.Roles.ManageDefinitions";

                public static readonly string[] All =
                [
                    ManageDefinitions
                ];
            }

            public static class Users
            {
                public const string Read = "Global.Users.Read";
                public const string ManageGlobalRoles = "Global.Users.ManageGlobalRoles";

                public static readonly string[] All =
                [
                    Read,
                    ManageGlobalRoles
                ];
            }

            public static readonly string[] All =
            [
                ..Users.All,
                ..Projects.All,
                ..Roles.All
            ];
        }

        public static class Project
        {
            public const string Read = "Project.Read";
            public const string Update = "Project.Update";
            public const string Delete = "Project.Delete";
            public const string Export = "Project.Export";
            public const string DevicesRead = "Project.Devices.Read";
            public const string DevicesManage = "Project.Devices.Manage";
            public const string MembersRead = "Project.Members.Read";
            public const string MembersAssignEditorViewer = "Project.Members.AssignEditorViewer";
            public const string ScansRead = "Project.Scans.Read";
            public const string ScansStart = "Project.Scans.Start";
            public const string ScansDelete = "Project.Scans.Delete";
            public const string ScanSchedulesRead = "Project.ScanSchedules.Read";
            public const string ScanSchedulesManage = "Project.ScanSchedules.Manage";

            public static readonly string[] All =
            [
                Read,
                Update,
                Delete,
                Export,
                DevicesRead,
                DevicesManage,
                MembersRead,
                MembersAssignEditorViewer,
                ScansRead,
                ScansStart,
                ScansDelete,
                ScanSchedulesRead,
                ScanSchedulesManage
            ];

            public static readonly string[] Viewer =
            [
                Read,
                Export,
                DevicesRead,
                MembersRead,
                ScansRead,
                ScanSchedulesRead
            ];

            public static readonly string[] Editor =
            [
                ..Viewer,
                Update,
                DevicesManage,
                ScansStart,
                ScansDelete,
                ScanSchedulesManage
            ];

            public static readonly string[] Admin =
            [
                ..Editor,
                Delete,
                MembersAssignEditorViewer
            ];
        }
    }
}
