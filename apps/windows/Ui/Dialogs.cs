// Einfache Eingabe- und Auswahlfenster (im Code gebaut, helles Standard-Aussehen).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AnMaChaCast.Ui
{
    enum Kind { Text, Password, Multiline, Check, Choice, Info }

    sealed class Field
    {
        public string Name;
        public string Label;
        public string Value = "";
        public Kind Kind = Kind.Text;
        /// <summary>Für Choice: Paare (Wert, Anzeige).</summary>
        public (string Id, string Label)[] Choices = new (string, string)[0];
        public string Hint;

        public static Field Text(string name, string label, string value = "", string hint = null) => new Field { Name = name, Label = label, Value = value, Hint = hint };
        public static Field Password(string name, string label, string hint = null) => new Field { Name = name, Label = label, Kind = Kind.Password, Hint = hint };
        public static Field Multi(string name, string label, string value = "") => new Field { Name = name, Label = label, Value = value, Kind = Kind.Multiline };
        public static Field Check(string name, string label, bool value) => new Field { Name = name, Label = label, Value = value ? "true" : "false", Kind = Kind.Check };
        public static Field Choice(string name, string label, string value, params (string, string)[] choices) => new Field { Name = name, Label = label, Value = value, Kind = Kind.Choice, Choices = choices };
        public static Field Info(string label, string text) => new Field { Label = label, Value = text, Kind = Kind.Info };
    }

    static class Dlg
    {
        static Window Make(Window owner, string title, double width)
        {
            var w = new Window
            {
                Title = title, Width = width, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false,
                Owner = owner != null && owner.IsVisible ? owner : null,
                WindowStartupLocation = owner != null && owner.IsVisible ? WindowStartupLocation.CenterOwner : WindowStartupLocation.CenterScreen,
                FontFamily = new System.Windows.Media.FontFamily("Segoe UI"), FontSize = 13,
            };
            if (Theme.Loaded) { w.Background = Kit.Bg2; w.Foreground = Kit.Fg; Theme.DarkTitle(w); }
            return w;
        }

        /// <summary>Formular anzeigen; null bei Abbruch, sonst Name → Wert (Häkchen als "true"/"false").</summary>
        public static Dictionary<string, string> Form(Window owner, string title, string ok, params Field[] fields)
        {
            var w = Make(owner, title, 480);
            var stack = new StackPanel { Margin = new Thickness(16) };
            var getters = new Dictionary<string, Func<string>>();
            foreach (var f in fields)
            {
                if (f.Kind != Kind.Check)
                    stack.Children.Add(new TextBlock { Text = f.Label, Margin = new Thickness(0, 8, 0, 3), FontWeight = f.Kind == Kind.Info ? FontWeights.Bold : FontWeights.Normal });
                switch (f.Kind)
                {
                    case Kind.Info:
                        stack.Children.Add(new TextBlock { Text = f.Value, TextWrapping = TextWrapping.Wrap, Foreground = Theme.Loaded ? Kit.Muted : System.Windows.Media.Brushes.DimGray });
                        break;
                    case Kind.Password:
                        {
                            var p = new PasswordBox { Padding = new Thickness(4) };
                            stack.Children.Add(p);
                            if (f.Name != null) getters[f.Name] = () => p.Password;
                            break;
                        }
                    case Kind.Multiline:
                        {
                            var t = new TextBox { Text = f.Value, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 90, MaxHeight = 220, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(4) };
                            stack.Children.Add(t);
                            getters[f.Name] = () => t.Text;
                            break;
                        }
                    case Kind.Check:
                        {
                            var c = new CheckBox { Content = f.Label, IsChecked = f.Value == "true", Margin = new Thickness(0, 8, 0, 0) };
                            stack.Children.Add(c);
                            getters[f.Name] = () => c.IsChecked == true ? "true" : "false";
                            break;
                        }
                    case Kind.Choice:
                        {
                            var cb = new ComboBox { Padding = new Thickness(4) };
                            foreach (var ch in f.Choices) cb.Items.Add(ch.Label);
                            var idx = Array.FindIndex(f.Choices, ch => ch.Id == f.Value);
                            cb.SelectedIndex = idx >= 0 ? idx : (f.Choices.Length > 0 ? 0 : -1);
                            stack.Children.Add(cb);
                            getters[f.Name] = () => cb.SelectedIndex >= 0 ? f.Choices[cb.SelectedIndex].Id : "";
                            break;
                        }
                    default:
                        {
                            var t = new TextBox { Text = f.Value, Padding = new Thickness(4) };
                            stack.Children.Add(t);
                            getters[f.Name] = () => t.Text;
                            break;
                        }
                }
                if (!string.IsNullOrEmpty(f.Hint) && f.Kind != Kind.Info)
                    stack.Children.Add(new TextBlock { Text = f.Hint, TextWrapping = TextWrapping.Wrap, FontSize = 11, Foreground = Theme.Loaded ? Kit.Muted : System.Windows.Media.Brushes.Gray, Margin = new Thickness(0, 2, 0, 0) });
            }
            var okBtn = new Button { Content = ok, IsDefault = true, MinWidth = 90, Padding = new Thickness(10, 5, 10, 5), Margin = new Thickness(0, 0, 8, 0) };
            Theme.Use(okBtn, "Btn.Primary");
            var cancel = new Button { Content = "Abbrechen", IsCancel = true, MinWidth = 90, Padding = new Thickness(10, 5, 10, 5) };
            Theme.Use(cancel, "Btn.Ghost");
            okBtn.Click += (s, e) => w.DialogResult = true;
            stack.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 16, 0, 0), Children = { okBtn, cancel } });
            w.Content = stack;
            return w.ShowDialog() == true ? getters.ToDictionary(kv => kv.Key, kv => kv.Value()) : null;
        }

        public static bool Confirm(Window owner, string text, string title = "AnMaCha Cast") =>
            MessageBox.Show(owner != null && owner.IsVisible ? owner : null, text, title, MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;

        public static void Info(Window owner, string text, string title = "AnMaCha Cast") =>
            MessageBox.Show(owner != null && owner.IsVisible ? owner : null, text, title, MessageBoxButton.OK, MessageBoxImage.Information);

        /// <summary>
        /// Fenster mit QR-Code (Kamera des Handys) und erklärendem Text. Bei mehreren Adressen (mehrere Netzwerkadapter)
        /// lässt sich die passende wählen; der QR-Code wird dann neu gezeichnet. Ohne Optionen erscheint nur der Text.
        /// </summary>
        public static void Qr(Window owner, string title, IList<(string Label, string Payload)> options, string text)
        {
            var w = Make(owner, title, 440);
            var stack = new StackPanel { Margin = new Thickness(18) };
            if (options != null && options.Count > 0)
            {
                var img = new System.Windows.Controls.Image { Width = 280, Height = 280, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 12) };
                RenderOptions.SetBitmapScalingMode(img, BitmapScalingMode.NearestNeighbor);
                Action<int> show = idx => img.Source = QrImage.Render(options[idx].Payload);
                if (options.Count > 1)
                {
                    stack.Children.Add(new TextBlock { Text = "Adresse des Servers (bei mehreren Netzwerkadaptern die im WLAN des Handys wählen):", TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 4) });
                    var box = new ComboBox { Margin = new Thickness(0, 0, 0, 10) };
                    foreach (var o in options) box.Items.Add(o.Label);
                    box.SelectionChanged += (s, e) => { if (box.SelectedIndex >= 0) show(box.SelectedIndex); };
                    stack.Children.Add(box);
                    box.SelectedIndex = 0;
                }
                else show(0);
                stack.Children.Add(img);
            }
            stack.Children.Add(new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap });
            var ok = new Button { Content = "Fertig", IsDefault = true, IsCancel = true, MinWidth = 90, Padding = new Thickness(10, 5, 10, 5), Margin = new Thickness(0, 14, 0, 0), HorizontalAlignment = HorizontalAlignment.Right };
            Theme.Use(ok, "Btn.Primary");
            ok.Click += (s, e) => w.Close();
            stack.Children.Add(ok);
            w.Content = stack;
            w.ShowDialog();
        }

        /// <summary>Auswahl aus einer Liste mit Suchfeld; liefert die Id oder null.</summary>
        public static string Pick(Window owner, string title, IList<(string Id, string Label)> items, string searchHint = "Suchen …")
        {
            var w = Make(owner, title, 520);
            w.SizeToContent = SizeToContent.Manual;
            w.Height = 480;
            w.ResizeMode = ResizeMode.CanResize;
            var search = new TextBox { Padding = new Thickness(5), Margin = new Thickness(0, 0, 0, 8), ToolTip = searchHint };
            var list = new ListBox { };
            Action fill = () =>
            {
                var q = search.Text.Trim().ToLowerInvariant();
                list.Items.Clear();
                foreach (var i in items.Where(x => q.Length == 0 || x.Label.ToLowerInvariant().Contains(q)).Take(500)) list.Items.Add(new ListBoxItem { Content = i.Label, Tag = i.Id });
                if (list.Items.Count > 0) list.SelectedIndex = 0;
            };
            search.TextChanged += (s, e) => fill();
            fill();
            string result = null;
            Action accept = () => { if (list.SelectedItem is ListBoxItem it) { result = (string)it.Tag; w.DialogResult = true; } };
            list.MouseDoubleClick += (s, e) => accept();
            var ok = new Button { Content = "Wählen", IsDefault = true, MinWidth = 90, Padding = new Thickness(10, 5, 10, 5), Margin = new Thickness(0, 0, 8, 0) };
            Theme.Use(ok, "Btn.Primary");
            ok.Click += (s, e) => accept();
            var cancel = new Button { Content = "Abbrechen", IsCancel = true, MinWidth = 90, Padding = new Thickness(10, 5, 10, 5) };
            Theme.Use(cancel, "Btn.Ghost");
            var grid = new Grid { Margin = new Thickness(14) };
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.Children.Add(search);
            Grid.SetRow(list, 1);
            grid.Children.Add(list);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 10, 0, 0), Children = { ok, cancel } };
            Grid.SetRow(buttons, 2);
            grid.Children.Add(buttons);
            w.Content = grid;
            w.Loaded += (s, e) => search.Focus();
            return w.ShowDialog() == true ? result : null;
        }
    }
}
