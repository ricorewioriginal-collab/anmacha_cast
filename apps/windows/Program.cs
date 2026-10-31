// AnMaCha Cast für Windows: ein Programm, ein Fenster. Ein zweiter Start holt nur das vorhandene Fenster nach vorn.
//   AnMaChaCast.exe              Studio öffnen (startet die Engine bei Bedarf)
//   AnMaChaCast.exe --minimized  nur im Infobereich starten (Autostart bei der Anmeldung)
//   AnMaChaCast.exe --snapshot <Ordner>  jede Seite als PNG speichern und beenden (Build-Prüfung der Oberfläche)
// Das Hauptfenster (MainWindow) ist natives WPF; nur noch für Ansichten, die dort nicht nachgebaut sind,
// öffnet sich bei Bedarf ein eingebettetes WebView2-Fenster (BrowserForm).
using System;
using System.Threading;

namespace AnMaChaCast
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // AnMaChaCast.exe --quit: laufendes Fenster schließen, Engine weiterlaufen lassen (z. B. vor einem Update)
            if (Array.Exists(args, a => a.Equals("--quit", StringComparison.OrdinalIgnoreCase)))
            {
                if (EventWaitHandle.TryOpenExisting("AnMaChaCast.Studio.Quit", out var quit)) using (quit) quit.Set();
                return;
            }
            using (var mutex = new Mutex(true, "AnMaChaCast.Studio.Window", out var first))
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, "AnMaChaCast.Studio.Show"))
            {
                if (!first)
                {
                    show.Set();
                    return;
                }
                // WinForms-Steuerelemente (Tray-Symbol, WebView2-Fallback-Fenster) laufen innerhalb der
                // WPF-Anwendung mit; beide teilen sich denselben Windows-Nachrichtenzweig.
                System.Windows.Forms.Application.EnableVisualStyles();
                System.Windows.Forms.Application.SetCompatibleTextRenderingDefault(false);
                if (!Engine.Installed)
                {
                    System.Windows.Forms.MessageBox.Show("Die AnMaCha-Cast-Engine (anmachacast-engine.exe) fehlt im Programmordner. Bitte AnMaCha Cast neu installieren.", "AnMaCha Cast", System.Windows.Forms.MessageBoxButtons.OK, System.Windows.Forms.MessageBoxIcon.Error);
                    return;
                }
                var minimized = Array.Exists(args, a => a.Equals("--minimized", StringComparison.OrdinalIgnoreCase));
                var shot = Array.FindIndex(args, a => a.Equals("--snapshot", StringComparison.OrdinalIgnoreCase));
                var snapshot = shot >= 0 && shot + 1 < args.Length ? args[shot + 1] : null;
                if (snapshot != null) minimized = false;

                var app = new System.Windows.Application { ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown };
                // Optik des Web-Studios (Ui/Theme.xaml); schlägt das Laden fehl, läuft das Programm mit Windows-Standardoptik weiter
                AnMaChaCast.Ui.Theme.Apply(app);
                var window = new MainWindow(show, minimized, snapshot);
                if (!minimized) window.Show();
                Environment.ExitCode = app.Run();
                GC.KeepAlive(mutex);
            }
        }
    }
}
