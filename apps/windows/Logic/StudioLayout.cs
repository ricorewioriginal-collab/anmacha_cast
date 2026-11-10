// Frei anordenbares Live-Studio (Windows): die Felder unter den Decks (Cardwall, Archiv, Warteschlange, Automation,
// Schnellzugriff, Voicetrack, Encoder) liegen auf einem Raster aus 12 Spalten und Zeilen fester Höhe – frei verschiebbar
// und in der Größe änderbar, Lücken sind erlaubt. Überlappt ein Feld ein anderes, weicht das andere nach unten aus.
// Oberflächenfrei und testbar; gespeichert je Gerät als kleine Textdatei (eine Zeile je Feld).
using System;
using System.Collections.Generic;
using System.Linq;

namespace AnMaChaCast.Logic
{
    public sealed class LayoutBox
    {
        public string Id = "";
        public int X, Y, W, H;
        public LayoutBox Copy() => new LayoutBox { Id = Id, X = X, Y = Y, W = W, H = H };
        public bool Overlaps(LayoutBox o) => X < o.X + o.W && o.X < X + W && Y < o.Y + o.H && o.Y < Y + H;
    }

    public sealed class StudioLayout
    {
        public const int Cols = 12;

        /// <summary>Alle Felder des Live-Studios (unterhalb der Decks).</summary>
        public static readonly string[] AllPanels = { "carts", "archive", "queue", "automation", "quick", "voicetrack", "encoders" };

        /// <summary>Mindestgröße je Feld in Rasterzellen (Breite, Höhe).</summary>
        public static readonly Dictionary<string, (int W, int H)> Min = new Dictionary<string, (int, int)>
        {
            ["carts"] = (3, 4), ["archive"] = (4, 6), ["queue"] = (4, 6), ["automation"] = (3, 4), ["quick"] = (3, 5), ["voicetrack"] = (3, 5), ["encoders"] = (3, 5),
        };

        public List<LayoutBox> Boxes = new List<LayoutBox>();

        /// <summary>Standard wie bisher: Cardwall + Archiv | Warteschlange | Automation, Schnellzugriff, Voicetrack, Encoder.</summary>
        public static StudioLayout Default()
        {
            var l = new StudioLayout();
            l.Boxes.Add(new LayoutBox { Id = "carts", X = 0, Y = 0, W = 5, H = 7 });
            l.Boxes.Add(new LayoutBox { Id = "archive", X = 0, Y = 7, W = 5, H = 9 });
            l.Boxes.Add(new LayoutBox { Id = "queue", X = 5, Y = 0, W = 4, H = 16 });
            l.Boxes.Add(new LayoutBox { Id = "automation", X = 9, Y = 0, W = 3, H = 4 });
            l.Boxes.Add(new LayoutBox { Id = "quick", X = 9, Y = 4, W = 3, H = 6 });
            l.Boxes.Add(new LayoutBox { Id = "voicetrack", X = 9, Y = 10, W = 3, H = 6 });
            l.Boxes.Add(new LayoutBox { Id = "encoders", X = 9, Y = 16, W = 3, H = 5 });
            return l;
        }

        public StudioLayout Clone() => new StudioLayout { Boxes = Boxes.Select(b => b.Copy()).ToList() };

        public LayoutBox Get(string id) => Boxes.FirstOrDefault(b => b.Id == id);

        /// <summary>Unterste belegte Rasterzeile (Höhe des Bereichs).</summary>
        public int Rows => Boxes.Count == 0 ? 0 : Boxes.Max(b => b.Y + b.H);

        /// <summary>Feld an eine Rasterposition setzen (wird ins Raster begrenzt). Überlappte Felder rutschen nach unten. true = geändert.</summary>
        public bool Move(string id, int x, int y)
        {
            var b = Get(id);
            if (b == null) return false;
            x = Math.Max(0, Math.Min(Cols - b.W, x));
            y = Math.Max(0, y);
            if (x == b.X && y == b.Y) return false;
            b.X = x; b.Y = y;
            Push(b);
            return true;
        }

