using System.Linq;
using AnMaChaCast.Logic;
using Xunit;

namespace AnMaChaCast.Tests
{
    public class StudioLayoutTests
    {
        static string[] Ids(StudioLayout l, int col) => l.Columns[col].Panels.Select(p => p.Id).ToArray();

        [Fact]
        public void StandardEnthaeltAlleFelderGenauEinmal()
        {
            var all = StudioLayout.Default().Columns.SelectMany(c => c.Panels).Select(p => p.Id).ToList();
            Assert.Equal(StudioLayout.AllPanels.OrderBy(x => x), all.OrderBy(x => x));
        }

        [Fact]
        public void FeldVorOderHinterEinAnderesSchieben()
        {
            var l = StudioLayout.Default();
            Assert.True(l.Move("quick", "carts", true));
            Assert.Equal(new[] { "quick", "carts", "archive" }, Ids(l, 0));
            Assert.True(l.Move("carts", "queue", false));
            Assert.Equal(new[] { "queue", "carts" }, Ids(l, 1));
            Assert.False(l.Move("queue", "queue", true));
            Assert.False(l.Move("gibtsnicht", "queue", true));
        }

        [Fact]
        public void LeereSpalteVerschwindetUndNeueSpalteEntsteht()
        {
            var l = StudioLayout.Default();
            Assert.True(l.Move("queue", "archive", false)); // Warteschlange war allein in Spalte 2
            Assert.Equal(2, l.Columns.Count);
            Assert.Equal(new[] { "carts", "archive", "queue" }, Ids(l, 0));
            Assert.True(l.MoveToColumn("queue", l.Columns.Count)); // neue Spalte rechts
            Assert.Equal(3, l.Columns.Count);
            Assert.Equal(new[] { "queue" }, Ids(l, 2));
            Assert.False(l.MoveToColumn("queue", l.Columns.Count), "einziges Feld einer Spalte bringt keine neue Spalte");
            Assert.True(l.MoveToColumn("encoders", 0));
            Assert.Equal("encoders", Ids(l, 0).Last());
        }

        [Fact]
        public void HoechstensVierSpalten()
        {
            var l = StudioLayout.Default();
            Assert.True(l.MoveToColumn("encoders", 3));
            Assert.Equal(4, l.Columns.Count);
            Assert.False(l.MoveToColumn("quick", 4));
        }

        [Fact]
        public void SchmalesFensterLegtSpaltenZusammen()
        {
            var fit = StudioLayout.Default().Fit(2);
            Assert.Equal(2, fit.Columns.Count);
            Assert.Equal(new[] { "queue", "automation", "quick", "voicetrack", "encoders" }, Ids(fit, 1));
            Assert.Equal(3, StudioLayout.Default().Columns.Count); // Original bleibt unverändert
        }

        [Fact]
        public void SpeichernUndLesenMitReparatur()
        {
            var l = StudioLayout.Default();
            l.Move("voicetrack", "carts", true);
            l.Columns[0].Weight = 2.5;
            var back = StudioLayout.Parse(l.Serialize());
            Assert.Equal(l.Serialize(), back.Serialize());

            // unbekannte und doppelte Felder fallen weg, fehlende werden ergänzt, Unsinn ergibt den Standard
            var repaired = StudioLayout.Parse("col 1\npanel carts 1\npanel carts 2\npanel alt 1\ncol x\npanel queue 99");
            Assert.Equal(StudioLayout.AllPanels.OrderBy(x => x), repaired.Columns.SelectMany(c => c.Panels).Select(p => p.Id).OrderBy(x => x));
            Assert.Equal(6, repaired.Columns.SelectMany(c => c.Panels).Max(p => p.Weight));
            Assert.Equal(StudioLayout.Default().Serialize(), StudioLayout.Parse("Quatsch").Serialize());
            Assert.Equal(StudioLayout.Default().Serialize(), StudioLayout.Parse("").Serialize());
        }
    }
}
