export interface TodoList {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface TodoItem {
  id: string;
  list_id: string;
  task: string;
  done: boolean;
  order_key: string;
  created_at: Date;
  updated_at: Date;
}
