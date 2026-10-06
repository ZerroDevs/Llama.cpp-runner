using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Threading;

namespace LlamaServerControl.Backend
{
    public class HardwareMonitor
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;

            public MEMORYSTATUSEX()
            {
                dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            }
        }

        [return: MarshalAs(UnmanagedType.Bool)]
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX lpBuffer);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetSystemTimes(out long lpIdleTime, out long lpKernelTime, out long lpUserTime);

        private long _prevIdle = 0;
        private long _prevKernel = 0;
        private long _prevUser = 0;

        public Dictionary<string, object> GetHardwareData()
        {
            var data = new Dictionary<string, object>();

            // RAM
            var mem = new MEMORYSTATUSEX();
            if (GlobalMemoryStatusEx(mem))
            {
                double totalRamGb = mem.ullTotalPhys / (1024.0 * 1024.0 * 1024.0);
                double availRamGb = mem.ullAvailPhys / (1024.0 * 1024.0 * 1024.0);
                double usedRamGb = totalRamGb - availRamGb;

                int ramPct = (int)mem.dwMemoryLoad;
                data["ram_total"] = Math.Round(totalRamGb, 1);
                data["ram_used"] = Math.Round(usedRamGb, 1);
                data["ram_percent"] = ramPct;
                data["ram_pct"] = ramPct;
            }
            else
            {
                data["ram_total"] = 16.0;
                data["ram_used"] = 8.0;
                data["ram_percent"] = 50;
                data["ram_pct"] = 50;
            }

            // CPU
            int cpuUsage = GetCpuUsage();
            data["cpu_percent"] = cpuUsage;
            data["cpu_pct"] = cpuUsage;

            // GPU via nvidia-smi quick query or fallback
            QueryNvidiaGpu(data);

            return data;
        }

        private int GetCpuUsage()
        {
            if (GetSystemTimes(out long idle, out long kernel, out long user))
            {
                if (_prevKernel == 0 && _prevUser == 0)
                {
                    _prevIdle = idle;
                    _prevKernel = kernel;
                    _prevUser = user;
                    return 10;
                }

                long usrDiff = user - _prevUser;
                long kerDiff = kernel - _prevKernel;
                long idlDiff = idle - _prevIdle;

                _prevIdle = idle;
                _prevKernel = kernel;
                _prevUser = user;

                long sys = kerDiff + usrDiff;
                if (sys > 0)
                {
                    double cpu = (double)(sys - idlDiff) * 100.0 / sys;
                    return Math.Clamp((int)Math.Round(cpu), 0, 100);
                }
            }
            return 10;
        }

        private void QueryNvidiaGpu(Dictionary<string, object> data)
        {
            data["vram_used"] = 0.0;
            data["vram_total"] = 0.0;
            data["vram_percent"] = 0;
            data["vram_pct"] = 0;
            data["gpu_temp"] = 0;
            data["gpu_name"] = "GPU";

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "nvidia-smi",
                    Arguments = "--query-gpu=name,memory.total,memory.used,temperature.gpu --format=csv,noheader,nounits",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    string output = proc.StandardOutput.ReadToEnd();
                    proc.WaitForExit(800);

                    string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    if (lines.Length > 0)
                    {
                        string[] parts = lines[0].Split(',');
                        if (parts.Length >= 4)
                        {
                            data["gpu_name"] = parts[0].Trim();
                            if (double.TryParse(parts[1].Trim(), out double totalMb) &&
                                double.TryParse(parts[2].Trim(), out double usedMb))
                            {
                                double totalGb = Math.Round(totalMb / 1024.0, 1);
                                double usedGb = Math.Round(usedMb / 1024.0, 1);
                                int pct = totalMb > 0 ? (int)Math.Round((usedMb / totalMb) * 100) : 0;

                                data["vram_total"] = totalGb;
                                data["vram_used"] = usedGb;
                                data["vram_percent"] = pct;
                                data["vram_pct"] = pct;
                            }
                            if (int.TryParse(parts[3].Trim(), out int temp))
                            {
                                data["gpu_temp"] = temp;
                            }
                        }
                    }
                }
            }
            catch
            {
                // Non-Nvidia or integrated graphics fallback
            }
        }
    }
}
