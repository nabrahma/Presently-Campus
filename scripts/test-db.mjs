#!/usr/bin/env node
/*
  Runs the migrations and the database tests against a throwaway Postgres in
  Docker: `npm run test:db`.

  A fresh database is created for every run. The stub in supabase/tests
  stands in for the parts of Supabase the schema relies on (the auth schema,
  auth.uid() and the API roles), then every migration is applied in order,
  then every *.test.sql file. A test file fails by raising an exception.

  The container is left running so the next run starts quickly. Remove it
  with `docker rm -f presently-campus-test-db`.
*/
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTAINER = 'presently-campus-test-db'
const IMAGE = 'postgres:17-alpine'
const DATABASE = 'campus_test'
const root = fileURLToPath(new URL('..', import.meta.url))

function docker(args, input) {
  return spawnSync('docker', args, { input, encoding: 'utf8' })
}

function psql(sql, database = DATABASE) {
  return docker(
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-X'],
    sql
  )
}

function fail(message, detail = '') {
  console.error(`\n✗ ${message}`)
  if (detail) console.error(detail.trim())
  process.exit(1)
}

if (docker(['info']).status !== 0) fail('Docker is not running. Start it and try again.')

const running = docker(['inspect', '-f', '{{.State.Running}}', CONTAINER])
if (running.stdout.trim() !== 'true') {
  docker(['rm', '-f', CONTAINER])
  const started = docker(['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', IMAGE])
  if (started.status !== 0) fail('Could not start Postgres.', started.stderr)
}

for (let attempt = 0; ; attempt += 1) {
  const ready = docker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres'])
  // The image restarts Postgres once after initialising, so a single ready
  // answer can be followed by a refused connection. Ask for a real query.
  if (ready.status === 0 && psql('select 1', 'postgres').status === 0) break
  if (attempt > 60) fail('Postgres did not become ready.')
  await new Promise((resolve) => setTimeout(resolve, 500))
}

const reset = psql(`drop database if exists ${DATABASE} with (force); create database ${DATABASE};`, 'postgres')
if (reset.status !== 0) fail('Could not create the test database.', reset.stderr)

const sqlFiles = (dir, pattern) =>
  readdirSync(join(root, dir))
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => `${dir}/${name}`)

const steps = [
  'supabase/tests/supabase_stub.sql',
  ...sqlFiles('supabase/migrations', /\.sql$/),
  ...sqlFiles('supabase/tests', /\.test\.sql$/)
]

let failed = 0
for (const file of steps) {
  const result = psql(readFileSync(join(root, file), 'utf8'))
  const ok = result.status === 0
  console.log(`${ok ? '✓' : '✗'} ${file}`)
  if (!ok) {
    failed += 1
    console.error(result.stderr.trim().replace(/^/gm, '    '))
    // Later files depend on the schema the earlier ones built.
    if (!file.endsWith('.test.sql')) break
  }
}

if (failed > 0) fail(`${failed} database ${failed === 1 ? 'step' : 'steps'} failed.`)
console.log('\nDatabase tests passed.')
