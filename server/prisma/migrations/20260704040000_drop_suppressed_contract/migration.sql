-- Suppression removed: the folder is the source of truth, so a deleted
-- contract is re-added by the sync if its source file is still present.
DROP TABLE IF EXISTS "SuppressedContract";
