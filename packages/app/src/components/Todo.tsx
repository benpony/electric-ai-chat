import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Flex, Text, Button, IconButton, Checkbox, Dialog, Box, TextArea } from '@radix-ui/themes';
import { Trash2, SendHorizontal } from 'lucide-react';
import { useTodoList, useTodoItemsShape, TodoItem } from '../shapes';
import { createTodoItem, updateTodoItem, deleteTodoItem, deleteTodoList } from '../api';

const Todo = () => {
  const { listId } = useParams({ from: '/todo/$listId' });
  const navigate = useNavigate();
  const todoList = useTodoList(listId);
  const { data: todoItems } = useTodoItemsShape(listId);
  const [newTask, setNewTask] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const sortedItems = todoItems?.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim() || loading) return;

    setLoading(true);
    try {
      // Generate a timestamp-based order key since we need to provide one
      const orderKey = new Date().getTime().toString();

      // Create the todo item with the required orderKey parameter
      await createTodoItem(listId, newTask.trim(), orderKey);
      setNewTask('');

      // Focus back on input for quick entry of multiple items
      if (inputRef.current) {
        inputRef.current.focus();
      }
    } catch (error) {
      console.error('Failed to add todo item:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDone = async (item: TodoItem, checked: boolean) => {
    try {
      console.log(`Toggling item ${item.id} from ${item.done} to ${checked}`);
      const updatedItem = await updateTodoItem(item.id, { done: checked });
      console.log('Updated item:', updatedItem);
    } catch (error) {
      console.error('Failed to update todo item:', error);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      await deleteTodoItem(itemId);
    } catch (error) {
      console.error('Failed to delete todo item:', error);
    }
  };

  const handleDeleteList = async () => {
    try {
      await deleteTodoList(listId);
      navigate({ to: '/' });
    } catch (error) {
      console.error('Failed to delete list:', error);
    }
  };

  if (!todoList) {
    return (
      <Flex
        direction="column"
        p="4"
        gap="3"
        align="center"
        justify="center"
        style={{ height: '100%' }}
      >
        <Text size="5">List not found</Text>
        <Text color="gray" mb="4">
          The todo list you're looking for doesn't exist.
        </Text>
        <Button onClick={() => navigate({ to: '/' })}>Return Home</Button>
      </Flex>
    );
  }

  return (
    <Flex direction="column" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Flex
        justify="between"
        align="center"
        p="3"
        style={{
          borderBottom: '1px solid var(--border-color)',
          height: '56px',
        }}
      >
        <Text size="5" weight="medium">
          {todoList.name}
        </Text>
        <IconButton variant="ghost" color="red" onClick={() => setIsDeleteModalOpen(true)}>
          <Trash2 size={18} />
        </IconButton>
      </Flex>

      {/* List content */}
      <Flex
        direction="column"
        style={{
          flexGrow: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 16px',
          width: '100%',
        }}
      >
        {!sortedItems || sortedItems.length === 0 ? (
          <Flex
            align="center"
            justify="center"
            style={{
              height: '100%',
              color: 'var(--gray-9)',
              flexDirection: 'column',
              padding: '40px 20px',
              textAlign: 'center',
            }}
          >
            <Text size="3">This list is empty</Text>
            <Text size="2" color="gray" style={{ marginTop: '8px' }}>
              Add your first item using the form below
            </Text>
          </Flex>
        ) : (
          <Flex direction="column" gap="2" style={{ width: '100%' }}>
            {sortedItems.map(item => (
              <Flex
                key={item.id}
                p="2"
                gap="1"
                align="center"
                style={{
                  width: '100%',
                  minHeight: '32px',
                }}
              >
                <Checkbox
                  checked={item.done}
                  onCheckedChange={checked => {
                    if (typeof checked === 'boolean') {
                      handleToggleDone(item, checked);
                    }
                  }}
                  style={{ marginRight: '4px', flexShrink: 0 }}
                />
                <Text
                  size="1"
                  style={{
                    textDecoration: item.done ? 'line-through' : 'none',
                    color: item.done ? 'var(--gray-9)' : 'inherit',
                    flexGrow: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.task}
                </Text>
                <IconButton
                  variant="ghost"
                  color="gray"
                  onClick={() => handleDeleteItem(item.id)}
                  size="1"
                  style={{ opacity: 0.4, flexShrink: 0 }}
                  onMouseOver={e => (e.currentTarget.style.opacity = '0.8')}
                  onMouseOut={e => (e.currentTarget.style.opacity = '0.4')}
                >
                  <Trash2 size={12} />
                </IconButton>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>

      {/* Input form */}
      <Flex
        p="4"
        gap="2"
        align="center"
        style={{
          borderTop: '1px solid var(--border-color)',
          backgroundColor: 'var(--color-panel)',
        }}
      >
        <form onSubmit={handleAddItem} style={{ display: 'flex', width: '100%' }}>
          <Box style={{ position: 'relative', width: '100%' }}>
            <TextArea
              ref={inputRef}
              placeholder="Add a new task..."
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              disabled={loading}
              style={{
                resize: 'none',
                minHeight: '40px',
                paddingRight: '56px',
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (newTask.trim() && !loading) {
                    handleAddItem(e);
                  }
                }
              }}
            />
            <Box style={{ position: 'absolute', bottom: '10px', right: '10px', zIndex: 1 }}>
              <IconButton
                type="submit"
                disabled={loading || !newTask.trim()}
                variant="soft"
                size="2"
                radius="full"
              >
                <SendHorizontal size={16} />
              </IconButton>
            </Box>
          </Box>
        </form>
      </Flex>

      {/* Delete List Confirmation Dialog */}
      <Dialog.Root open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <Dialog.Content size="2" style={{ maxWidth: 450 }}>
          <Dialog.Title>Delete List</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            Are you sure you want to delete "{todoList.name}"? This action cannot be undone and all
            tasks will be lost.
          </Dialog.Description>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button color="red" onClick={handleDeleteList}>
              Delete List
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};

export default Todo;
