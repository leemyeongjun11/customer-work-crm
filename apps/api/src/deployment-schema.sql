CREATE TABLE IF NOT EXISTS deployment_instances (
  instance_id uuid PRIMARY KEY, role text NOT NULL,
  revision text NOT NULL, source_tree text NOT NULL, release_id text NOT NULL,
  ready boolean NOT NULL, heartbeat_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS deployment_rate_limits (
  bucket_key text PRIMARY KEY, window_start bigint NOT NULL, hits integer NOT NULL
);
