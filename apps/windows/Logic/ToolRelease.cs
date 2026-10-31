// Cast Tools (Windows): oberflächenfreie Regeln für das Laden der originalen Desktop-Fassung aus dem offiziellen GitHub-Release –
// passende portable ZIP zur Prozessorarchitektur wählen, Prüfsumme aus SHA256SUMS.txt lesen, Startprogramm im entpackten Ordner finden.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace AnMaChaCast.Logic
{
    public static class ToolRelease
    {
        /// <summary>Asset „{repo}-{version}-windows-{arch}-portable.zip“ (arch: x64, arm64, x86); null, wenn keins passt.</summary>
        public static string PickPortableZip(string repoName, IEnumerable<string> assetNames, string arch)
        {
            var re = new Regex("^" + Regex.Escape(repoName) + @"-[0-9][0-9A-Za-z.+-]*-windows-" + Regex.Escape(arch) + @"-portable\.zip$", RegexOptions.IgnoreCase);
            return assetNames.FirstOrDefault(n => re.IsMatch(n));
        }

        /// <summary>Architektur-Kürzel wie in den Release-Namen; x64-Fassung läuft auch unter Windows on ARM (Emulation) als Ersatz.</summary>
        public static string[] ArchOrder(string processorArchitecture)
        {
            var a = (processorArchitecture ?? "").ToUpperInvariant();
            if (a == "ARM64") return new[] { "arm64", "x64" };
            if (a == "X86") return new[] { "x86" };
            return new[] { "x64" };
        }

        /// <summary>Prüfsumme (64 Hex-Zeichen, klein) für eine Datei aus SHA256SUMS.txt („hash  name“ oder „hash *name“).</summary>
        public static string Checksum(string sums, string fileName)
        {
            foreach (var raw in (sums ?? "").Split('\n'))
            {
                var line = raw.Trim();
                var m = Regex.Match(line, @"^([0-9A-Fa-f]{64})\s+\*?(.+)$");
                if (m.Success && m.Groups[2].Value.Trim() == fileName) return m.Groups[1].Value.ToLowerInvariant();
            }
            return null;
        }

        /// <summary>Startprogramm im entpackten Ordner: bevorzugt „{repo}.exe“, sonst das flachste .exe ohne Installer/Updater im Namen.</summary>
        public static string PickExe(string repoName, IEnumerable<string> relativeExePaths)
        {
            var list = relativeExePaths.Select(p => p.Replace('\\', '/')).ToList();
            var exact = list.Where(p => string.Equals(p.Split('/').Last(), repoName + ".exe", StringComparison.OrdinalIgnoreCase)).OrderBy(p => p.Count(c => c == '/')).FirstOrDefault();
            if (exact != null) return exact;
            return list.Where(p => !Regex.IsMatch(p.Split('/').Last(), "unins|install|update|crash|helper", RegexOptions.IgnoreCase))
                .OrderBy(p => p.Count(c => c == '/')).ThenBy(p => p, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
        }

        /// <summary>Versionsangabe für Ordnernamen (nur sichere Zeichen).</summary>
        public static string SafeVersion(string tag)
        {
            var v = Regex.Replace(tag ?? "", "[^0-9A-Za-z.+-]", "").Trim('.');
            return v.Length == 0 ? "unbekannt" : v.Length > 40 ? v.Substring(0, 40) : v;
        }
    }
}
