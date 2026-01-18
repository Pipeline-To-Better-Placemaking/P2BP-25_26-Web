using System.Text;

internal static class DotEnv
{
    public static void LoadIfPresent(string contentRootPath)
    {
        var path = Path.Combine(contentRootPath, ".env");
        if (!File.Exists(path))
            return;

        foreach (var rawLine in File.ReadAllLines(path, Encoding.UTF8))
        {
            var line = rawLine.Trim();
            if (line.Length == 0)
                continue;
            if (line.StartsWith('#'))
                continue;

            var idx = line.IndexOf('=');
            if (idx <= 0)
                continue;

            var key = line[..idx].Trim();
            if (key.Length == 0)
                continue;

            var value = line[(idx + 1)..].Trim();

            // Strip optional surrounding quotes.
            if (value.Length >= 2)
            {
                if ((value.StartsWith('"') && value.EndsWith('"')) || (value.StartsWith('\'') && value.EndsWith('\'')))
                    value = value[1..^1];
            }

            // Do not override an existing env var (lets Cloud Run / shell env win).
            var existing = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrEmpty(existing))
                continue;

            Environment.SetEnvironmentVariable(key, value);
        }
    }
}
