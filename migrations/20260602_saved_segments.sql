-- Saved filter segments for the Spending Insights report.
-- Stores reusable filter combinations (spending tier, tags, tag mode, date range).

CREATE TABLE IF NOT EXISTS saved_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT 'spending_insights',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_segments_page ON saved_segments(page);

ALTER TABLE saved_segments ENABLE ROW LEVEL SECURITY;

-- Public browser access for the guest book MVP (mirrors existing tables).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'saved_segments'
      AND policyname = 'Public full access - saved_segments'
  ) THEN
    CREATE POLICY "Public full access - saved_segments"
      ON saved_segments FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
