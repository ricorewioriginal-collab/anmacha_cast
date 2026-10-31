// Kleiner, sicherer ZIP-Leser (nur Lesen): Central Directory auswerten, Einträge „stored“ (0) und „deflate“ (8) entpacken.
// Für die Web-Fassungen der Werkzeuge (Cast Tools). Schutz gegen Zip-Slip (absolute Pfade, „..“), gegen ZIP-Bomben
// (Obergrenzen für Eintragsanzahl und entpackte Gesamtgröße) und gegen kaputte Archive (Größen/CRC werden geprüft).

import { inflateRawSync, crc32 } from 'node:zlib';
import { posix } from 'node:path';

export interface ZipEntry {
  name: string;
  dir: boolean;
  data?: Buffer;
}

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/** Pfad eines Eintrags prüfen und normalisieren; null = unzulässig. */
export function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\0')) return null;
  const norm = posix.normalize(name);
  if (norm === '..' || norm.startsWith('../') || norm.includes('/../')) return null;
  return norm.replace(/^\.\//, '');
}

export function readZip(buf: Buffer, limits: { maxEntries?: number; maxTotal?: number } = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 5000;
  const maxTotal = limits.maxTotal ?? 512 * 1024 * 1024;
  // End of Central Directory: höchstens 64 KB Kommentar am Ende
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('Keine ZIP-Datei (Verzeichnis am Ende fehlt)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  let off = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || off === 0xffffffff || cdSize === 0xffffffff) throw new ZipError('ZIP64 wird nicht unterstützt');
  if (count > maxEntries) throw new ZipError(`Zu viele Einträge (${count})`);
  if (off + cdSize > buf.length) throw new ZipError('ZIP-Verzeichnis beschädigt');
  const out: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== CEN) throw new ZipError('ZIP-Verzeichnis beschädigt');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const xlen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const raw = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', off + 46, off + 46 + nlen);
    off += 46 + nlen + xlen + clen;
    const name = safeEntryName(raw);
    if (name === null) throw new ZipError(`Unzulässiger Pfad im Archiv: ${raw.slice(0, 80)}`);
    if (raw.endsWith('/')) { out.push({ name: name.replace(/\/$/, ''), dir: true }); continue; }
    if (flags & 0x1) throw new ZipError('Verschlüsselte ZIP-Einträge werden nicht unterstützt');
    total += usize;
    if (total > maxTotal) throw new ZipError('Archiv entpackt zu groß');
    if (buf.readUInt32LE(local) !== LOC) throw new ZipError('ZIP-Eintrag beschädigt');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const comp = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = inflateRawSync(comp, { maxOutputLength: Math.max(usize, 1) });
    else throw new ZipError(`Kompression ${method} wird nicht unterstützt`);
    if (data.length !== usize || (crc32(data) >>> 0) !== crc) throw new ZipError(`Prüfsumme falsch: ${name}`);
    out.push({ name, dir: false, data });
  }
  return out;
}
