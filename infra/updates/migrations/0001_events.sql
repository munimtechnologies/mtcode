-- One row per (day, kind, client, version). The primary key is the whole point:
-- it collapses a differential update's many range requests into one delivery,
-- and a client polling every four minutes into one poll per day.
CREATE TABLE IF NOT EXISTS events (
  day      TEXT NOT NULL,
  kind     TEXT NOT NULL,
  client   TEXT NOT NULL,
  version  TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (day, kind, client, version)
);

CREATE INDEX IF NOT EXISTS events_kind_day ON events (kind, day);
