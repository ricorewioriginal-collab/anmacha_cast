// Eine Cardwall-Kachel (src/core/automation.ts: CartSlot) im nativen Studio-Fenster.
// Dieser Meilenstein deckt nur das Auslösen ab – Bearbeiten (Beschriften, Medium zuweisen) bleibt
// vorerst im Web-Studio.
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Media;

namespace AnMaChaCast.ViewModels
{
    public sealed class CartViewModel : INotifyPropertyChanged
    {
        public string Id { get; }

        string label = "";
        public string Label { get => label; set => Set(ref label, value); }

        string mediaId;
        public string MediaId { get => mediaId; set { if (Set(ref mediaId, value)) OnPropertyChanged(nameof(HasMedia)); } }

        public bool HasMedia => !string.IsNullOrEmpty(MediaId);

        Brush color = Brushes.DimGray;
        public Brush Color { get => color; set => Set(ref color, value); }

        public CartViewModel(string id) { Id = id; }

        public event PropertyChangedEventHandler PropertyChanged;
        void OnPropertyChanged([CallerMemberName] string name = null) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        bool Set<T>(ref T field, T value, [CallerMemberName] string name = null)
        {
            if (Equals(field, value)) return false;
            field = value;
            OnPropertyChanged(name);
            return true;
        }
    }
}
