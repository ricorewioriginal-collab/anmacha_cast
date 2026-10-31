// KI-Dienst: Provider-Verwaltung (Keys verschlüsselt), Primär/Fallback, Kosten- und Budgetkontrolle.
// Preise werden NICHT vorgegeben – sie trägt der Betreiber pro Modell ein. Ohne Preis wird nur gezählt.

import { FileDocStore, type DocStore } from '../repo/docs.ts';
import { PRESETS, preset } from './presets.ts';
import { AiError, TEXT_KINDS, VOICE_KINDS, chat, listModels, listVoices, speak, transcribe, type ChatResult, type ProviderConfig, type SpeechResult, type TranscriptResult } from './providers.ts';

export interface Pricing {
  providerId: string;
  model: string;
  /** Preis je 1 Mio. Eingabe-Token */
  inPerM?: number;
  /** Preis je 1 Mio. Ausgabe-Token */
  outPerM?: number;
  /** Preis je 1 Mio. Zeichen (TTS) */
  perMChars?: number;
}

export interface Budget {
  /** Warnschwelle pro Monat */
  soft?: number;
  /** Harte Grenze pro Monat: darüber wird der Provider nicht mehr genutzt */
  hard?: number;
}

export interface AiSettings {
  providers: ProviderConfig[];
  pricing: Pricing[];
  budgets: { providers: Record<string, Budget>; stations: Record<string, Budget> };
  currency: string;
}

export interface UsageRow {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  chars: number;
  cost: number;
  errors: number;
}

export interface UsageEntry {
  at: number;
  stationId: string;
  providerId: string;
  model: string;
  kind: 'text' | 'voice';
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  chars: number;
  cost: number;
  ms: number;
  ok: boolean;
  error?: string;
}

interface UsageState {
  month: string;
  byProvider: Record<string, UsageRow>;
  byStation: Record<string, UsageRow>;
  previous?: { month: string; byProvider: Record<string, UsageRow>; byStation: Record<string, UsageRow> };
  recent: UsageEntry[];
}

export interface ProviderHealth {
  consecutiveFailures: number;
  lastError?: string;
  lastErrorAt?: number;
  /** Gesetzt, solange der Provider wegen wiederholter Fehler übersprungen wird (Fallback springt sofort weiter) */
  quarantinedUntil?: number;
}

/** Wartezeit je aufeinanderfolgendem Fehler ab der dritten Fehlschlagsserie (davor noch kein Quarantäne-Grund). */
const QUARANTINE_AFTER = 3;
const QUARANTINE_STEPS_MS = [2, 5, 15, 30, 60].map((m) => m * 60_000);

export interface TextTarget {
  providerId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface VoiceTarget {
  providerId: string;
  voice: string;
  model?: string;
  speed?: number;
}

const emptyRow = (): UsageRow => ({ calls: 0, inputTokens: 0, outputTokens: 0, chars: 0, cost: 0, errors: 0 });
const month = (d = new Date()) => d.toISOString().slice(0, 7);
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** Erlaubte Header-Namen für eigene Anbieter (keine Verbindungs-/Längen-/Cookie-Header) */
const HEADER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,59}$/;
const FORBIDDEN_HEADERS = new Set(['host', 'connection', 'content-length', 'content-type', 'transfer-encoding', 'cookie', 'set-cookie', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'expect']);

/** Header-Name prüfen; wirft bei ungültigen oder gesperrten Namen. */
function headerName(v: unknown, what: string): string {
  const n = String(v ?? '').trim();
  if (!HEADER_NAME.test(n) || FORBIDDEN_HEADERS.has(n.toLowerCase())) throw new AiError('invalid', `${what}: „${n}“ ist als Header-Name nicht erlaubt`);
  return n;
}

