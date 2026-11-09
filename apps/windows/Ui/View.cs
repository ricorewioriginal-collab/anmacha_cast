// Gemeinsame Grundlage der Seiten und der Verbindungskontext (aktiver Server, Sender, Ereignisse, Fehlerbehandlung).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using AnMaChaCast.Api;
using AnMaChaCast.Logic;

namespace AnMaChaCast.Ui
{
    /// <summary>Alles, was eine Seite vom Programm braucht. Wird bei Server- oder Senderwechsel aktualisiert.</summary>
    sealed class Ctx
    {
        public ApiClient Api;
        public string StationId = "";
        public List<StationInfo> Stations = new List<StationInfo>();
        public ServerProfile Server;
        public ServerStore Servers;
        public Window Owner;
        public Action<string, bool> Status = (t, bad) => { };
        public Func<Task> Reconnect = () => Task.CompletedTask;
        public Func<ServerProfile, Task> SwitchTo = p => Task.CompletedTask;
        public Func<string> EngineLog = () => "";

        public bool IsLocal => Server != null && Server.IsLocal;
        public bool Connected => Api != null;

        /// <summary>Pfad unterhalb des gewählten Senders, z. B. St("/queue").</summary>
        public string St(string tail) => "/stations/" + Uri.EscapeDataString(StationId) + tail;

        public string StationName => Stations.FirstOrDefault(s => s.id == StationId)?.name ?? StationId;

        /// <summary>Aktion ausführen; Fehler erscheinen lesbar in der Statuszeile statt das Programm zu stören.</summary>
        public async Task<bool> Run(Func<Task> action, string what = null)
        {
            try { await action(); return true; }
            catch (ApiException ex) { Status((what != null ? what + ": " : "") + ex.Message, true); }
            catch (Exception ex) when (!(ex is OutOfMemoryException)) { Status((what != null ? what + ": " : "") + ex.Message, true); }
            return false;
        }

        public void Ok(string text) => Status(text, false);
    }

    abstract class View : Grid
    {
        protected readonly Ctx C;
        protected View(Ctx c) { C = c; Margin = new Thickness(0); }

        public abstract string Title { get; }

        /// <summary>Beim Öffnen der Seite und nach Server-/Senderwechsel: Daten laden.</summary>
        public virtual Task Show() => Task.CompletedTask;

        /// <summary>Live-Ereignis vom Server (z. B. "queue.changed").</summary>
        public virtual void OnEvent(string type) { }

        protected bool Visible => IsVisible;
    }
}
