// Tabelle (ListView mit Spalten) für alle Listen: Zeilen tragen die Anzeigewerte und das zugehörige JSON.
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Windows.Controls;
using System.Windows.Data;

namespace AnMaChaCast.Ui
{
    sealed class Row
    {
        public string[] Cells { get; }
        public JsonElement El { get; }
        public Row(JsonElement el, params string[] cells) { El = el; Cells = cells; }
    }

    sealed class Table : ListView
    {
        public Table(params (string Head, double Width)[] cols)
        {
            var grid = new GridView { AllowsColumnReorder = false };
            for (var i = 0; i < cols.Length; i++)
                grid.Columns.Add(new GridViewColumn { Header = Theme.Loaded ? cols[i].Head.ToUpperInvariant() : cols[i].Head, Width = cols[i].Width, DisplayMemberBinding = new Binding("Cells[" + i + "]") });
            View = grid;
            // Kopfzeile in Großbuchstaben, Zeilen mit feiner Trennlinie wie table.list im Web-Studio (Stile in Theme.xaml)
            if (!Theme.Loaded) { Background = Kit.PanelBg; Foreground = Kit.Fg; BorderBrush = Kit.Line; }
            SelectionMode = SelectionMode.Extended;
            MinHeight = 120;
        }

        public void Set(IEnumerable<Row> rows) => ItemsSource = rows.ToList();

        public Row One => SelectedItem as Row;

        public IEnumerable<Row> Many => SelectedItems.Cast<Row>();
    }
}
