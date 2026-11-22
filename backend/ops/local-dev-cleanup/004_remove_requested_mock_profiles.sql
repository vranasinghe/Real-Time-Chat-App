-- Remove the five original mock accounts that were removed from the demo UI.
-- Related rows follow the existing foreign-key delete rules.
DELETE FROM profiles
WHERE id IN ('seed-liana', 'seed-elena', 'seed-aria', 'seed-chloe', 'seed-sophia');
