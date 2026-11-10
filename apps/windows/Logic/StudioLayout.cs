// Frei anordenbares Live-Studio (Windows): welche Felder (Cardwall, Archiv, Warteschlange, Automation, Schnellzugriff,
// Voicetrack, Encoder) in welcher Spalte und Reihenfolge stehen und wie breit/hoch sie sind. Oberflächenfrei und
// testbar; gespeichert je Gerät als kleine Textdatei (eine Zeile je Spalte bzw. Feld).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AnMaChaCast.Logic
{
    public sealed class LayoutPanel
    {
        public string Id = "";
        /// <summary>Höhenanteil innerhalb der Spalte (Stern-Gewicht).</summary>
        public double Weight = 1;
    }

    public sealed class LayoutColumn
    {
        /// <summary>Breitenanteil (Stern-Gewicht).</summary>
        public double Weight = 1;
        public List<LayoutPanel> Panels = new List<LayoutPanel>();
    }

    public sealed class StudioLayout
    {
        public const int MaxColumns = 4;

        /// <summary>Alle Felder des Live-Studios (unterhalb der Decks).</summary>
        public static readonly string[] AllPanels = { "carts", "archive", "queue", "automation", "quick", "voicetrack", "encoders" };

        public List<LayoutColumn> Columns = new List<LayoutColumn>();

        /// <summary>Standard wie bisher: Cardwall + Archiv | Warteschlange | Automation, Schnellzugriff, Voicetrack, Encoder.</summary>
        public static StudioLayout Default()
        {
            var l = new StudioLayout();
            l.Columns.Add(Col(1.15, ("carts", 1), ("archive", 1)));
            l.Columns.Add(Col(1, ("queue", 1)));
            l.Columns.Add(Col(0.62, ("automation", 0.7), ("quick", 0.9), ("voicetrack", 0.8), ("encoders", 1)));
            return l;
        }

        static LayoutColumn Col(double w, params (string Id, double W)[] panels) =>
            new LayoutColumn { Weight = w, Panels = panels.Select(p => new LayoutPanel { Id = p.Id, Weight = p.W }).ToList() };

        public StudioLayout Clone() => new StudioLayout
        {
            Columns = Columns.Select(c => new LayoutColumn { Weight = c.Weight, Panels = c.Panels.Select(p => new LayoutPanel { Id = p.Id, Weight = p.Weight }).ToList() }).ToList(),
        };

        public int ColumnOf(string id) => Columns.FindIndex(c => c.Panels.Any(p => p.Id == id));

        /// <summary>Feld vor oder hinter ein anderes Feld schieben (auch in eine andere Spalte). true = geändert.</summary>
        public bool Move(string id, string target, bool before)
        {
            if (id == target || ColumnOf(id) < 0 || ColumnOf(target) < 0) return false;
            var panel = Take(id);
            var tc = ColumnOf(target); // Take kann eine leer gewordene Spalte entfernt haben
            var idx = Columns[tc].Panels.FindIndex(p => p.Id == target);
            Put(panel, tc, before ? idx : idx + 1);
            return true;
        }

        /// <summary>Feld ans Ende einer Spalte setzen; column >= Columns.Count legt eine neue Spalte rechts an (bis MaxColumns).</summary>
        public bool MoveToColumn(string id, int column)
        {
            var from = ColumnOf(id);
            if (from < 0 || column < 0) return false;
            if (column >= Columns.Count)
            {
                // neue Spalte nur, wenn sie etwas bringt: Platz frei und das Feld lässt keine leere Spalte zurück
                if (Columns.Count >= MaxColumns || Columns[from].Panels.Count == 1) return false;
                var moved = Take(id);
                Columns.Add(new LayoutColumn { Weight = 0.8, Panels = { moved } });
                return true;
            }
            var targetCol = Columns[column];
            if (from == column && targetCol.Panels[targetCol.Panels.Count - 1].Id == id) return false;
            var panel = Take(id);
            Put(panel, Columns.IndexOf(targetCol), -1);
            return true;
        }

        LayoutPanel Take(string id)
        {
            var c = ColumnOf(id);
            if (c < 0) return null;
            var p = Columns[c].Panels.First(x => x.Id == id);
            Columns[c].Panels.Remove(p);
            if (Columns[c].Panels.Count == 0 && Columns.Count > 1) Columns.RemoveAt(c);
            return p;
        }

        void Put(LayoutPanel p, int column, int index)
        {
            var list = Columns[column].Panels;
            if (index < 0 || index > list.Count) list.Add(p); else list.Insert(index, p);
        }

        /// <summary>Für schmale Fenster: höchstens maxColumns Spalten, überzählige Felder kommen in die letzte sichtbare Spalte.</summary>
        public StudioLayout Fit(int maxColumns)
        {
            var l = Clone();
            maxColumns = Math.Max(1, maxColumns);
            while (l.Columns.Count > maxColumns)
            {
                var last = l.Columns[l.Columns.Count - 1];
                l.Columns.RemoveAt(l.Columns.Count - 1);
                l.Columns[l.Columns.Count - 1].Panels.AddRange(last.Panels);
            }
            return l;
        }

        /// <summary>Unbekannte Felder entfernen, fehlende (z. B. nach einem Update neu hinzugekommene) ergänzen, Gewichte begrenzen.</summary>
        public StudioLayout Normalize()
        {
            var seen = new HashSet<string>();
            foreach (var c in Columns)
            {
                c.Weight = Clamp(c.Weight, 0.2, 5);
                c.Panels = c.Panels.Where(p => AllPanels.Contains(p.Id) && seen.Add(p.Id)).ToList();
                foreach (var p in c.Panels) p.Weight = Clamp(p.Weight, 0.15, 6);
            }
            Columns = Columns.Where(c => c.Panels.Count > 0).Take(MaxColumns).ToList();
            if (Columns.Count == 0) return Default();
            var placed = new HashSet<string>(Columns.SelectMany(c => c.Panels).Select(p => p.Id));
            foreach (var id in AllPanels.Where(x => !placed.Contains(x))) Columns[Columns.Count - 1].Panels.Add(new LayoutPanel { Id = id, Weight = 0.8 });
            return this;
        }

        static double Clamp(double v, double lo, double hi) => double.IsNaN(v) || double.IsInfinity(v) ? 1 : Math.Max(lo, Math.Min(hi, v));

        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        /// <summary>Textform: „col 1.15“, darunter „panel carts 1“ … (eine Zeile je Spalte bzw. Feld).</summary>
        public string Serialize()
        {
            var lines = new List<string> { "anmacha-studio-layout 1" };
            foreach (var c in Columns)
            {
                lines.Add("col " + c.Weight.ToString("0.###", Inv));
                foreach (var p in c.Panels) lines.Add("panel " + p.Id + " " + p.Weight.ToString("0.###", Inv));
            }
            return string.Join("\n", lines);
        }

        /// <summary>Gespeichertes Layout lesen; Unlesbares ergibt das Standard-Layout.</summary>
        public static StudioLayout Parse(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return Default();
            var l = new StudioLayout();
            foreach (var raw in text.Split('\n'))
            {
                var parts = raw.Trim().Split(' ');
                if (parts[0] == "col" && parts.Length >= 2 && double.TryParse(parts[1], NumberStyles.Float, Inv, out var cw))
                    l.Columns.Add(new LayoutColumn { Weight = cw });
                else if (parts[0] == "panel" && parts.Length >= 3 && l.Columns.Count > 0 && double.TryParse(parts[2], NumberStyles.Float, Inv, out var pw))
                    l.Columns[l.Columns.Count - 1].Panels.Add(new LayoutPanel { Id = parts[1], Weight = pw });
            }
            return l.Normalize();
        }
    }
}
