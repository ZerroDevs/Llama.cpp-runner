using System;
using System.IO;
using System.Text;
using System.Collections.Generic;

namespace LlamaServerControl.Backend
{
    public class PngMetadataReader
    {
        public static Dictionary<string, string> ExtractMetadata(string filePath)
        {
            var metadata = new Dictionary<string, string>();
            if (!File.Exists(filePath)) return metadata;

            try
            {
                var fi = new FileInfo(filePath);
                metadata["File Size"] = $"{Math.Round(fi.Length / 1024.0, 1)} KB";
                metadata["Created"] = fi.CreationTime.ToString("g");

                if (!filePath.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                {
                    return metadata;
                }

                using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read);
                byte[] header = new byte[8];
                if (fs.Read(header, 0, 8) != 8) return metadata;

                // PNG signature: 89 50 4E 47 0D 0A 1A 0A
                if (header[0] != 0x89 || header[1] != 0x50 || header[2] != 0x4E || header[3] != 0x47 ||
                    header[4] != 0x0D || header[5] != 0x0A || header[6] != 0x1A || header[7] != 0x0A)
                {
                    return metadata;
                }

                byte[] lengthBuf = new byte[4];
                byte[] typeBuf = new byte[4];

                while (fs.Position < fs.Length)
                {
                    if (fs.Read(lengthBuf, 0, 4) != 4) break;
                    if (fs.Read(typeBuf, 0, 4) != 4) break;

                    Array.Reverse(lengthBuf);
                    uint length = BitConverter.ToUInt32(lengthBuf, 0);
                    string chunkType = Encoding.ASCII.GetString(typeBuf);

                    if (chunkType == "tEXt" || chunkType == "iTXt")
                    {
                        byte[] data = new byte[length];
                        fs.ReadExactly(data, 0, (int)length);
                        fs.Seek(4, SeekOrigin.Current); // Skip CRC

                        if (chunkType == "tEXt")
                        {
                            int nullIdx = Array.IndexOf(data, (byte)0);
                            if (nullIdx > 0 && nullIdx < data.Length - 1)
                            {
                                string key = Encoding.Latin1.GetString(data, 0, nullIdx).Trim();
                                string val = Encoding.Latin1.GetString(data, nullIdx + 1, data.Length - nullIdx - 1).Trim();
                                if (!string.IsNullOrEmpty(key) && !string.IsNullOrEmpty(val))
                                {
                                    metadata[key] = val;
                                }
                            }
                        }
                        else if (chunkType == "iTXt")
                        {
                            int nullIdx1 = Array.IndexOf(data, (byte)0);
                            if (nullIdx1 > 0)
                            {
                                string key = Encoding.Latin1.GetString(data, 0, nullIdx1).Trim();
                                int nullIdx2 = Array.IndexOf(data, (byte)0, nullIdx1 + 3);
                                if (nullIdx2 != -1)
                                {
                                    int nullIdx3 = Array.IndexOf(data, (byte)0, nullIdx2 + 1);
                                    if (nullIdx3 != -1 && nullIdx3 < data.Length - 1)
                                    {
                                        string val = Encoding.UTF8.GetString(data, nullIdx3 + 1, data.Length - nullIdx3 - 1).Trim();
                                        if (!string.IsNullOrEmpty(key) && !string.IsNullOrEmpty(val))
                                        {
                                            metadata[key] = val;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    else if (chunkType == "IEND")
                    {
                        break;
                    }
                    else
                    {
                        // Skip payload and CRC directly without allocating any memory
                        fs.Seek(length + 4, SeekOrigin.Current);
                    }
                }
            }
            catch { }

            return metadata;
        }
    }
}
