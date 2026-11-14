-- AlterTable: add fields for broadcast-worker mode
ALTER TABLE "broadcast_history"
  ADD COLUMN "attachment_path"  TEXT,
  ADD COLUMN "attachment_mime"  TEXT,
  ADD COLUMN "target_group"     TEXT,
  ADD COLUMN "cancel_requested" BOOLEAN NOT NULL DEFAULT false;

-- Default status now 'pending' (вместо 'running'). Старые running остаются как есть.
ALTER TABLE "broadcast_history" ALTER COLUMN "status" SET DEFAULT 'pending';
