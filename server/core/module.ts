// linguitas as a nexitas module: its schema, the read-only delivery API sites and build steps call,
// and what it says about a project. The owner's sign-in, the /api guard and the projects are the
// core's.
import type { NexitasModule } from '#nexitas/shared/modules'
import { formatCount, plural } from '#nexitas/app/lib/format'
import { projectCors, readOnlyCors } from '#nexitas/server/utils/cors'
import { countProblems, missingKeys } from '../../shared/contracts'
import {
  deleteSpace,
  getSpace,
  isUnpublished,
  listKeys,
  listTranslationChanges,
} from './translations'
import { listConsumers } from './usage'

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
    // Every publish is kept as a version, so sites can cache a version's files forever and an
    // older one can be published again. A site's build reports which keys it uses (a consumer),
    // so the admin knows what no code asks for and what code asks for that does not exist.
    `CREATE TABLE translation_versions (
      project_id TEXT NOT NULL REFERENCES translation_projects(project_id) ON DELETE CASCADE,
      version INTEGER NOT NULL, texts TEXT NOT NULL, locales TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, version)
    ) WITHOUT ROWID;
    INSERT INTO translation_versions (project_id, version, texts, locales, published_at)
      SELECT project_id, version, published,
        (SELECT json_group_array(key) FROM json_each(published)), published_at
      FROM translation_projects WHERE published IS NOT NULL;
    CREATE TABLE translation_consumers (
      project_id TEXT NOT NULL REFERENCES translation_projects(project_id) ON DELETE CASCADE,
      consumer TEXT NOT NULL, version INTEGER NOT NULL, sync INTEGER NOT NULL,
      reported_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, consumer)
    ) WITHOUT ROWID;
    CREATE TABLE translation_usage (
      project_id TEXT NOT NULL, consumer TEXT NOT NULL, key TEXT NOT NULL,
      PRIMARY KEY (project_id, consumer, key),
      FOREIGN KEY (project_id, consumer)
        REFERENCES translation_consumers(project_id, consumer) ON DELETE CASCADE
    ) WITHOUT ROWID;`,
  ],
  publicRoutes: [
    // A site's build reports the keys it uses, with the build token. Servers send no Origin; a
    // page may only from the project's own origins, and needs the token all the same.
    {
      path: /^\/v1\/translations\/([a-z0-9-]+)\/report$/,
      json: true,
      maxBody: 1024 * 1024,
      guard: (event, match) =>
        projectCors(event, match?.[1], {
          methods: 'POST',
          refusal: 'This site may not report to these translations.',
          originless: true,
        }),
    },
    // Read by sites, apps and build steps anywhere: the manifest, a language, a version's files,
    // and the draft (with the build token). Published texts are open: every page has them.
    {
      path: /^\/v1\/translations\/([a-z0-9-]+)(?:\/[A-Za-z0-9-]+|\/(?:\d+|draft)\/(?:[A-Za-z0-9-]+\.json|keys\.d\.ts))?$/,
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
    // Keys a site's code uses that do not exist: its build fails until they do.
    const asked = listConsumers(db, projectId).reduce((sum, c) => sum + c.missing, 0)
    return [
      // The sidebar reads the keys, marked when texts need checking or changes wait to publish.
      {
        text: plural(keys.length, 'key'),
        to: `/p/${projectId}/translations`,
        figure: formatCount(keys.length),
      },
      ...(problems
        ? [{ text: `${plural(problems, 'key')} to check`, tone: 'warning' as const }]
        : []),
      ...(asked
        ? [{ text: `The code asks for ${missingKeys(asked)}`, tone: 'warning' as const }]
        : []),
      ...(isUnpublished(db, projectId, space)
        ? [{ text: 'Changes wait to be published', tone: 'warning' as const }]
        : []),
    ]
  },
  projectActivity: (db, projectId, since) => {
    const { published, keys } = listTranslationChanges(db, projectId, since)
    const to = `/p/${projectId}/translations`
    return [
      ...(published
        ? [{ at: published.published_at!, title: `Published version ${published.version}`, to }]
        : []),
      ...(keys.count && keys.at
        ? [{ at: keys.at, title: `${plural(keys.count, 'key')} changed`, to }]
        : []),
      ...listConsumers(db, projectId)
        .filter((consumer) => consumer.reportedAt > since && consumer.missing)
        .map((consumer) => ({
          at: consumer.reportedAt,
          title: `${consumer.name} asks for ${missingKeys(consumer.missing)}`,
          to,
        })),
    ]
  },
  deleteProject: (db, projectId) => deleteSpace(db, projectId),
}