/** Zusätzliche Header eines eigenen Anbieters: höchstens 10, Werte ohne Zeilenumbruch, max. 500 Zeichen. */
export function cleanHeaders(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const entries: [string, string][] = typeof raw === 'string'
    ? raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf(':');
      if (i <= 0) throw new AiError('invalid', `Zusatz-Header „${l.slice(0, 40)}“: bitte als „Name: Wert“ angeben`);
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
    : typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]) : [];
  if (entries.length > 10) throw new AiError('invalid', 'Höchstens 10 Zusatz-Header');
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    const name = headerName(k, 'Zusatz-Header');
    if (/[\r\n\0]/.test(v) || v.length > 500) throw new AiError('invalid', `Zusatz-Header „${name}“: Wert zu lang oder mit Zeilenumbruch`);
    out[name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Query-Zusatz wie „api-version=2024-10-21&foo=bar“ (ohne „?“, ohne „#“, max. 300 Zeichen). */
export function cleanQuery(raw: unknown): string | undefined {
  const q = String(raw ?? '').trim().replace(/^\?/, '');
  if (!q) return undefined;
  if (q.length > 300 || /[#\s]/.test(q) || !/^[A-Za-z0-9._~%-]+=[^&]*(?:&[A-Za-z0-9._~%-]+=[^&]*)*$/.test(q)) throw new AiError('invalid', 'Query-Parameter bitte als „name=wert&name2=wert2“ angeben');
  return q;
}

type Fetch = typeof fetch;

export class AiService {
  private readonly docs: DocStore;
  private settings: AiSettings;
  private readonly usage: UsageState;
  private readonly health: Record<string, ProviderHealth>;
  private readonly getKey: (ref: string) => string | undefined;
  private readonly setKey: (ref: string, value: string | null) => void;
  private readonly log: (event: string, data: Record<string, unknown>) => void;
  private readonly softWarned = new Set<string>();
  fetchFn: Fetch;

  constructor(dataDir: string, keys: { get: (ref: string) => string | undefined; set: (ref: string, value: string | null) => void }, log: (event: string, data: Record<string, unknown>) => void, fetchFn: Fetch = fetch, docs: DocStore = new FileDocStore(dataDir)) {
    this.docs = docs;
    this.settings = { providers: [], pricing: [], budgets: { providers: {}, stations: {} }, currency: 'EUR', ...docs.get<Partial<AiSettings>>('ai', {}) };
    this.usage = { month: month(), byProvider: {}, byStation: {}, recent: [], ...docs.get<Partial<UsageState>>('ai-usage', {}) };
    docs.bind('ai-usage', () => this.usage);
    this.health = docs.get<Record<string, ProviderHealth>>('ai-health', {});
    docs.bind('ai-health', () => this.health);
    this.getKey = keys.get;
    this.setKey = keys.set;
    this.log = log;
    this.fetchFn = fetchFn;
  }

  flush(): void {
    this.docs.flushSync();
  }

  // ---------- Einstellungen ----------

  view(): unknown {
    return {
      ...this.settings,
      providers: this.settings.providers.map((p) => ({ ...p, hasKey: !!this.getKey(`ai:${p.id}`) })),
      kinds: { text: TEXT_KINDS, voice: VOICE_KINDS },
      presets: PRESETS,
    };
  }

  provider(id: string): ProviderConfig {
    const p = this.settings.providers.find((x) => x.id === id);
    if (!p) throw new AiError('unknown_provider', `KI-Provider „${id}“ nicht gefunden`);
    return p;
  }

  update(input: Record<string, any>): unknown {
    const next: AiSettings = structuredClone(this.settings);
    // Keys erst schreiben, wenn alles gültig ist (keine halben Änderungen)
    const keyOps: [string, string | null][] = [];
    if (Array.isArray(input.providers)) {
      const seen = new Set<string>();
      next.providers = input.providers.slice(0, 30).map((raw: Record<string, any>) => {
        const id = String(raw.id ?? '').trim().toLowerCase();
        if (!ID.test(id) || seen.has(id)) throw new AiError('invalid', `Ungültige oder doppelte Provider-ID „${id}“`);
        seen.add(id);
        const role = raw.role === 'voice' ? 'voice' : 'text';
        const kinds: readonly string[] = role === 'voice' ? VOICE_KINDS : TEXT_KINDS;
        if (!kinds.includes(raw.kind)) throw new AiError('invalid', `Typ „${raw.kind}“ passt nicht zu ${role === 'voice' ? 'Sprache' : 'Text'}`);
        const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '';
        if (baseUrl && !/^https?:\/\/[^\s{}]+$/.test(baseUrl)) throw new AiError('invalid', /[{}]/.test(baseUrl) ? 'Basis-URL: Platzhalter wie {resource} durch die eigenen Namen ersetzen' : 'Basis-URL muss mit http:// oder https:// beginnen');
        if (raw.kind === 'openai_compat' && !baseUrl) throw new AiError('invalid', 'Kompatibler Provider braucht eine Basis-URL (z. B. http://localhost:11434/v1)');
        const authHeader = typeof raw.authHeader === 'string' && raw.authHeader.trim() ? headerName(raw.authHeader, 'Key-Header') : undefined;
        const authScheme = typeof raw.authScheme === 'string' ? raw.authScheme.trim() : undefined;
        if (authScheme !== undefined && !/^[A-Za-z0-9._-]{0,20}$/.test(authScheme)) throw new AiError('invalid', 'Vorsatz vor dem Key: nur Buchstaben/Ziffern, z. B. „Bearer“ oder leer');
        const headers = cleanHeaders(raw.headers);
        const query = cleanQuery(raw.query);
        const pre = preset(typeof raw.preset === 'string' ? raw.preset : undefined);
        const local = typeof raw.local === 'boolean' ? raw.local : pre ? pre.local : raw.kind === 'piper' || /^https?:\/\/(localhost|127\.|\[::1\]|host\.docker\.internal)/.test(baseUrl);
        const p: ProviderConfig = {
          id, role, kind: raw.kind, name: String(raw.name ?? id).slice(0, 60), enabled: raw.enabled !== false,
          ...(baseUrl ? { baseUrl } : {}), ...(typeof raw.binPath === 'string' && raw.binPath.trim() ? { binPath: raw.binPath.trim() } : {}),
          ...(pre ? { preset: pre.id } : {}), ...(local ? { local: true } : {}),
          ...(authHeader ? { authHeader } : {}), ...(authScheme !== undefined && (authHeader || authScheme !== 'Bearer') ? { authScheme } : {}),
          ...(headers ? { headers } : {}), ...(query ? { query } : {}),
        };
        // Key: leer = unverändert, "-" = löschen
        if (typeof raw.key === 'string' && raw.key) keyOps.push([`ai:${id}`, raw.key === '-' ? null : raw.key.trim()]);
        return p;
      });
      for (const old of this.settings.providers) if (!seen.has(old.id)) keyOps.push([`ai:${old.id}`, null]);
    }
    if (Array.isArray(input.pricing)) {
      next.pricing = input.pricing.slice(0, 200).map((x: Record<string, unknown>) => {
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
        return { providerId: String(x.providerId ?? ''), model: String(x.model ?? ''), inPerM: num(x.inPerM), outPerM: num(x.outPerM), perMChars: num(x.perMChars) };
      }).filter((x: Pricing) => x.providerId && x.model);
    }
    if (input.budgets && typeof input.budgets === 'object') {
      const clean = (o: unknown) => Object.fromEntries(Object.entries((o ?? {}) as Record<string, Budget>).map(([k, b]) => [k, {
        soft: typeof b?.soft === 'number' && b.soft > 0 ? b.soft : undefined,
        hard: typeof b?.hard === 'number' && b.hard > 0 ? b.hard : undefined,
      }]));
      next.budgets = { providers: clean(input.budgets.providers), stations: clean(input.budgets.stations) };
    }
    if (typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency)) next.currency = input.currency;
    for (const [ref, v] of keyOps) this.setKey(ref, v);
    this.settings = next;
    this.docs.set('ai', next);
    return this.view();
  }

  // ---------- Kosten / Budget ----------

  cost(providerId: string, model: string, u: { inputTokens?: number; outputTokens?: number; chars?: number }): number {
    const p = this.settings.pricing.find((x) => x.providerId === providerId && (x.model === model || x.model === '*'));
    if (!p) return 0;
    return ((u.inputTokens ?? 0) * (p.inPerM ?? 0) + (u.outputTokens ?? 0) * (p.outPerM ?? 0) + (u.chars ?? 0) * (p.perMChars ?? 0)) / 1_000_000;
  }

  private rollMonth(): void {
    const m = month();
    if (this.usage.month === m) return;
    this.usage.previous = { month: this.usage.month, byProvider: this.usage.byProvider, byStation: this.usage.byStation };
    this.usage.month = m;
    this.usage.byProvider = {};
    this.usage.byStation = {};
    this.softWarned.clear();
  }

  /** 'hard' = gesperrt, 'soft' = Warnung, 'ok' */
  budgetState(providerId: string, stationId: string): 'ok' | 'soft' | 'hard' {
    this.rollMonth();
    const checks: [Budget | undefined, UsageRow | undefined, string][] = [
      [this.settings.budgets.providers[providerId], this.usage.byProvider[providerId], `provider:${providerId}`],
      [this.settings.budgets.stations[stationId], this.usage.byStation[stationId], `station:${stationId}`],
    ];
    let state: 'ok' | 'soft' | 'hard' = 'ok';
    for (const [b, row, key] of checks) {
      const spent = row?.cost ?? 0;
      if (b?.hard !== undefined && spent >= b.hard) return 'hard';
      if (b?.soft !== undefined && spent >= b.soft) {
        state = 'soft';
        if (!this.softWarned.has(key)) {
          this.softWarned.add(key);
          this.log('budget_soft', { scope: key, spent, soft: b.soft, currency: this.settings.currency });
        }
      }
    }
    return state;
  }

  private record(e: UsageEntry): void {
    this.rollMonth();
    for (const [map, key] of [[this.usage.byProvider, e.providerId], [this.usage.byStation, e.stationId]] as const) {
      const row = (map[key] ??= emptyRow());
      row.calls++;
      row.inputTokens += e.inputTokens;
      row.outputTokens += e.outputTokens;
      row.chars += e.chars;
      row.cost += e.cost;
      if (!e.ok) row.errors++;
    }
    this.usage.recent.unshift(e);
    if (this.usage.recent.length > 200) this.usage.recent.length = 200;
    this.docs.touch('ai-usage');
  }

  usageView(): unknown {
    this.rollMonth();
    return { ...this.usage, currency: this.settings.currency, budgets: this.settings.budgets };
  }

  // ---------- Gesundheit / Quarantäne ----------

  /** Nach wiederholten Fehlern in Folge wird ein Provider vorübergehend übersprungen, statt bei jedem
   *  Sendeereignis erneut die Timeout-Strecke abzuwarten. Ein einzelner Erfolg hebt die Sperre sofort auf. */
  private noteFailure(providerId: string, error: string): void {
    const h = (this.health[providerId] ??= { consecutiveFailures: 0 });
    h.consecutiveFailures++;
    h.lastError = error;
    h.lastErrorAt = Date.now();
    if (h.consecutiveFailures >= QUARANTINE_AFTER) {
      const step = Math.min(h.consecutiveFailures - QUARANTINE_AFTER, QUARANTINE_STEPS_MS.length - 1);
      h.quarantinedUntil = Date.now() + QUARANTINE_STEPS_MS[step]!;
      this.log('provider_quarantined', { providerId, untilMs: h.quarantinedUntil, consecutiveFailures: h.consecutiveFailures });
    }
    this.docs.touch('ai-health');
  }

  private noteSuccess(providerId: string): void {
    if (!this.health[providerId]) return;
    delete this.health[providerId];
    this.docs.touch('ai-health');
  }

  private quarantined(providerId: string): boolean {
    const h = this.health[providerId];
    return !!h?.quarantinedUntil && h.quarantinedUntil > Date.now();
  }

  /** Gesundheitsübersicht aller konfigurierten Provider für das Verwaltungs-Dashboard. */
  healthView(): { providerId: string; name: string; consecutiveFailures: number; lastError?: string; lastErrorAt?: number; quarantinedUntil?: number }[] {
    return this.settings.providers.map((p) => {
      const h = this.health[p.id];
      return { providerId: p.id, name: p.name, consecutiveFailures: h?.consecutiveFailures ?? 0, lastError: h?.lastError, lastErrorAt: h?.lastErrorAt, quarantinedUntil: h?.quarantinedUntil };
    });
  }

  /** Quarantäne/Fehlerzähler eines Providers manuell zurücksetzen (z. B. nach einem behobenen Problem). */
  releaseProvider(providerId: string): void {
    delete this.health[providerId];
    this.docs.touch('ai-health');
  }

  // ---------- Aufrufe mit Fallback ----------

  private usable(t: { providerId: string } | undefined, role: 'text' | 'voice'): ProviderConfig | null {
    if (!t?.providerId) return null;
    const p = this.settings.providers.find((x) => x.id === t.providerId);
    return p && p.enabled && p.role === role ? p : null;
  }

  /** Text erzeugen: Primär, bei Fehler/Budget der Fallback. Wirft, wenn beide scheitern. */
  async text(stationId: string, purpose: string, targets: (TextTarget | undefined)[], system: string, prompt: string, timeoutMs = 30_000): Promise<ChatResult & { providerId: string; model: string; cost: number }> {
    const errors: string[] = [];
    for (const t of targets) {
      const p = this.usable(t, 'text');
      if (!p || !t) continue;
      if (this.budgetState(p.id, stationId) === 'hard') {
        errors.push(`${p.name}: Budget ausgeschöpft`);
        continue;
      }
      if (this.quarantined(p.id)) {
        errors.push(`${p.name}: in Quarantäne nach wiederholten Fehlern`);
        continue;
      }
      const started = Date.now();
      try {
        const r = await chat(p, this.getKey(`ai:${p.id}`), { model: t.model, system, prompt, maxTokens: t.maxTokens ?? 600, temperature: t.temperature, timeoutMs }, this.fetchFn);
        const cost = this.cost(p.id, t.model, r);
        this.record({ at: started, stationId, providerId: p.id, model: t.model, kind: 'text', purpose, inputTokens: r.inputTokens, outputTokens: r.outputTokens, chars: 0, cost, ms: Date.now() - started, ok: true });
        this.noteSuccess(p.id);
        return { ...r, providerId: p.id, model: t.model, cost };
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${p.name}: ${msg}`);
        this.record({ at: started, stationId, providerId: p.id, model: t.model, kind: 'text', purpose, inputTokens: 0, outputTokens: 0, chars: 0, cost: 0, ms: Date.now() - started, ok: false, error: msg });
        this.noteFailure(p.id, msg);
      }
    }
    throw new AiError('all_failed', errors.length ? errors.join(' · ') : 'Kein Text-Provider konfiguriert');
  }

  async voice(stationId: string, purpose: string, targets: (VoiceTarget | undefined)[], text: string, timeoutMs = 60_000): Promise<SpeechResult & { providerId: string; cost: number }> {
    const errors: string[] = [];
    for (const t of targets) {
      const p = this.usable(t, 'voice');
      if (!p || !t) continue;
      if (this.budgetState(p.id, stationId) === 'hard') {
        errors.push(`${p.name}: Budget ausgeschöpft`);
        continue;
      }
      if (this.quarantined(p.id)) {
        errors.push(`${p.name}: in Quarantäne nach wiederholten Fehlern`);
        continue;
      }
      const started = Date.now();
      const model = t.model ?? '';
      try {
        const r = await speak(p, this.getKey(`ai:${p.id}`), { text, voice: t.voice, model: t.model, speed: t.speed, timeoutMs }, this.fetchFn);
        const cost = this.cost(p.id, model, { chars: r.chars });
        this.record({ at: started, stationId, providerId: p.id, model, kind: 'voice', purpose, inputTokens: 0, outputTokens: 0, chars: r.chars, cost, ms: Date.now() - started, ok: true });
        this.noteSuccess(p.id);
        return { ...r, providerId: p.id, cost };
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${p.name}: ${msg}`);
        this.record({ at: started, stationId, providerId: p.id, model, kind: 'voice', purpose, inputTokens: 0, outputTokens: 0, chars: 0, cost: 0, ms: Date.now() - started, ok: false, error: msg });
        this.noteFailure(p.id, msg);
      }
    }
    throw new AiError('all_failed', errors.length ? errors.join(' · ') : 'Kein Sprach-Provider konfiguriert');
  }

  /** Provider, die Audio transkribieren können (Whisper-Endpunkt): OpenAI oder OpenAI-kompatibel, egal welche Rolle. */
  transcribers(): ProviderConfig[] {
    return this.settings.providers.filter((p) => p.enabled && (p.kind === 'openai' || p.kind === 'openai_compat'));
  }

  async transcribe(stationId: string, audio: Buffer, filename: string, language?: string, timeoutMs = 300_000): Promise<TranscriptResult & { providerId: string }> {
    const errors: string[] = [];
    for (const p of this.transcribers()) {
      if (this.quarantined(p.id)) { errors.push(`${p.name}: in Quarantäne nach wiederholten Fehlern`); continue; }
      if (this.budgetState(p.id, stationId) === 'hard') { errors.push(`${p.name}: Monatsbudget ausgeschöpft`); continue; }
      const started = Date.now();
      try {
        const r = await transcribe(p, this.getKey(`ai:${p.id}`), audio, filename, { language, timeoutMs }, this.fetchFn);
        this.record({ at: started, stationId, providerId: p.id, model: 'whisper-1', kind: 'text', purpose: 'transcribe', inputTokens: 0, outputTokens: 0, chars: r.text.length, cost: 0, ms: Date.now() - started, ok: true });
        this.noteSuccess(p.id);
        return { ...r, providerId: p.id };
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${p.name}: ${msg}`);
        this.record({ at: started, stationId, providerId: p.id, model: 'whisper-1', kind: 'text', purpose: 'transcribe', inputTokens: 0, outputTokens: 0, chars: 0, cost: 0, ms: Date.now() - started, ok: false, error: msg });
        this.noteFailure(p.id, msg);
      }
    }
    throw new AiError('all_failed', errors.length ? errors.join(' · ') : 'Kein Transkriptions-Provider (OpenAI oder OpenAI-kompatibel mit Whisper) konfiguriert und kein lokales whisper gefunden');
  }

  models(id: string): Promise<string[]> {
    const p = this.provider(id);
    return listModels(p, this.getKey(`ai:${p.id}`), this.fetchFn);
  }

  voices(id: string): Promise<{ id: string; name: string }[]> {
    const p = this.provider(id);
    return listVoices(p, this.getKey(`ai:${p.id}`), this.fetchFn);
  }
}
