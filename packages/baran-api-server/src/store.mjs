// Durable append-only store: records persist as JSON Lines, idempotent on
// content_hash — mirrors the mesh CRDT (records are superseded, never mutated).
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export class RecordStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.records = new Map();
    this.attestationsByReport = new Map();
    this.bridgeReceipts = new Map();
    this.seenHashes = new Set();
    this._load();
  }

  _index(rec) {
    this.records.set(rec.id, rec);
    if (rec.content_hash) this.seenHashes.add(rec.content_hash);
    if (rec.kind === 'attestation' && rec.target_report_id) {
      const list = this.attestationsByReport.get(rec.target_report_id) || [];
      list.push(rec);
      this.attestationsByReport.set(rec.target_report_id, list);
    }
  }

  _load() {
    if (!existsSync(this.filePath)) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, '');
      return;
    }
    const lines = readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry._kind === 'bridge_receipt') {
          this.bridgeReceipts.set(entry.target_id, entry.receipt);
        } else {
          this._index(entry);
        }
      } catch {
        /* skip corrupt line */
      }
    }
  }

  /** Returns false if a record with this content_hash was already stored. */
  append(record) {
    if (record.content_hash && this.seenHashes.has(record.content_hash)) return false;
    this._index(record);
    appendFileSync(this.filePath, JSON.stringify(record) + '\n');
    return true;
  }

  setBridgeReceipt(reportId, receipt) {
    this.bridgeReceipts.set(reportId, receipt);
    appendFileSync(this.filePath, JSON.stringify({ _kind: 'bridge_receipt', target_id: reportId, receipt }) + '\n');
  }

  get(id) {
    return this.records.get(id);
  }
  all() {
    return [...this.records.values()];
  }
  attestationsFor(reportId) {
    return this.attestationsByReport.get(reportId) || [];
  }
  bridgeReceiptFor(reportId) {
    return this.bridgeReceipts.get(reportId) || null;
  }
  get size() {
    return this.records.size;
  }
}
