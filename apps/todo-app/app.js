/**
 * Todo App - Vanilla JavaScript Implementation
 * Pub ACP Standalone
 */

// Chave do localStorage
const STORAGE_KEY = 'pub_acp_todo_items';

// Estado da Aplicação
let todos = [];
let currentFilter = 'all';

// Elementos do DOM
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const formError = document.getElementById('form-error');
const todoList = document.getElementById('todo-list');
const emptyState = document.getElementById('empty-state');
const statTotal = document.getElementById('stat-total');
const statCompleted = document.getElementById('stat-completed');
const statPending = document.getElementById('stat-pending');
const filterBtns = document.querySelectorAll('.filter-btn');
const clearCompletedBtn = document.getElementById('clear-completed-btn');

/**
 * Inicialização
 */
document.addEventListener('DOMContentLoaded', () => {
  loadTodos();
  setupEventListeners();
  render();
});

/**
 * Carrega tarefas do localStorage
 */
function loadTodos() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    todos = data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Falha ao carregar do localStorage', e);
    todos = [];
  }
}

/**
 * Persiste tarefas no localStorage
 */
function saveTodos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch (e) {
    console.error('Falha ao salvar no localStorage', e);
  }
}

/**
 * Registra ouvintes de evento
 */
function setupEventListeners() {
  todoForm.addEventListener('submit', handleAddTodo);
  todoInput.addEventListener('input', clearError);

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  clearCompletedBtn.addEventListener('click', handleClearCompleted);
}

/**
 * Exibe erro de validação
 */
function showError(message) {
  formError.textContent = message;
  formError.classList.add('visible');
  todoInput.focus();
}

/**
 * Limpa erro de validação
 */
function clearError() {
  formError.textContent = '';
  formError.classList.remove('visible');
}

/**
 * Adiciona uma nova tarefa
 */
function handleAddTodo(e) {
  e.preventDefault();
  const text = todoInput.value.trim();

  // Validação: Impedir tarefa vazia
  if (!text) {
    showError('Por favor, informe a descrição da tarefa.');
    return;
  }

  const newTodo = {
    id: 'todo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    text: text,
    completed: false,
    createdAt: new Date().toISOString()
  };

  todos.unshift(newTodo);
  saveTodos();
  todoInput.value = '';
  clearError();
  render();
}

/**
 * Alterna conclusão de tarefa
 */
function toggleTodo(id) {
  todos = todos.map(item => {
    if (item.id === id) {
      return { ...item, completed: !item.completed };
    }
    return item;
  });
  saveTodos();
  render();
}

/**
 * Exclui uma tarefa
 */
function deleteTodo(id) {
  todos = todos.filter(item => item.id !== id);
  saveTodos();
  render();
}

/**
 * Limpa todas as tarefas concluídas
 */
function handleClearCompleted() {
  const hasCompleted = todos.some(t => t.completed);
  if (!hasCompleted) return;

  todos = todos.filter(t => !t.completed);
  saveTodos();
  render();
}

/**
 * Filtra tarefas com base no filtro selecionado
 */
function getFilteredTodos() {
  if (currentFilter === 'pending') {
    return todos.filter(t => !t.completed);
  }
  if (currentFilter === 'completed') {
    return todos.filter(t => t.completed);
  }
  return todos;
}

/**
 * Atualiza estatísticas no DOM
 */
function updateStats() {
  const total = todos.length;
  const completed = todos.filter(t => t.completed).length;
  const pending = total - completed;

  statTotal.textContent = total;
  statCompleted.textContent = completed;
  statPending.textContent = pending;

  clearCompletedBtn.style.display = completed > 0 ? 'inline-flex' : 'none';
}

/**
 * Renderiza a lista de tarefas e interface
 */
function render() {
  updateStats();
  const filtered = getFilteredTodos();
  todoList.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.classList.add('visible');
  } else {
    emptyState.classList.remove('visible');

    filtered.forEach(todo => {
      const li = document.createElement('li');
      li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
      li.dataset.id = todo.id;

      const itemLeft = document.createElement('div');
      itemLeft.className = 'item-left';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'todo-checkbox';
      checkbox.checked = todo.completed;
      checkbox.setAttribute('aria-label', `Marcar "${todo.text}" como ${todo.completed ? 'pendente' : 'concluída'}`);
      checkbox.addEventListener('change', () => toggleTodo(todo.id));

      const spanText = document.createElement('span');
      spanText.className = 'todo-text';
      spanText.textContent = todo.text;

      itemLeft.appendChild(checkbox);
      itemLeft.appendChild(spanText);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'delete-btn btn-delete';
      deleteBtn.innerHTML = '&times;';
      deleteBtn.setAttribute('aria-label', `Excluir tarefa "${todo.text}"`);
      deleteBtn.title = 'Excluir tarefa';
      deleteBtn.addEventListener('click', () => deleteTodo(todo.id));

      li.appendChild(itemLeft);
      li.appendChild(deleteBtn);
      todoList.appendChild(li);
    });
  }
}

// Export para testes em ambiente Node/Puppeteer se necessário
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STORAGE_KEY,
    todos,
    handleAddTodo,
    toggleTodo,
    deleteTodo,
    handleClearCompleted
  };
}
