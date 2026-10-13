-- Supabase exposes every public-schema table through its REST Data API.
-- Enable RLS on all of them with no policies: the API roles (anon/authenticated) are denied,
-- while the Express server connects as the table owner, which bypasses RLS.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
