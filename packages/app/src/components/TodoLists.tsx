import { useState } from 'react';
import { useNavigate, useMatchRoute } from '@tanstack/react-router';
import { Flex, Text, Button, Dialog, TextField } from '@radix-ui/themes';
import { useTodoListsShape } from '../shapes';
import { createTodoList } from '../api';
import { matchStream } from '@electric-sql/experimental';
import { v4 as uuidv4 } from 'uuid';

const TodoLists = () => {
  const navigate = useNavigate();
  const { data: todoLists, stream } = useTodoListsShape();
  const [newListName, setNewListName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Use TanStack Router to get current list ID
  const matchRoute = useMatchRoute();
  const todoMatch = matchRoute({ to: '/todo/$listId' });
  const currentListId = todoMatch ? todoMatch.listId : undefined;

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;

    setLoading(true);
    try {
      // Generate a UUID for the new list
      const listId = uuidv4();
      
      // Start watching for the list to sync BEFORE making the API call
      const matchPromise = matchStream(stream, ['insert'], message => {
        console.log('list id', message.value.id);
        return message.value.id === listId;
      });
      
      // Create the new list with the pre-generated UUID
      const newList = await createTodoList(newListName.trim(), listId);
      setNewListName('');
      setIsModalOpen(false);

      // Wait for the list to sync
      await matchPromise;
      console.log('Todo list synced');

      // Navigate to the new list
      navigate({ to: '/todo/$listId', params: { listId: newList.id } });
    } catch (error) {
      console.error('Failed to create todo list:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex direction="column" gap="2" my="2" style={{ borderTop: '1px solid var(--gray-5)' }}>
      <Flex direction="column" px="3" py="1">
        <Flex justify="between" py="3" align="center">
          <Text size="1" color="gray" weight="medium">
            TODO LISTS
          </Text>
          <Button variant="ghost" size="1" onClick={() => setIsModalOpen(true)}>
            + New
          </Button>
        </Flex>

        <Dialog.Root open={isModalOpen} onOpenChange={setIsModalOpen}>
          <Dialog.Content size="2" style={{ maxWidth: 400 }}>
            <Dialog.Title>Create New List</Dialog.Title>
            <Dialog.Description size="2" mb="4">
              Give your new to-do list a name.
            </Dialog.Description>

            <form onSubmit={handleCreateList}>
              <Flex direction="column" gap="3">
                <TextField.Root
                  placeholder="List name"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  disabled={loading}
                  autoFocus
                  style={{
                    resize: 'none',
                    minHeight: '40px',
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (newListName.trim() && !loading) {
                        handleCreateList(e);
                      }
                    }
                  }}
                />

                <Flex gap="3" mt="4" justify="end">
                  <Dialog.Close>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button type="submit" disabled={loading || !newListName.trim()}>
                    Create
                  </Button>
                </Flex>
              </Flex>
            </form>
          </Dialog.Content>
        </Dialog.Root>

        {todoLists.length === 0 ? (
          <Text size="1" color="gray" style={{ paddingLeft: '12px' }}>
            No lists yet
          </Text>
        ) : (
          todoLists.map(list => (
            <Button
              key={list.id}
              variant="ghost"
              color="gray"
              size="1"
              my="1"
              style={{
                justifyContent: 'flex-start',
                height: '22px',
                backgroundColor: list.id === currentListId ? 'var(--gray-5)' : undefined,
                overflow: 'hidden',
                color: 'var(--gray-12)',
              }}
              onClick={() => navigate({ to: '/todo/$listId', params: { listId: list.id } })}
            >
              <Text
                size="1"
                style={{
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {list.name}
              </Text>
            </Button>
          ))
        )}
      </Flex>
    </Flex>
  );
};

export default TodoLists;
