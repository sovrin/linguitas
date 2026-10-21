// linguitas as a nexitas module: its schema, the read-only delivery API sites and build steps call,
// and what it says about a project. The owner's sign-in, the /api guard and the projects are the
// core's.
import type { NexitasModule } from '#nexitas/shared/modules'
import { formatCount, plural } from '#nexitas/app/lib/format'
import { readOnlyCors } from '#nexitas/server/utils/cors'
import { countProblems } from '../../shared/contracts'
import { deleteSpace, getSpace, isUnpublished, listKeys } from './translations'

export const linguitas: NexitasModule = {
  id: 'linguitas',
  migrations: [
    // A project's translations hold its read token, its source language and what was last
    // published; they own its languages, its keys, and a key its texts. Keys never change. A
    // language is live when the next publish delivers it; a removed one's texts stay, unseen.
    `CREATE TABLE translation_projects (
      project_id TEXT PRIMARY KEY REFERENCES projects(id), token TEXT NOT NULL,
      source TEXT NOT NULL, published TEXT, version INTEGER NOT NULL DEFAULT 0,
      published_at INTEGER, created_at INTEGER NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE translation_locales (
      project_id TEXT NOT NULL REFERENCES translation_projects(project_id) ON DELETE CASCADE,
      locale TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, locale)
    ) WITHOUT ROWID;
    CREATE TABLE translation_keys (
      project_id TEXT NOT NULL REFERENCES translation_projects(project_id) ON DELETE CASCADE,
      key TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key)
    ) WITHOUT ROWID;
    CREATE TABLE translation_texts (
      project_id TEXT NOT NULL, key TEXT NOT NULL, locale TEXT NOT NULL, text TEXT NOT NULL,
      based_on TEXT, updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, key, locale),
      FOREIGN KEY (project_id, key) REFERENCES translation_keys(project_id, key) ON DELETE CASCADE
    ) WITHOUT ROWID;`,
  ],
  // Read by sites, apps and build steps anywhere, with the project's token instead of a cookie.
  publicRoutes: [
    {
      path: /^\/v1\/translations\/([a-z0-9-]+)(?:\/[A-Za-z0-9-]+)?$/,
      json: true,
      guard: (event) => readOnlyCors(event, 'The translations API only reads.'),
    },
  ],
  // Everything linguitas serves; switched off, all of it answers 404.
  paths: ['/translations', '/api/translations', '/v1/translations'],
  // An imported language file can pass 64 kB.
  maxBody: 1024 * 1024,
  projectStatus: (db, projectId) => {
    const space = getSpace(db, projectId)
    if (!space) return []
    const keys = listKeys(db, projectId)
    const problems = countProblems(keys, space.live)
    return [
      { text: plural(keys.length, 'key'), to: `/p/${projectId}/translations` },
      ...(problems
        ? [{ text: `${formatCount(problems)} to check`, tone: 'warning' as const }]
        : []),
      ...(isUnpublished(db, projectId, space)
        ? [{ text: 'Changes not published', tone: 'warning' as const }]
        : []),
    ]
  },
  deleteProject: (db, projectId) => deleteSpace(db, projectId),
}
