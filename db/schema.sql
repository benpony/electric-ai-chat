CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    name TEXT,
    pinned BOOLEAN DEFAULT FALSE
);

CREATE TYPE message_status AS ENUM ('pending', 'completed', 'failed', 'aborted');
CREATE TYPE message_role AS ENUM ('user', 'agent');

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    chat_id UUID REFERENCES chats(id),
    content TEXT,
    user_name TEXT,
    role message_role,
    status message_status
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
