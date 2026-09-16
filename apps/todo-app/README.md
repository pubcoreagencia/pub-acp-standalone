# Todo App (Lista de Tarefas)

Aplicação moderna e responsiva de Lista de Tarefas desenvolvida com HTML5, CSS3 e JavaScript Vanilla, com persistência de dados em `localStorage`.

## Funcionalidades

- **Adicionar tarefas:** Validação contra campos em branco com alerta visual amigável.
- **Concluir e desconcluir:** Marcação intuitiva com atualização instantânea de status e contadores.
- **Excluir tarefas:** Remoção ágil individual ou remoção em lote de tarefas concluídas.
- **Filtros de visualização:** Exibe "Todas", "Pendentes" e "Concluídas".
- **Persistência local:** Armazenamento automático no `localStorage` do navegador para manter dados após recarregar a página.
- **Design responsivo e acessível:** Otimizado tanto para uso em desktop quanto dispositivos móveis (smartphones/tablets), com suporte a navegação por teclado e atributos ARIA.

## Estrutura de Arquivos

```
apps/todo-app/
├── index.html     # Marcação semântica e acessível
├── styles.css     # Estilos modernos, variáveis CSS e regras responsivas
├── app.js         # Lógica vanilla JS e integração com localStorage
└── README.md      # Documentação da aplicação
```

## Como Executar Localmente

Você pode rodar um servidor HTTP local usando Python, Node.js ou qualquer servidor estático a partir da pasta `apps/todo-app`:

### Usando Python
```bash
python -m http.server 8080
```

### Usando Node.js (npx serve / http-server)
```bash
npx serve .
# ou
npx http-server -p 8080
```

Após iniciar o servidor, abra seu navegador em `http://localhost:8080`.
