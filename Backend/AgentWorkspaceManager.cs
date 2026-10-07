using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Collections.Generic;
using System.Linq;

namespace LlamaServerControl.Backend
{
    public class AgentWorkspaceManager
    {
        private string? _workspaceRoot;
        private static readonly HashSet<string> IgnoredDirs = new(StringComparer.OrdinalIgnoreCase)
        {
            ".git", "node_modules", "bin", "obj", ".vs", ".vscode", "__pycache__", ".llama_agent", "dist", "build"
        };

        public string? WorkspaceRoot => _workspaceRoot;

        public object SetWorkspace(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
                {
                    return new { status = "error", message = "Directory does not exist or path is invalid." };
                }

                _workspaceRoot = Path.GetFullPath(path);

                // Create backup directory
                string backupDir = Path.Combine(_workspaceRoot, ".llama_agent", "backups");
                Directory.CreateDirectory(backupDir);

                var summary = GetWorkspaceSummary();
                return new
                {
                    status = "success",
                    workspace_path = _workspaceRoot,
                    folder_name = Path.GetFileName(_workspaceRoot),
                    summary
                };
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        public object ClearWorkspace()
        {
            _workspaceRoot = null;
            return new { status = "success" };
        }

        public object GetWorkspaceSummary()
        {
            if (string.IsNullOrEmpty(_workspaceRoot) || !Directory.Exists(_workspaceRoot))
            {
                return new { has_workspace = false };
            }

            try
            {
                var files = Directory.EnumerateFiles(_workspaceRoot, "*", SearchOption.AllDirectories)
                    .Where(f => !IsIgnored(f))
                    .Take(150)
                    .Select(f => Path.GetRelativePath(_workspaceRoot, f).Replace('\\', '/'))
                    .ToList();

                var detectedTypes = new List<string>();
                if (File.Exists(Path.Combine(_workspaceRoot, "package.json"))) detectedTypes.Add("Node.js / Web");
                if (File.Exists(Path.Combine(_workspaceRoot, "requirements.txt")) || File.Exists(Path.Combine(_workspaceRoot, "pyproject.toml"))) detectedTypes.Add("Python");
                if (Directory.EnumerateFiles(_workspaceRoot, "*.csproj").Any()) detectedTypes.Add(".NET / C#");
                if (File.Exists(Path.Combine(_workspaceRoot, "index.html"))) detectedTypes.Add("HTML5 / Frontend");

                return new
                {
                    has_workspace = true,
                    workspace_path = _workspaceRoot,
                    folder_name = Path.GetFileName(_workspaceRoot),
                    file_count = files.Count,
                    project_types = detectedTypes,
                    files
                };
            }
            catch (Exception ex)
            {
                return new { has_workspace = true, workspace_path = _workspaceRoot, error = ex.Message };
            }
        }

        private bool IsIgnored(string fullPath)
        {
            if (string.IsNullOrEmpty(_workspaceRoot)) return false;
            string rel = Path.GetRelativePath(_workspaceRoot, fullPath);
            string[] parts = rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return parts.Any(p => IgnoredDirs.Contains(p));
        }

        private string ResolveSafePath(string relativeOrFullPath)
        {
            if (string.IsNullOrEmpty(_workspaceRoot))
            {
                throw new InvalidOperationException("No workspace folder is currently selected.");
            }

            string combined = Path.IsPathRooted(relativeOrFullPath)
                ? relativeOrFullPath
                : Path.Combine(_workspaceRoot, relativeOrFullPath);

            string full = Path.GetFullPath(combined);
            if (!full.StartsWith(_workspaceRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new UnauthorizedAccessException($"Access denied: '{relativeOrFullPath}' traverses outside the workspace folder.");
            }

            return full;
        }

        public async Task<object> ExecuteToolAsync(string toolName, JsonElement args)
        {
            if (string.IsNullOrEmpty(_workspaceRoot))
            {
                return new { status = "error", message = "No workspace project folder is currently opened. Please select a folder first." };
            }

            try
            {
                switch (toolName.ToLowerInvariant())
                {
                    case "list_directory":
                        return ListDirectory(args);

                    case "read_file":
                        return await ReadFileAsync(args);

                    case "write_file":
                        return await WriteFileAsync(args);

                    case "edit_file":
                        return await EditFileAsync(args);

                    case "create_directory":
                        return CreateDirectory(args);

                    case "delete_file":
                        return DeleteFile(args);

                    case "run_command":
                        return await RunCommandAsync(args);

                    default:
                        return new { status = "error", message = $"Unknown tool: '{toolName}'" };
                }
            }
            catch (Exception ex)
            {
                return new { status = "error", message = ex.Message };
            }
        }

        private object ListDirectory(JsonElement args)
        {
            string subDir = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            string targetDir = string.IsNullOrWhiteSpace(subDir) ? _workspaceRoot! : ResolveSafePath(subDir);

            if (!Directory.Exists(targetDir))
            {
                return new { status = "error", message = $"Directory not found: '{subDir}'" };
            }

            var entries = new List<object>();
            foreach (var dir in Directory.EnumerateDirectories(targetDir).Take(50))
            {
                string name = Path.GetFileName(dir);
                if (!IgnoredDirs.Contains(name))
                {
                    entries.Add(new { name, type = "directory", path = Path.GetRelativePath(_workspaceRoot!, dir).Replace('\\', '/') });
                }
            }

            foreach (var file in Directory.EnumerateFiles(targetDir).Take(100))
            {
                string name = Path.GetFileName(file);
                var fi = new FileInfo(file);
                entries.Add(new
                {
                    name,
                    type = "file",
                    path = Path.GetRelativePath(_workspaceRoot!, file).Replace('\\', '/'),
                    size_bytes = fi.Length,
                    size_kb = Math.Round(fi.Length / 1024.0, 1)
                });
            }

            return new
            {
                status = "success",
                path = Path.GetRelativePath(_workspaceRoot!, targetDir).Replace('\\', '/'),
                entries
            };
        }

        private async Task<object> ReadFileAsync(JsonElement args)
        {
            string filePath = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(filePath))
            {
                return new { status = "error", message = "Missing 'path' parameter." };
            }

            string full = ResolveSafePath(filePath);
            if (!File.Exists(full))
            {
                return new { status = "error", message = $"File not found: '{filePath}'" };
            }

            var fi = new FileInfo(full);
            if (fi.Length > 500 * 1024)
            {
                return new { status = "error", message = $"File too large ({Math.Round(fi.Length / 1024.0, 1)} KB). Max allowed for reading is 500 KB." };
            }

            string content = await File.ReadAllTextAsync(full, Encoding.UTF8);
            int lineCount = content.Split('\n').Length;

            return new
            {
                status = "success",
                path = Path.GetRelativePath(_workspaceRoot!, full).Replace('\\', '/'),
                lines = lineCount,
                size_bytes = fi.Length,
                content
            };
        }

        private async Task<object> WriteFileAsync(JsonElement args)
        {
            string filePath = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            string content = args.TryGetProperty("content", out var c) ? c.GetString() ?? "" : "";

            if (string.IsNullOrWhiteSpace(filePath))
            {
                return new { status = "error", message = "Missing 'path' parameter." };
            }

            string full = ResolveSafePath(filePath);
            string? dir = Path.GetDirectoryName(full);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            // Backup existing file if present
            if (File.Exists(full))
            {
                try
                {
                    string backupDir = Path.Combine(_workspaceRoot!, ".llama_agent", "backups");
                    string bkpName = $"{Path.GetFileName(full)}_{DateTime.UtcNow:yyyyMMdd_HHmmss}.bak";
                    File.Copy(full, Path.Combine(backupDir, bkpName), true);
                }
                catch { }
            }

            await File.WriteAllTextAsync(full, content, Encoding.UTF8);
            var fi = new FileInfo(full);
            int linesWritten = content.Split('\n').Length;

            return new
            {
                status = "success",
                action = "created_or_updated",
                path = Path.GetRelativePath(_workspaceRoot!, full).Replace('\\', '/'),
                lines = linesWritten,
                size_bytes = fi.Length,
                size_kb = Math.Round(fi.Length / 1024.0, 1)
            };
        }

        private async Task<object> EditFileAsync(JsonElement args)
        {
            string filePath = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            string searchTarget = args.TryGetProperty("search", out var s) ? s.GetString() ?? "" : "";
            string replacement = args.TryGetProperty("replace", out var r) ? r.GetString() ?? "" : "";

            if (string.IsNullOrWhiteSpace(filePath) || string.IsNullOrEmpty(searchTarget))
            {
                return new { status = "error", message = "Missing 'path' or 'search' parameters." };
            }

            string full = ResolveSafePath(filePath);
            if (!File.Exists(full))
            {
                return new { status = "error", message = $"File not found: '{filePath}'" };
            }

            string original = await File.ReadAllTextAsync(full, Encoding.UTF8);

            // 1. Normalize line endings for comparison
            string normOriginal = original.Replace("\r\n", "\n").Replace('\r', '\n');
            string normSearch = searchTarget.Replace("\r\n", "\n").Replace('\r', '\n');
            string normReplace = replacement.Replace("\r\n", "\n").Replace('\r', '\n');

            string modified;

            if (normOriginal.Contains(normSearch))
            {
                modified = normOriginal.Replace(normSearch, normReplace);
            }
            else if (!string.IsNullOrWhiteSpace(normSearch.Trim()) && normOriginal.Contains(normSearch.Trim()))
            {
                modified = normOriginal.Replace(normSearch.Trim(), normReplace.Trim());
            }
            else
            {
                // Multi-line trimmed fuzzy matching
                var searchLines = normSearch.Split('\n')
                    .Select(l => l.Trim())
                    .Where(l => !string.IsNullOrEmpty(l))
                    .ToList();

                var origLines = normOriginal.Split('\n');
                int matchStart = -1, matchEnd = -1;

                if (searchLines.Count > 0)
                {
                    for (int i = 0; i < origLines.Length; i++)
                    {
                        if (origLines[i].Trim() == searchLines[0])
                        {
                            bool allMatched = true;
                            int k = i;
                            for (int j = 0; j < searchLines.Count; j++, k++)
                            {
                                while (k < origLines.Length && string.IsNullOrWhiteSpace(origLines[k])) k++;
                                if (k >= origLines.Length || origLines[k].Trim() != searchLines[j])
                                {
                                    allMatched = false;
                                    break;
                                }
                            }
                            if (allMatched)
                            {
                                matchStart = i;
                                matchEnd = k - 1;
                                break;
                            }
                        }
                    }
                }

                if (matchStart >= 0 && matchEnd >= matchStart)
                {
                    var before = string.Join("\n", origLines.Take(matchStart));
                    var after = string.Join("\n", origLines.Skip(matchEnd + 1));
                    modified = (string.IsNullOrEmpty(before) ? "" : before + "\n") + normReplace + (string.IsNullOrEmpty(after) ? "" : "\n" + after);
                }
                else
                {
                    return new
                    {
                        status = "error",
                        message = $"Target chunk was not found in '{filePath}'. TIP: Use 'write_file' with the full updated content to guarantee a clean edit."
                    };
                }
            }

            // Restore Windows CRLF line endings if original used them
            if (original.Contains("\r\n"))
            {
                modified = modified.Replace("\n", "\r\n");
            }

            // Backup existing file
            try
            {
                string backupDir = Path.Combine(_workspaceRoot!, ".llama_agent", "backups");
                string bkpName = $"{Path.GetFileName(full)}_{DateTime.UtcNow:yyyyMMdd_HHmmss}.bak";
                File.Copy(full, Path.Combine(backupDir, bkpName), true);
            }
            catch { }

            await File.WriteAllTextAsync(full, modified, Encoding.UTF8);

            int diffLines = Math.Abs(modified.Split('\n').Length - original.Split('\n').Length);

            return new
            {
                status = "success",
                action = "edited",
                path = Path.GetRelativePath(_workspaceRoot!, full).Replace('\\', '/'),
                lines_delta = diffLines,
                size_bytes = new FileInfo(full).Length
            };
        }

        private object CreateDirectory(JsonElement args)
        {
            string dirPath = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(dirPath))
            {
                return new { status = "error", message = "Missing 'path' parameter." };
            }

            string full = ResolveSafePath(dirPath);
            Directory.CreateDirectory(full);

            return new
            {
                status = "success",
                action = "created_directory",
                path = Path.GetRelativePath(_workspaceRoot!, full).Replace('\\', '/')
            };
        }

