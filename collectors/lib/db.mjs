// Postgres access for collectors. Uses DATABASE_URL (Supabase pooler connection string).
import postgres from 'postgres';

export function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // prepare: false — required by Supabase's transaction pooler.
  return postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 20 });
}

/** Records a collector run in poe.source_runs; returns a finisher. */
export async function startRun(sql, source, meta = {}) {
  const [row] = await sql`insert into poe.source_runs (source, meta) values (${source}, ${sql.json(meta)}) returning id`;
  return {
    id: row.id,
    async ok(rows, extra = {}) {
      await sql`update poe.source_runs set status = 'ok', finished_at = now(), rows_written = ${rows},
        meta = meta || ${sql.json(extra)} where id = ${row.id}`;
    },
    async fail(err) {
      await sql`update poe.source_runs set status = 'error', finished_at = now(), error = ${String(err?.stack || err).slice(0, 4000)}
        where id = ${row.id}`;
    },
  };
}
