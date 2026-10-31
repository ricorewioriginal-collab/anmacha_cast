// Vorlagen für KI-Anbieter: lokale Server (eigener PC oder Server, ohne Key, offline) und Cloud-Anbieter mit eigener API.
// Eine Vorlage füllt nur das Formular vor – Adresse, Header und Key bleiben frei änderbar. Für alles, was hier fehlt,
// gibt es „Eigener Anbieter“ (Typ „OpenAI-kompatibel“ mit freier Adresse, eigenem Auth-Header, Zusatz-Headern und Query).

import type { TextKind, VoiceKind } from './providers.ts';

export interface ProviderPreset {
  id: string;
  label: string;
  role: 'text' | 'voice';
  kind: TextKind | VoiceKind;
  /** Läuft auf dem eigenen PC/Server (kein Key nötig, funktioniert offline) */
  local: boolean;
  /** Basis-URL; `{resource}`/`{deployment}` sind Platzhalter, die man selbst ersetzt */
  baseUrl?: string;
  needsKey: boolean;
  authHeader?: string;
  authScheme?: string;
  query?: string;
  /** Kurzer Hinweis für das Formular */
  hint: string;
  /** Für die Suche nach lokalen Servern: Port und Pfad der Modellliste */
  probe?: { port: number; path: string };
}

export const PRESETS: readonly ProviderPreset[] = [
  // ---------- Lokal: Text ----------
  { id: 'ollama', label: 'Ollama', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:11434/v1', needsKey: false, hint: 'Modell vorher mit „ollama pull <name>“ laden', probe: { port: 11434, path: '/v1/models' } },
  { id: 'lmstudio', label: 'LM Studio', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:1234/v1', needsKey: false, hint: 'In LM Studio unter „Developer“ den lokalen Server starten', probe: { port: 1234, path: '/v1/models' } },
  { id: 'llamacpp', label: 'llama.cpp-Server', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:8080/v1', needsKey: false, hint: 'llama-server -m modell.gguf --port 8080', probe: { port: 8080, path: '/v1/models' } },
  { id: 'vllm', label: 'vLLM', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:8000/v1', needsKey: false, hint: 'vllm serve <modell> (Standard-Port 8000)', probe: { port: 8000, path: '/v1/models' } },
  { id: 'jan', label: 'Jan', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:1337/v1', needsKey: false, hint: 'In Jan den „Local API Server“ einschalten', probe: { port: 1337, path: '/v1/models' } },
  { id: 'koboldcpp', label: 'KoboldCpp', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:5001/v1', needsKey: false, hint: 'Standard-Port 5001', probe: { port: 5001, path: '/v1/models' } },
  { id: 'textgen', label: 'text-generation-webui', role: 'text', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:5000/v1', needsKey: false, hint: 'Mit --api starten (Port 5000)', probe: { port: 5000, path: '/v1/models' } },
  // ---------- Lokal: Sprache ----------
  { id: 'kokoro', label: 'Kokoro-FastAPI', role: 'voice', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:8880/v1', needsKey: false, hint: 'Stimmen z. B. „af_heart“; Modell „kokoro“', probe: { port: 8880, path: '/v1/models' } },
  { id: 'openedai-speech', label: 'openedai-speech', role: 'voice', kind: 'openai_compat', local: true, baseUrl: 'http://localhost:8000/v1', needsKey: false, hint: 'OpenAI-kompatibles TTS (Piper/XTTS) im Docker-Container' },
  { id: 'piper', label: 'Piper (offline)', role: 'voice', kind: 'piper', local: true, needsKey: false, hint: 'Stimme = Pfad zur .onnx-Datei; Programmpfad unten oder „piper“ im PATH' },
  // ---------- Cloud: Text ----------
  { id: 'openai', label: 'OpenAI', role: 'text', kind: 'openai', local: false, needsKey: true, hint: 'Key unter platform.openai.com' },
  { id: 'anthropic', label: 'Anthropic (Claude)', role: 'text', kind: 'anthropic', local: false, needsKey: true, hint: 'Key unter console.anthropic.com' },
  { id: 'google', label: 'Google Gemini', role: 'text', kind: 'google', local: false, needsKey: true, hint: 'Key unter aistudio.google.com' },
  { id: 'openrouter', label: 'OpenRouter', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, hint: 'Viele Modelle über einen Key, z. B. „anthropic/claude-…“' },
  { id: 'mistral', label: 'Mistral AI', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.mistral.ai/v1', needsKey: true, hint: 'Europäischer Anbieter (Paris)' },
  { id: 'groq', label: 'Groq', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, hint: 'Sehr schnelle offene Modelle' },
  { id: 'deepseek', label: 'DeepSeek', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.deepseek.com', needsKey: true, hint: 'Modelle „deepseek-chat“, „deepseek-reasoner“' },
  { id: 'together', label: 'Together AI', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.together.ai/v1', needsKey: true, hint: 'Offene Modelle in der Cloud' },
  { id: 'fireworks', label: 'Fireworks AI', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.fireworks.ai/inference/v1', needsKey: true, hint: 'Offene Modelle in der Cloud' },
  { id: 'cerebras', label: 'Cerebras', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.cerebras.ai/v1', needsKey: true, hint: 'Sehr schnelle offene Modelle' },
  { id: 'xai', label: 'xAI (Grok)', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.x.ai/v1', needsKey: true, hint: 'Modelle „grok-…“' },
  { id: 'perplexity', label: 'Perplexity', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://api.perplexity.ai', needsKey: true, hint: 'Antworten mit Websuche (Modelle „sonar…“)' },
  {
    id: 'azure', label: 'Azure OpenAI', role: 'text', kind: 'openai_compat', local: false, baseUrl: 'https://{resource}.openai.azure.com/openai/deployments/{deployment}', needsKey: true,
    authHeader: 'api-key', authScheme: '', query: 'api-version=2024-10-21', hint: '{resource} und {deployment} durch eigene Namen ersetzen; Key aus dem Azure-Portal',
  },
  // ---------- Cloud: Sprache ----------
  { id: 'openai-tts', label: 'OpenAI (Sprache)', role: 'voice', kind: 'openai', local: false, needsKey: true, hint: 'Modell z. B. „gpt-4o-mini-tts“, Stimme „alloy“' },
  { id: 'elevenlabs', label: 'ElevenLabs', role: 'voice', kind: 'elevenlabs', local: false, needsKey: true, hint: 'Stimmen werden nach dem Speichern abgerufen' },
];

export function preset(id: string | undefined): ProviderPreset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined;
}