        private object DeleteFile(JsonElement args)
        {
            string filePath = args.TryGetProperty("path", out var p) ? p.GetString() ?? "" : "";
            if (string.IsNullOrWhiteSpace(filePath))
            {
                return new { status = "error", message = "Missing 'path' parameter." };
            }

            string full = ResolveSafePath(filePath);
            if (File.Exists(full))
            {
                File.Delete(full);
                return new { status = "success", action = "deleted_file", path = filePath };
            }
            else if (Directory.Exists(full))
            {
                Directory.Delete(full, true);
                return new { status = "success", action = "deleted_directory", path = filePath };
            }

            return new { status = "error", message = $"Item not found: '{filePath}'" };
        }

        private async Task<object> RunCommandAsync(JsonElement args)
        {
            string command = args.TryGetProperty("command", out var c) ? c.GetString() ?? "" : "";
            string shell = args.TryGetProperty("shell", out var s) ? s.GetString() ?? "powershell" : "powershell";

            if (string.IsNullOrWhiteSpace(command))
            {
                return new { status = "error", message = "Missing 'command' parameter." };
            }

            string fileName = shell.Equals("cmd", StringComparison.OrdinalIgnoreCase) ? "cmd.exe" : "powershell.exe";
            string shellArgs = shell.Equals("cmd", StringComparison.OrdinalIgnoreCase) ? $"/c {command}" : $"-NoProfile -NonInteractive -Command \"{command}\"";

            var sw = Stopwatch.StartNew();
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = shellArgs,
                WorkingDirectory = _workspaceRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = new Process { StartInfo = psi };
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();

            proc.OutputDataReceived += (sender, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
            proc.ErrorDataReceived += (sender, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(45));
            try
            {
                await proc.WaitForExitAsync(cts.Token);
                sw.Stop();

                return new
                {
                    status = "success",
                    exit_code = proc.ExitCode,
                    stdout = stdout.ToString().Trim(),
                    stderr = stderr.ToString().Trim(),
                    duration_ms = sw.ElapsedMilliseconds
                };
            }
            catch (OperationCanceledException)
            {
                try { proc.Kill(true); } catch { }
                return new { status = "timeout", message = "Command execution timed out after 45 seconds." };
            }
        }
    }
}
