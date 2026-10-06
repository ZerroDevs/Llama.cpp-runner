using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;

namespace LlamaServerControl.Backend
{
    public class ModelScanner
    {
        public static List<Dictionary<string, object>> ScanDirectory(string rootDir)
        {
            var results = new List<Dictionary<string, object>>();
            if (string.IsNullOrWhiteSpace(rootDir) || !Directory.Exists(rootDir))
            {
                return results;
            }

            try
            {
                var files = Directory.EnumerateFiles(rootDir, "*.gguf", SearchOption.AllDirectories)
                    .Select(f => new FileInfo(f))
                    .OrderBy(f => f.Name)
                    .ToList();

                foreach (var fi in files)
                {
                    long length = fi.Length;
                    if (length == 0)
                    {
                        try
                        {
                            if (fi.LinkTarget != null && fi.ResolveLinkTarget(true) is FileInfo { Exists: true } target)
                            {
                                length = target.Length;
                            }
                        }
                        catch { }

                        if (length == 0)
                        {
                            try
                            {
                                using var fs = new FileStream(fi.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                                length = fs.Length;
                            }
                            catch { }
                        }
                    }

                    double sizeGb = Math.Round(length / (1024.0 * 1024.0 * 1024.0), 2);
                    bool isVision = fi.Name.Contains("mmproj", StringComparison.OrdinalIgnoreCase);

                    results.Add(new Dictionary<string, object>
                    {
                        { "name", fi.Name },
                        { "path", fi.FullName },
                        { "size_gb", sizeGb },
                        { "modified", fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm") },
                        { "is_vision", isVision },
                        { "tag", isVision ? "Vision" : "" }
                    });
                }
            }
            catch { }

            return results;
        }
    }
}
