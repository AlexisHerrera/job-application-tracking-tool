-- JSearch is gone as a source (round 5). Its saved searches go too; the postings it brought stay,
-- and discovery_runs.jsearch_requests stays (always 0 from now on).

DELETE FROM discovery_searches WHERE source = 'jsearch';