        /// <summary>Feldgröße ändern (Mindestgröße, nicht über den rechten Rand). Überlappte Felder rutschen nach unten. true = geändert.</summary>
        public bool Resize(string id, int w, int h)
        {
            var b = Get(id);
            if (b == null) return false;
            var min = Min.TryGetValue(id, out var m) ? m : (2, 2);
            w = Math.Max(min.Item1, Math.Min(Cols - b.X, w));
            h = Math.Max(min.Item2, Math.Min(60, h));
            if (w == b.W && h == b.H) return false;
            b.W = w; b.H = h;
            Push(b);
            return true;
        }

        /// <summary>Alles, was das Feld überlappt, direkt darunter schieben – und von dort aus weiter (nur nach unten, endet also sicher).</summary>
        void Push(LayoutBox mover)
        {
            foreach (var other in Boxes.Where(o => o != mover && o.Overlaps(mover)).OrderBy(o => o.Y).ToList())
            {
                other.Y = mover.Y + mover.H;
                Push(other);
            }
        }

        /// <summary>Für schmale Fenster: alle Felder untereinander in voller Breite, Reihenfolge von oben links nach unten rechts.</summary>
        public List<LayoutBox> Stacked()
        {
            var y = 0;
            var list = new List<LayoutBox>();
            foreach (var b in Boxes.OrderBy(b => b.Y).ThenBy(b => b.X))
            {
                list.Add(new LayoutBox { Id = b.Id, X = 0, Y = y, W = Cols, H = b.H });
                y += b.H;
            }
            return list;
        }

        /// <summary>Unbekannte/doppelte Felder entfernen, fehlende (z. B. nach einem Update neu) unten anhängen, Größen begrenzen, Überlappungen auflösen.</summary>
        public StudioLayout Normalize()
        {
            var seen = new HashSet<string>();
            Boxes = Boxes.Where(b => AllPanels.Contains(b.Id) && seen.Add(b.Id)).ToList();
            foreach (var b in Boxes)
            {
                var min = Min[b.Id];
                b.W = Math.Max(min.W, Math.Min(Cols, b.W));
                b.H = Math.Max(min.H, Math.Min(60, b.H));
                b.X = Math.Max(0, Math.Min(Cols - b.W, b.X));
                b.Y = Math.Max(0, Math.Min(500, b.Y));
            }
            if (Boxes.Count == 0) return Default();
            foreach (var id in AllPanels.Where(x => !seen.Contains(x)))
            {
                var d = Default().Get(id);
                Boxes.Add(new LayoutBox { Id = id, X = 0, Y = Rows, W = Math.Max(d.W, 4), H = d.H });
            }
            foreach (var b in Boxes.OrderBy(b => b.Y).ThenBy(b => b.X).ToList()) Push(b);
            return this;
        }

        /// <summary>Textform: „anmacha-studio-grid 1“, darunter je Feld „box id x y w h“.</summary>
        public string Serialize() =>
            string.Join("\n", new[] { "anmacha-studio-grid 1" }.Concat(Boxes.Select(b => "box " + b.Id + " " + b.X + " " + b.Y + " " + b.W + " " + b.H)));

        /// <summary>Gespeichertes Layout lesen; Unlesbares (auch das frühere Spalten-Format) ergibt das Standard-Layout.</summary>
        public static StudioLayout Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text) || !text.StartsWith("anmacha-studio-grid", StringComparison.Ordinal)) return Default();
            var l = new StudioLayout();
            foreach (var raw in text.Split('\n'))
            {
                var p = raw.Trim().Split(' ');
                if (p.Length == 6 && p[0] == "box" && int.TryParse(p[2], out var x) && int.TryParse(p[3], out var y) && int.TryParse(p[4], out var w) && int.TryParse(p[5], out var h))
                    l.Boxes.Add(new LayoutBox { Id = p[1], X = x, Y = y, W = w, H = h });
            }
            return l.Normalize();
        }
    }
}
