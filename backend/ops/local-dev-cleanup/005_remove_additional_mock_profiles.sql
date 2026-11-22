-- Remove the four additional mock accounts removed from the demo UI.
-- Related rows follow the existing foreign-key delete rules.
DELETE FROM profiles
WHERE id IN ('seed-marcus', 'seed-dev', 'seed-nina', 'seed-james');
