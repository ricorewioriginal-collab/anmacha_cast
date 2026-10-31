// Lokale KI-Server finden: fragt die bekannten Ports (Ollama, LM Studio, llama.cpp, vLLM, Jan, KoboldCpp,
// text-generation-webui, Kokoro) auf diesem PC/Server ab – und auf Wunsch auf einem weiteren Rechner im eigenen Netz.
// Gemeldet wird nur, was wirklich antwortet, mit den Modellen, die der Server selbst nennt.

import { PRESETS, type ProviderPreset } from './presets.ts';

export interface FoundServer {
  preset: string;
  label: string;
  role: 'text' | 'voice';
  baseUrl: string;
  host: string;
  port: number;
  models: string[];
}

/** Hostname, IPv4 oder IPv6 ohne Schema, Port oder Pfad. */
export const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9A-Fa-f:.]+\])$/;

type Fetch = typeof fetch;

async function probe(fetchFn: Fetch, host: string, p: ProviderPreset, timeoutMs: number): Promise<FoundServer | null> {
  if (!p.probe) return null;
  const origin = `http://${host}:${p.probe.port}`;
  try {
    const r = await fetchFn(origin + p.probe.path, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    if (!r.ok) {
      await r.body?.cancel().catch(() => undefined);
      return null;
    }
    const j = (await r.json().catch(() => null)) as { data?: { id?: string }[]; models?: { name?: string }[] } | null;
    // Nur echte OpenAI-kompatible Antworten zählen (eine beliebige Webseite auf dem Port ist kein KI-Server)
    const list = Array.isArray(j?.data) ? j!.data!.map((m) => String(m.id ?? '')) : Array.isArray(j?.models) ? j!.models!.map((m) => String(m.name ?? '')) : null;
    if (!list) return null;
    return { preset: p.id, label: p.label, role: p.role, baseUrl: `${origin}${p.probe.path.replace(/\/models$/, '')}`, host, port: p.probe.port, models: list.filter(Boolean).slice(0, 50) };
  } catch {
    return null;
  }
}

/**
 * Bekannte Ports auf den angegebenen Rechnern abfragen (parallel, kurze Wartezeit). Ein Port wird nur einmal je
 * Rechner gemeldet (llama.cpp und LocalAI teilen sich z. B. 8080).
 */
export async function discoverLocal(hosts: string[], opts: { timeoutMs?: number; fetchFn?: Fetch } = {}): Promise<FoundServer[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 1500;
  const presets = PRESETS.filter((p) => p.local && p.probe);
  const jobs: Promise<FoundServer | null>[] = [];
  for (const host of [...new Set(hosts)]) {
    const ports = new Set<number>();
    for (const p of presets) {
      if (ports.has(p.probe!.port)) continue;
      ports.add(p.probe!.port);
      jobs.push(probe(fetchFn, host, p, timeoutMs));
    }
  }
  return (await Promise.all(jobs)).filter((x): x is FoundServer => x !== null);
}
