namespace BetterPlacemaking.Authorization
{
    public static class Permissions
    {
        public static class Global
        {
            public static class Users
            {
                public const string Read = "Global.Users.Read";
                public const string Update = "Global.Users.Update";

                public static readonly string[] All =
                [
                    Read,
                    Update
                ];
            }
        }

        public static class Project
        {
            public const string Read = "Project.Read";
            public const string Create = "Project.Create";
            public const string Update = "Project.Update";
            public const string Delete = "Project.Delete";

            public static readonly string[] All =
            [
                Read,
                Create,
                Update,
                Delete
            ];
        }
    }
}
