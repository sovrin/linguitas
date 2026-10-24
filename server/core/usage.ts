// Which keys the sites use. Each site's build (a consumer) reports the keys its code asks for; a
// report replaces that consumer's last one. Nothing here is about visitors: builds report, browsers
// never do.
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from '#nexitas/server/core/database'
import type { Consumer, Report } from '../../shared/contracts'

/** How many consumers a project keeps: the report route is open to anyone with the build token,
 *  so a leaked one cannot fill the database with names. */
export const MAX_CONSUMERS = 50

/** Keeps a consumer's report: the version it built with and every key its code uses. Answers
 *  'full' for a new consumer once the project has MAX_CONSUMERS (and keeps nothing), else whether
 *  the report changed what is stored, its time aside. */
export function saveReport(
  db: DatabaseSync,
  projectId: string,
  report: Report,
  now = Date.now(),
): 'full' | 'changed' | 'unchanged' {
  return transaction(db, () => {
    const last = db
      .prepare(
        'SELECT version, sync FROM translation_consumers WHERE project_id = ? AND consumer = ?',
      )
      .get(projectId, report.consumer) as { version: number; sync: number } | undefined
    if (!last) {
      const { count } = db
        .prepare('SELECT count(*) AS count FROM translation_consumers WHERE project_id = ?')
        .get(projectId) as { count: number }
      if (count >= MAX_CONSUMERS) return 'full'
    }
    const stored = db
      .prepare(
        'SELECT key FROM translation_usage WHERE project_id = ? AND consumer = ? ORDER BY key',
      )
      .all(projectId, report.consumer) as unknown as { key: string }[]
    // Keys are ASCII, so JavaScript's sort orders them as SQLite does.
    const changed =
      !last ||
      last.version !== report.version ||
      last.sync !== report.sync ||
      stored.map((row) => row.key).join() !== [...new Set(report.keys)].sort().join()
    db.prepare(
      `INSERT INTO translation_consumers (project_id, consumer, version, sync, reported_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project_id, consumer) DO UPDATE
      SET version = excluded.version, sync = excluded.sync, reported_at = excluded.reported_at`,
    ).run(projectId, report.consumer, report.version, report.sync, now)
    if (!changed) return 'unchanged'
    db.prepare('DELETE FROM translation_usage WHERE project_id = ? AND consumer = ?').run(
      projectId,
      report.consumer,
    )
    const add = db.prepare(
      'INSERT OR IGNORE INTO translation_usage (project_id, consumer, key) VALUES (?, ?, ?)',
    )
    for (const key of report.keys) add.run(projectId, report.consumer, key)
    return 'changed'
  })
}

/** The project's consumers, the most recent report first, each with how many keys it asks for
 *  that do not exist. */
export function listConsumers(db: DatabaseSync, projectId: string): Consumer[] {
  return db
    .prepare(
      `SELECT c.consumer AS name, c.version, c.sync, c.reported_at AS reportedAt,
        (SELECT count(*) FROM translation_usage u WHERE u.project_id = c.project_id
          AND u.consumer = c.consumer AND u.key NOT IN
          (SELECT key FROM translation_keys k WHERE k.project_id = c.project_id)) AS missing
      FROM translation_consumers c WHERE c.project_id = ? ORDER BY c.reported_at DESC`,
    )
    .all(projectId) as unknown as Consumer[]
}

/** Every key a consumer uses, with the consumers that use it, keys that exist or not. */
export function listUsage(db: DatabaseSync, projectId: string) {
  const rows = db
    .prepare('SELECT key, consumer FROM translation_usage WHERE project_id = ? ORDER BY key')
    .all(projectId) as unknown as { key: string; consumer: string }[]
  const usage: Record<string, string[]> = {}
  for (const row of rows) (usage[row.key] ??= []).push(row.consumer)
  return usage
}

/** Forgets a consumer, say a site that is gone, so its keys no longer count as used. */
export function removeConsumer(db: DatabaseSync, projectId: string, consumer: string) {
  db.prepare('DELETE FROM translation_consumers WHERE project_id = ? AND consumer = ?').run(
    projectId,
    consumer,
  )
}
