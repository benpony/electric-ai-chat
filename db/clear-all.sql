BEGIN;

-- Option 1: Clear all data but keep the schema structure
-- This is useful for development when you want to start fresh

-- Clear all chat-related data (cascades will handle related data)
DELETE FROM chats;

-- Clear all todo-related data
DELETE FROM todo_lists;

-- Clear any orphaned data (shouldn't exist with proper foreign keys, but just in case)
DELETE FROM messages WHERE chat_id NOT IN (SELECT id FROM chats);
DELETE FROM files WHERE chat_id NOT IN (SELECT id FROM chats);
DELETE FROM tokens WHERE message_id NOT IN (SELECT id FROM messages);
DELETE FROM ai_actions WHERE chat_id NOT IN (SELECT id FROM chats);
DELETE FROM user_presence WHERE chat_id NOT IN (SELECT id FROM chats);
DELETE FROM todo_items WHERE list_id NOT IN (SELECT id FROM todo_lists);

-- Reset any sequences/auto-incrementing fields if they exist
-- (Note: This schema uses UUIDs, so this is not needed, but left as reference)

COMMIT;

-- Note: If you want to completely drop and recreate the schema instead,
-- uncomment the lines below (DANGEROUS - will lose all data and structure):

/*
-- Option 2: Drop entire schema and recreate (DANGEROUS)
-- This is useful only if you need to completely reset the database structure
BEGIN;

-- Drop all objects in schema
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Recreate default grants
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Recreate extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

COMMIT;

-- After running this, you would need to run schema.sql again to recreate tables
*/