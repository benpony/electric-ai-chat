-- Migration script to add ON DELETE CASCADE to existing foreign key constraints
-- This fixes databases that were created before the schema.sql was updated

BEGIN;

-- Drop and recreate the messages foreign key constraint with CASCADE
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'messages_chat_id_fkey' 
        AND table_name = 'messages'
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT messages_chat_id_fkey;
        RAISE NOTICE 'Dropped existing messages_chat_id_fkey constraint';
    END IF;
    
    -- Add the constraint with ON DELETE CASCADE
    ALTER TABLE messages ADD CONSTRAINT messages_chat_id_fkey 
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added messages_chat_id_fkey constraint with ON DELETE CASCADE';
END $$;

-- Drop and recreate the tokens foreign key constraint with CASCADE
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'tokens_message_id_fkey' 
        AND table_name = 'tokens'
    ) THEN
        ALTER TABLE tokens DROP CONSTRAINT tokens_message_id_fkey;
        RAISE NOTICE 'Dropped existing tokens_message_id_fkey constraint';
    END IF;
    
    -- Add the constraint with ON DELETE CASCADE
    ALTER TABLE tokens ADD CONSTRAINT tokens_message_id_fkey 
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added tokens_message_id_fkey constraint with ON DELETE CASCADE';
END $$;

-- Drop and recreate the files foreign key constraint with CASCADE
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'files_chat_id_fkey' 
        AND table_name = 'files'
    ) THEN
        ALTER TABLE files DROP CONSTRAINT files_chat_id_fkey;
        RAISE NOTICE 'Dropped existing files_chat_id_fkey constraint';
    END IF;
    
    -- Add the constraint with ON DELETE CASCADE
    ALTER TABLE files ADD CONSTRAINT files_chat_id_fkey 
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added files_chat_id_fkey constraint with ON DELETE CASCADE';
END $$;

-- Drop and recreate the ai_actions foreign key constraint with CASCADE
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'ai_actions_chat_id_fkey' 
        AND table_name = 'ai_actions'
    ) THEN
        ALTER TABLE ai_actions DROP CONSTRAINT ai_actions_chat_id_fkey;
        RAISE NOTICE 'Dropped existing ai_actions_chat_id_fkey constraint';
    END IF;
    
    -- Add the constraint with ON DELETE CASCADE
    ALTER TABLE ai_actions ADD CONSTRAINT ai_actions_chat_id_fkey 
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added ai_actions_chat_id_fkey constraint with ON DELETE CASCADE';
END $$;

-- Drop and recreate the user_presence foreign key constraint with CASCADE
DO $$
BEGIN
    -- Drop existing constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'user_presence_chat_id_fkey' 
        AND table_name = 'user_presence'
    ) THEN
        ALTER TABLE user_presence DROP CONSTRAINT user_presence_chat_id_fkey;
        RAISE NOTICE 'Dropped existing user_presence_chat_id_fkey constraint';
    END IF;
    
    -- Add the constraint with ON DELETE CASCADE
    ALTER TABLE user_presence ADD CONSTRAINT user_presence_chat_id_fkey 
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added user_presence_chat_id_fkey constraint with ON DELETE CASCADE';
END $$;

-- Verify the constraints are now properly set up
SELECT 
    tc.table_name,
    tc.constraint_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc 
    ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name IN ('messages', 'tokens', 'files', 'ai_actions', 'user_presence')
    AND tc.constraint_type = 'FOREIGN KEY'
    AND rc.delete_rule = 'CASCADE'
ORDER BY tc.table_name, tc.constraint_name;

COMMIT; 