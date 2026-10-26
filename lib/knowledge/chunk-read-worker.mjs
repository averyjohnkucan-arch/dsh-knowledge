// src/knowledge/chunk-read-worker.mjs
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
var db;
try {
  const { path, kind, baseIds, expectedModel } = workerData;
  db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=2000; BEGIN");
  let value;
  if (kind === "documents") {
    value = db.prepare("SELECT doc_id, SUM(embedding IS NULL OR (? IS NOT NULL AND (embedding_model IS NULL OR embedding_model != ?))) AS missing FROM chunk WHERE base_id = ? GROUP BY doc_id").all(expectedModel ?? null, expectedModel ?? null, baseIds[0]);
  } else {
    const placeholders = baseIds.map(() => "?").join(",");
    const count = baseIds.length ? db.prepare(`SELECT COUNT(*) AS c FROM chunk WHERE base_id IN (${placeholders})`).get(...baseIds).c : 0;
    value = { count, embedded: false, embeddedCount: 0, embeddingModelCounts: [] };
    if (count) {
      value.embeddedCount = db.prepare(`SELECT COUNT(*) AS c FROM chunk WHERE base_id IN (${placeholders}) AND embedding IS NOT NULL`).get(...baseIds).c;
      value.embedded = value.embeddedCount > 0;
      if (value.embedded) {
        const row = db.prepare(`SELECT length(embedding) AS bytes FROM chunk WHERE base_id IN (${placeholders}) AND embedding IS NOT NULL LIMIT 1`).get(...baseIds);
        if (row?.bytes > 0 && row.bytes % 4 === 0) value.dimensions = row.bytes / 4;
      }
      value.embeddingModelCounts = db.prepare(`SELECT base_id, embedding_model, COUNT(*) AS c FROM chunk WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL AND base_id IN (${placeholders}) GROUP BY base_id, embedding_model`).all(...baseIds).map((row) => ({ baseId: row.base_id, model: row.embedding_model, count: row.c }));
    }
  }
  if (kind === "stats" && baseIds.length) {
    const placeholders = baseIds.map(() => "?").join(",");
    const meta = db.prepare(`SELECT COUNT(*) AS documentCount,
      COALESCE(SUM(COALESCE(json_extract(header,'$.charCount'),0)),0) AS charCount,
      COALESCE(SUM(COALESCE(json_extract(header,'$.tokenCount'),0)),0) AS tokenCount,
      COALESCE(SUM(json_extract(header,'$.rawFilePath') IS NOT NULL OR json_extract(header,'$.processing') IS NOT NULL),0) AS storedDocCount
      FROM knowledge_document WHERE base_id IN (${placeholders})`).get(...baseIds);
    if (meta.documentCount || !value.count) value.documents = meta;
  }
  db.exec("COMMIT");
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error) });
} finally {
  db?.close();
}
//# sourceMappingURL=chunk-read-worker.mjs.map
