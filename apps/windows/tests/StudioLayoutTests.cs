using System.Linq;
using AnMaChaCast.Logic;
using Xunit;

namespace AnMaChaCast.Tests
{
    public class StudioLayoutTests
    {
        static bool Overlapping(StudioLayout l) => l.Boxes.Any(a => l.Boxes.Any(b => a != b && a.Overlaps(b)));

        [Fact]
        public void StandardEnthaeltAlleFelderOhneUeberlappung()
        {
            var l = StudioLayout.Default();
            Assert.Equal(StudioLayout.AllPanels.OrderBy(x => x), l.Boxes.Select(b => b.Id).OrderBy(x => x));
            Assert.False(Overlapping(l));
            Assert.All(l.Boxes, b => Assert.True(b.X + b.W <= StudioLayout.Cols));
        }

        [Fact]
        public void FreiVerschiebenLueckenBleibenUeberlapptesRutschtNachUnten()
        {
            var l = StudioLayout.Default();
            Assert.True(l.Move("encoders", 0, 30)); // weit nach unten: Lücke bleibt, nichts springt zurück
            Assert.Equal((0, 30), (l.Get("encoders").X, l.Get("encoders").Y));
            Assert.True(l.Move("quick", 0, 0)); // auf die Cardwall: Cardwall und Archiv weichen nach unten aus
            Assert.Equal(0, l.Get("quick").Y);
            Assert.True(l.Get("carts").Y >= l.Get("quick").Y + l.Get("quick").H);
            Assert.False(Overlapping(l));
            Assert.False(l.Move("quick", 0, 0), "gleiche Stelle = keine Änderung");
        }

        [Fact]
        public void PositionBleibtImRaster()
        {
            var l = StudioLayout.Default();
            l.Move("automation", 50, -4);
            Assert.Equal(StudioLayout.Cols - l.Get("automation").W, l.Get("automation").X);
            Assert.Equal(0, l.Get("automation").Y);
        }

        [Fact]
        public void GroesseAendernMitMindestgroesseUndRand()
        {
            var l = StudioLayout.Default();
            Assert.True(l.Resize("carts", 1, 1));
            Assert.Equal(StudioLayout.Min["carts"], (l.Get("carts").W, l.Get("carts").H));
            l.Resize("automation", 20, 4); // steht bei x=9: höchstens bis zum rechten Rand
            Assert.Equal(StudioLayout.Cols - 9, l.Get("automation").W);
            Assert.True(l.Resize("queue", 4, 30)); // länger: nichts darunter in der Spalte, keine Überlappung
            Assert.False(Overlapping(l));
            Assert.True(l.Resize("carts", 9, 7)); // breiter über die Warteschlange: die weicht nach unten aus
            Assert.False(Overlapping(l));
        }

        [Fact]
        public void SchmalesFensterStapeltInLeserichtung()
        {
            var s = StudioLayout.Default().Stacked();
            Assert.Equal(new[] { "carts", "queue", "automation", "quick", "archive", "voicetrack", "encoders" }, s.Select(b => b.Id));
            Assert.All(s, b => Assert.Equal(StudioLayout.Cols, b.W));
            for (var i = 1; i < s.Count; i++) Assert.Equal(s[i - 1].Y + s[i - 1].H, s[i].Y);
        }

        [Fact]
        public void SpeichernUndLesenMitReparatur()
        {
            var l = StudioLayout.Default();
            l.Move("voicetrack", 0, 0);
            l.Resize("voicetrack", 6, 8);
            Assert.Equal(l.Serialize(), StudioLayout.Parse(l.Serialize()).Serialize());

            // unbekannte und doppelte Felder fallen weg, fehlende werden ergänzt, Überlappungen aufgelöst
            var repaired = StudioLayout.Parse("anmacha-studio-grid 1\nbox carts 0 0 5 7\nbox carts 3 3 3 3\nbox alt 0 0 2 2\nbox queue 2 2 99 1");
            Assert.Equal(StudioLayout.AllPanels.OrderBy(x => x), repaired.Boxes.Select(b => b.Id).OrderBy(x => x));
            Assert.False(Overlapping(repaired));
            Assert.Equal(StudioLayout.Cols, repaired.Get("queue").W);
            // Unsinn und das frühere Spalten-Format ergeben den Standard
            Assert.Equal(StudioLayout.Default().Serialize(), StudioLayout.Parse("Quatsch").Serialize());
            Assert.Equal(StudioLayout.Default().Serialize(), StudioLayout.Parse("anmacha-studio-layout 1\ncol 1\npanel carts 1").Serialize());
        }
    }
}
