-- Cleanup utility for removing old chats selectively
-- This script provides various options for cleaning up chat data based on different criteria

BEGIN;

-- Option 1: Delete chats older than 30 days (except pinned ones)
-- Uncomment the lines below to use this option:

/*
DELETE FROM chats 
WHERE created_at < NOW() - INTERVAL '30 days'
  AND pinned = FALSE;
*/

-- Option 2: Delete chats older than 7 days with no messages in the last 7 days
-- This keeps active chats even if they're old
-- Uncomment the lines below to use this option:

/*
DELETE FROM chats 
WHERE id IN (
  SELECT c.id 
  FROM chats c
  WHERE c.created_at < NOW() - INTERVAL '7 days'
    AND c.pinned = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM messages m 
      WHERE m.chat_id = c.id 
        AND m.created_at > NOW() - INTERVAL '7 days'
    )
);
*/

-- Option 3: Delete empty chats (chats with no messages)
-- Uncomment the lines below to use this option:

/*
DELETE FROM chats 
WHERE id NOT IN (SELECT DISTINCT chat_id FROM messages WHERE chat_id IS NOT NULL);
*/

-- Option 4: Delete chats with only failed messages
-- This removes chats where all messages failed to complete
-- Uncomment the lines below to use this option:

/*
DELETE FROM chats 
WHERE id IN (
  SELECT c.id 
  FROM chats c
  WHERE EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM messages m 
      WHERE m.chat_id = c.id 
        AND m.status IN ('completed', 'pending')
    )
);
*/

-- Option 5: Clean up orphaned data (should not be needed with proper foreign keys)
-- This is a safety net to remove any orphaned records
-- Uncomment the lines below to use this option:

/*
-- Remove orphaned messages
DELETE FROM messages WHERE chat_id NOT IN (SELECT id FROM chats);

-- Remove orphaned files
DELETE FROM files WHERE chat_id NOT IN (SELECT id FROM chats);

-- Remove orphaned tokens
DELETE FROM tokens WHERE message_id NOT IN (SELECT id FROM messages);

-- Remove orphaned ai_actions
DELETE FROM ai_actions WHERE chat_id NOT IN (SELECT id FROM chats);

-- Remove orphaned user_presence
DELETE FROM user_presence WHERE chat_id NOT IN (SELECT id FROM chats);
*/

-- Show statistics about what would be cleaned up (run this first to preview)
-- Comment out the section you don't want to see:

-- Stats for chats older than 30 days (except pinned)
SELECT 
  'Chats older than 30 days (unpinned)' as cleanup_type,
  COUNT(*) as count_to_delete
FROM chats 
WHERE created_at < NOW() - INTERVAL '30 days'
  AND pinned = FALSE;

-- Stats for inactive old chats
SELECT 
  'Inactive chats (old with no recent messages)' as cleanup_type,
  COUNT(*) as count_to_delete
FROM chats c
WHERE c.created_at < NOW() - INTERVAL '7 days'
  AND c.pinned = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM messages m 
    WHERE m.chat_id = c.id 
      AND m.created_at > NOW() - INTERVAL '7 days'
  );

-- Stats for empty chats
SELECT 
  'Empty chats (no messages)' as cleanup_type,
  COUNT(*) as count_to_delete
FROM chats 
WHERE id NOT IN (SELECT DISTINCT chat_id FROM messages WHERE chat_id IS NOT NULL);

-- Stats for failed-only chats
SELECT 
  'Chats with only failed messages' as cleanup_type,
  COUNT(*) as count_to_delete
FROM chats c
WHERE EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = c.id)
  AND NOT EXISTS (
    SELECT 1 FROM messages m 
    WHERE m.chat_id = c.id 
      AND m.status IN ('completed', 'pending')
  );

COMMIT; 