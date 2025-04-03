CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    name TEXT,
    pinned BOOLEAN DEFAULT FALSE
);

CREATE TYPE message_status AS ENUM ('pending', 'completed', 'failed', 'aborted');
CREATE TYPE message_role AS ENUM ('user', 'agent', 'system');

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    chat_id UUID REFERENCES chats(id),
    content TEXT,
    user_name TEXT,
    role message_role,
    status message_status,
    thinking_text TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tokens (
    message_id UUID REFERENCES messages(id),
    token_number INTEGER,
    token_text TEXT,
    PRIMARY KEY (message_id, token_number)
);

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY,
    chat_id UUID REFERENCES chats(id),
    path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT path_format CHECK (path !~ '^[/.]')
);

-- Todo list tables
CREATE TABLE IF NOT EXISTS todo_lists (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS todo_items (
    id UUID PRIMARY KEY,
    list_id UUID REFERENCES todo_lists(id) ON DELETE CASCADE,
    task TEXT NOT NULL,
    done BOOLEAN DEFAULT FALSE,
    order_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI action tracking table
CREATE TABLE IF NOT EXISTS ai_actions (
    id UUID PRIMARY KEY,
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS ai_actions_chat_id_idx ON ai_actions (chat_id);
CREATE INDEX IF NOT EXISTS ai_actions_entity_id_idx ON ai_actions (entity_id);
CREATE INDEX IF NOT EXISTS ai_actions_action_type_idx ON ai_actions (action_type);

-- Create index for reverse chronological order queries
CREATE INDEX IF NOT EXISTS ai_actions_created_at_idx ON ai_actions (created_at DESC);

-- User presence tracking table
CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY,
    chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    typing BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (chat_id, user_name)
);

-- Ensure typing field exists (for existing installations)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'user_presence' AND column_name = 'typing'
    ) THEN
        ALTER TABLE user_presence ADD COLUMN typing BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Index for efficient lookups by chat_id
CREATE INDEX IF NOT EXISTS user_presence_chat_id_idx ON user_presence (chat_id);
-- Index for efficient cleanup of stale presence records
CREATE INDEX IF NOT EXISTS user_presence_last_seen_idx ON user_presence (last_seen);
