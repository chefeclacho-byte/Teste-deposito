(() => {
  "use strict";

  const STORAGE_KEY = "gas_deposito_state_v1";
  const SESSION_KEY = "gas_deposito_authenticated";
  const UNDO_KEY = "gas_deposito_undo_stack_v1";
  const UNDO_LIMIT = 15;
  const API_BASE = `${window.location.origin}/api`;
  const DEFAULT_PIN_HASH = "1f47e3d4eb6a6c";
  const PROJECT_CREDIT = "Desenvolvido por Elionai Oliveira Costa Araújo";
  const PRODUCTS = [
    { id: "p13", label: "P13" },
    { id: "p45", label: "P45" },
    { id: "p20", label: "P20" },
    { id: "water", label: "Agua" }
  ];
  const NAV_ITEMS = [
    { id: "stock", label: "Estoque", icon: "E" },
    { id: "clients", label: "Clientes", icon: "C" },
    { id: "movement", label: "Entregas", icon: "E" },
    { id: "supply", label: "Abastecimento", icon: "A" },
    { id: "reports", label: "Relatorios", icon: "R" },
    { id: "settings", label: "Configuracoes", icon: "S" }
  ];
  const BUSINESS_KEYS = ["stock", "clients", "couriers", "movements", "stockSnapshots", "supplies", "emergencyBackup", "autoBackup"];

  const app = document.getElementById("app");
  let activeView = "stock";
  let clientSearch = "";
  let showAllMovements = false;
  let showRegisterForm = false;
  let showForgotPasswordForm = false;
  let reportMonth = getMonthInputValue(new Date());
  let toastTimer = null;
  let usingDatabase = false;
  let databasePath = "";
  let state = createDefaultState();
  let lastPersistedState = clone(state);

  document.addEventListener("submit", handleSubmit);
  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);

  bootstrap();

  function createDefaultState() {
    const businessData = createDefaultBusinessData();
    return {
      meta: {
        companyName: "Deposito de Gas",
        pinHash: DEFAULT_PIN_HASH,
        theme: "light",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      users: [
        {
          id: "default-admin",
          name: "Administrador",
          username: "admin",
          passwordHash: DEFAULT_PIN_HASH,
          role: "admin",
          createdAt: new Date().toISOString()
        }
      ],
      workspaces: {},
      ...businessData
    };
  }

  function createDefaultBusinessData() {
    return {
      stock: {
        general: { p13: 0, p45: 0, p20: 0, water: 0 },
        operational: {
          p13: { full: 0, empty: 0 },
          p45: { full: 0, empty: 0 },
          p20: { full: 0, empty: 0 },
          water: { full: 0, empty: 0 }
        },
        exchange: { total: 0 }
      },
      clients: [],
      couriers: ["Wender", "Wallace", "Jorge", "Bruno"],
      movements: [],
      stockSnapshots: [],
      supplies: [],
      emergencyBackup: null,
      autoBackup: null
    };
  }

  async function bootstrap() {
    renderLoading();
    state = await loadState();
    rememberPersistedState();
    render();
  }

  async function loadState() {
    const localState = loadLocalState();
    const apiState = await loadDatabaseState();
    if (apiState) {
      const localUpdatedAt = new Date(localState.meta.updatedAt || 0).getTime();
      const apiUpdatedAt = new Date(apiState.meta.updatedAt || 0).getTime();
      const localHasData = hasBusinessData(localState);
      const apiHasData = hasBusinessData(apiState);
      if (localHasData && (!apiHasData || localUpdatedAt > apiUpdatedAt)) {
        state = normalizeState(localState);
        await saveDatabaseState(state);
        return state;
      }
      return normalizeState(apiState);
    }
    return localState;
  }

  function loadLocalState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return normalizeState(saved || createDefaultState());
    } catch (error) {
      console.error(error);
      return createDefaultState();
    }
  }

  async function loadDatabaseState() {
    if (window.location.protocol === "file:") return null;
    try {
      const response = await fetch(`${API_BASE}/state`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Database unavailable");
      const payload = await response.json();
      usingDatabase = true;
      databasePath = payload.databasePath || "";
      return payload.state;
    } catch (error) {
      usingDatabase = false;
      databasePath = "";
      return null;
    }
  }

  function normalizeState(input) {
    const defaults = createDefaultState();
    const merged = {
      ...defaults,
      ...input,
      meta: { ...defaults.meta, ...(input && input.meta ? input.meta : {}) },
      stock: {
        ...defaults.stock,
        ...(input && input.stock ? input.stock : {}),
        general: { ...defaults.stock.general, ...(input && input.stock ? input.stock.general : {}) },
        operational: {
          p13: { ...defaults.stock.operational.p13, ...(input && input.stock && input.stock.operational ? input.stock.operational.p13 : {}) },
          p45: { ...defaults.stock.operational.p45, ...(input && input.stock && input.stock.operational ? input.stock.operational.p45 : {}) },
          p20: { ...defaults.stock.operational.p20, ...(input && input.stock && input.stock.operational ? input.stock.operational.p20 : {}) },
          water: { ...defaults.stock.operational.water, ...(input && input.stock && input.stock.operational ? input.stock.operational.water : {}) }
        },
        exchange: { ...defaults.stock.exchange, ...(input && input.stock ? input.stock.exchange : {}) }
      },
      clients: Array.isArray(input && input.clients) ? input.clients : defaults.clients,
      users: Array.isArray(input && input.users) && input.users.length ? input.users : [
        {
          ...defaults.users[0],
          passwordHash: input && input.meta && input.meta.pinHash ? input.meta.pinHash : defaults.users[0].passwordHash
        }
      ],
      workspaces: input && input.workspaces && typeof input.workspaces === "object" ? input.workspaces : {},
      couriers: Array.isArray(input && input.couriers) && input.couriers.length ? input.couriers : defaults.couriers,
      movements: Array.isArray(input && input.movements) ? input.movements : defaults.movements,
      stockSnapshots: Array.isArray(input && input.stockSnapshots) ? input.stockSnapshots : defaults.stockSnapshots,
      supplies: Array.isArray(input && input.supplies) ? input.supplies : defaults.supplies
    };

    merged.users = merged.users
      .filter((user) => user && user.username && user.passwordHash)
      .map((user) => ({
        id: user.id || createId(),
        name: sanitizeText(user.name || user.username),
        username: normalizeUsername(user.username),
        passwordHash: user.passwordHash,
        role: user.role || "operator",
        createdAt: user.createdAt || new Date().toISOString()
      }));
    if (!merged.users.length) {
      merged.users = defaults.users;
    }

    const hasExistingWorkspaces = Object.keys(merged.workspaces).length > 0;
    if (!hasExistingWorkspaces && hasBusinessData(merged)) {
      const owner = merged.users.find((user) => user.role === "admin") || merged.users[0];
      merged.workspaces[owner.username] = extractBusinessData(merged);
    }

    merged.users.forEach((user) => {
      merged.workspaces[user.username] = normalizeBusinessData(merged.workspaces[user.username] || createDefaultBusinessData());
    });

    const activeUsername = getSessionUsername() || (merged.users[0] && merged.users[0].username);
    applyBusinessData(merged, merged.workspaces[activeUsername] || createDefaultBusinessData());

    PRODUCTS.forEach((product) => {
      merged.stock.general[product.id] = toNonNegativeInt(merged.stock.general[product.id]);
      merged.stock.operational[product.id].full = toNonNegativeInt(merged.stock.operational[product.id].full);
      merged.stock.operational[product.id].empty = toNonNegativeInt(merged.stock.operational[product.id].empty);
    });
    merged.stock.exchange.total = toNonNegativeInt(merged.stock.exchange.total);
    return merged;
  }

  function persist(options = {}) {
    if (!options.skipUndo) {
      pushUndoSnapshot();
    }
    syncCurrentWorkspace();
    state.meta.updatedAt = new Date().toISOString();
    if (!options.skipAutoBackup) {
      state.autoBackup = buildBackup();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (usingDatabase) {
      saveDatabaseState(state).catch((error) => {
        usingDatabase = false;
        console.error(error);
        showToast("Banco indisponivel. Salvando temporariamente no navegador.", "error");
      });
    }
    rememberPersistedState();
  }

  async function saveDatabaseState(nextState) {
    const response = await fetch(`${API_BASE}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ state: nextState })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to save database state");
    usingDatabase = true;
    databasePath = payload.databasePath || databasePath;
    return payload;
  }

  function buildBackup() {
    return {
      createdAt: new Date().toISOString(),
      stock: clone(state.stock),
      users: clone(state.users),
      clients: clone(state.clients),
      couriers: clone(state.couriers),
      movements: clone(state.movements),
      stockSnapshots: clone(state.stockSnapshots),
      supplies: clone(state.supplies)
    };
  }

  function extractBusinessData(source) {
    return BUSINESS_KEYS.reduce((result, key) => {
      result[key] = clone(source[key]);
      return result;
    }, {});
  }

  function applyBusinessData(target, businessData) {
    BUSINESS_KEYS.forEach((key) => {
      target[key] = clone(businessData[key]);
    });
  }

  function normalizeBusinessData(input) {
    const defaults = createDefaultBusinessData();
    const data = {
      ...defaults,
      ...(input || {}),
      stock: {
        ...defaults.stock,
        ...(input && input.stock ? input.stock : {}),
        general: { ...defaults.stock.general, ...(input && input.stock ? input.stock.general : {}) },
        operational: {
          p13: { ...defaults.stock.operational.p13, ...(input && input.stock && input.stock.operational ? input.stock.operational.p13 : {}) },
          p45: { ...defaults.stock.operational.p45, ...(input && input.stock && input.stock.operational ? input.stock.operational.p45 : {}) },
          p20: { ...defaults.stock.operational.p20, ...(input && input.stock && input.stock.operational ? input.stock.operational.p20 : {}) },
          water: { ...defaults.stock.operational.water, ...(input && input.stock && input.stock.operational ? input.stock.operational.water : {}) }
        },
        exchange: { ...defaults.stock.exchange, ...(input && input.stock ? input.stock.exchange : {}) }
      },
      clients: Array.isArray(input && input.clients) ? input.clients : defaults.clients,
      couriers: Array.isArray(input && input.couriers) && input.couriers.length ? input.couriers : defaults.couriers,
      movements: Array.isArray(input && input.movements) ? input.movements : defaults.movements,
      stockSnapshots: Array.isArray(input && input.stockSnapshots) ? input.stockSnapshots : defaults.stockSnapshots,
      supplies: Array.isArray(input && input.supplies) ? input.supplies : defaults.supplies
    };
    PRODUCTS.forEach((product) => {
      data.stock.general[product.id] = toNonNegativeInt(data.stock.general[product.id]);
      data.stock.operational[product.id].full = toNonNegativeInt(data.stock.operational[product.id].full);
      data.stock.operational[product.id].empty = toNonNegativeInt(data.stock.operational[product.id].empty);
    });
    data.stock.exchange.total = toNonNegativeInt(data.stock.exchange.total);
    return data;
  }

  function syncCurrentWorkspace() {
    const username = getSessionUsername();
    if (!username) return;
    state.workspaces = state.workspaces || {};
    state.workspaces[username] = extractBusinessData(state);
  }

  function hasBusinessData(candidate) {
    if (!candidate || typeof candidate !== "object") return false;
    const hasStock = candidate.stock && PRODUCTS.some((product) => {
      const operational = candidate.stock.operational && candidate.stock.operational[product.id];
      const general = candidate.stock.general && candidate.stock.general[product.id];
      return toNonNegativeInt(general) > 0 || toNonNegativeInt(operational && operational.full) > 0 || toNonNegativeInt(operational && operational.empty) > 0;
    });
    return Boolean(
      hasStock ||
      (Array.isArray(candidate.clients) && candidate.clients.length > 0) ||
      (Array.isArray(candidate.movements) && candidate.movements.length > 0) ||
      (Array.isArray(candidate.supplies) && candidate.supplies.length > 0) ||
      (Array.isArray(candidate.stockSnapshots) && candidate.stockSnapshots.length > 0)
    );
  }

  function render() {
    if (sessionStorage.getItem(SESSION_KEY) !== "yes") {
      renderLogin();
      return;
    }
    renderDashboard();
  }

  function renderLoading() {
    app.className = "app-shell";
    app.innerHTML = `
      <main class="login-screen">
        <section class="login-brand" aria-label="Marca">
          <div class="brand-mark" aria-hidden="true">G</div>
          <h1>Deposito de Gas</h1>
          <p>Carregando dados do sistema.</p>
        </section>
      </main>
    `;
  }

  function renderLogin() {
    applyTheme();
    app.className = "app-shell";
    app.innerHTML = `
      <main class="login-screen">
        <section class="login-brand" aria-label="Marca">
          <div class="brand-mark" aria-hidden="true">G</div>
          <h1>${escapeHtml(state.meta.companyName)}</h1>
          <p>Controle de estoque, entregadores, abastecimento, vendas e backups em uma operacao local.</p>
          <span class="credit-line">${escapeHtml(PROJECT_CREDIT)}</span>
        </section>
        <section class="login-panel">
          <div class="login-card">
            <form data-action="login" autocomplete="off">
              <h2>Acesso ao sistema</h2>
              <p>Informe seu usuario e senha.</p>
              <div class="field">
                <label for="username">Usuario</label>
                <input id="username" name="username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required autofocus>
              </div>
              <div class="field">
                <label for="password">Senha</label>
                <input id="password" name="password" type="password" autocomplete="off" data-lpignore="true" data-1p-ignore="true" required>
              </div>
              <div class="actions login-actions">
                <button class="button" type="submit">Entrar</button>
                <button class="button ghost" data-action="toggle-forgot-password" type="button">Esqueci minha senha</button>
              </div>
            </form>
            ${showForgotPasswordForm ? `
              <div class="register-box">
                <form data-action="forgot-password" autocomplete="off">
                  <h2>Trocar senha</h2>
                  <p>Informe seu usuario e cadastre uma nova senha.</p>
                  <div class="field">
                    <label for="forgot-username">Usuario</label>
                    <input id="forgot-username" name="forgot-username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required>
                  </div>
                  <div class="field">
                    <label for="forgot-password">Nova senha</label>
                    <input id="forgot-password" name="forgot-password" type="password" autocomplete="off" data-lpignore="true" data-1p-ignore="true" required>
                  </div>
                  <div class="actions">
                    <button class="button secondary" type="submit">Salvar nova senha</button>
                    <button class="button ghost" data-action="toggle-forgot-password" type="button">Cancelar</button>
                  </div>
                </form>
              </div>
            ` : ""}
            <div class="register-box">
              ${showRegisterForm ? `
                <form data-action="register-user" autocomplete="off">
                  <h2>Registre-se</h2>
                  <p>Crie um acesso comum para operar o sistema.</p>
                  <div class="field">
                    <label for="register-name">Nome</label>
                    <input id="register-name" name="register-name" type="text" autocomplete="off" required>
                  </div>
                  <div class="field">
                    <label for="register-username">Usuario</label>
                    <input id="register-username" name="register-username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" required>
                  </div>
                  <div class="field">
                    <label for="register-password">Senha</label>
                    <input id="register-password" name="register-password" type="password" autocomplete="off" data-lpignore="true" data-1p-ignore="true" required>
                  </div>
                  <div class="actions">
                    <button class="button secondary" type="submit">Criar acesso</button>
                    <button class="button ghost" data-action="toggle-register" type="button">Cancelar</button>
                  </div>
                </form>
              ` : `
                <button class="button ghost register-toggle" data-action="toggle-register" type="button">Registrar</button>
              `}
            </div>
          </div>
        </section>
      </main>
    `;
  }

  function renderDashboard() {
    applyTheme();
    app.className = "app-shell dashboard";
    app.innerHTML = `
      <header class="topbar">
        <div>
          <h1>${escapeHtml(state.meta.companyName)}</h1>
          <p>${formatDateTime(new Date().toISOString())}</p>
        </div>
        <div class="actions">
          <span class="status-pill ${usingDatabase ? "online" : "offline"}">${usingDatabase ? "SQLite ativo" : "Modo navegador"}</span>
          <button class="button secondary" data-action="toggle-theme" type="button">${state.meta.theme === "dark" ? "Modo claro" : "Modo escuro"}</button>
          <button class="button secondary" data-action="undo-last-change" type="button">Desfazer</button>
          <button class="button secondary" data-action="export">Exportar backup</button>
          <button class="button danger" data-action="logout">Sair</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          <nav class="nav-list" aria-label="Navegacao principal">
            ${NAV_ITEMS.map((item) => `
              <button class="nav-button ${activeView === item.id ? "active" : ""}" data-view="${item.id}">
                <span class="nav-icon" aria-hidden="true">${item.icon}</span>
                <span>${item.label}</span>
              </button>
            `).join("")}
          </nav>
        </aside>
        <main class="main" id="main-content">
          ${renderActiveView()}
          <footer class="app-footer">${escapeHtml(PROJECT_CREDIT)}</footer>
        </main>
      </div>
    `;
  }

  function renderActiveView() {
    const views = {
      stock: renderStock,
      clients: renderClients,
      movement: renderMovement,
      supply: renderSupply,
      reports: renderReports,
      settings: renderSettings
    };
    return views[activeView]();
  }

  function renderStock() {
    const totalFull = PRODUCTS.reduce((sum, product) => sum + state.stock.operational[product.id].full, 0);
    const totalEmpty = PRODUCTS.reduce((sum, product) => sum + state.stock.operational[product.id].empty, 0);
    return `
      <section>
        <div class="section-header">
          <div>
            <h2>Estoque</h2>
            <p>Controle manual geral e estoque operacional movimentado pelas vendas e abastecimentos.</p>
          </div>
        </div>
        <div class="grid four">
          <div class="metric"><span>Cheios operacionais</span><strong>${totalFull}</strong></div>
          <div class="metric"><span>Vazios operacionais</span><strong>${totalEmpty}</strong></div>
          <div class="metric"><span>Trocas</span><strong>${state.stock.exchange.total}</strong></div>
          <div class="metric"><span>Snapshots salvos</span><strong>${state.stockSnapshots.length}</strong></div>
        </div>
        <div class="grid two" style="margin-top:16px">
          <form class="panel" data-action="save-general-stock">
            <h3>Estoque geral manual</h3>
            <div class="form-grid compact">
              ${PRODUCTS.map((product) => numberField(`general-${product.id}`, product.label, state.stock.general[product.id])).join("")}
            </div>
            <div class="actions" style="margin-top:14px">
              <button class="button" type="submit">Salvar geral</button>
            </div>
          </form>
          <form class="panel" data-action="save-operational-stock">
            <h3>Estoque operacional</h3>
            <div class="form-grid">
              ${PRODUCTS.map((product) => `
                <div class="panel" style="box-shadow:none;padding:12px">
                  <h3>${product.label}</h3>
                  ${numberField(`op-${product.id}-full`, "Cheios", state.stock.operational[product.id].full)}
                  ${numberField(`op-${product.id}-empty`, "Vazios", state.stock.operational[product.id].empty)}
                </div>
              `).join("")}
              ${numberField("exchange-total", "Trocas", state.stock.exchange.total)}
            </div>
            <div class="actions" style="margin-top:14px">
              <button class="button" type="submit">Salvar estoque completo</button>
            </div>
          </form>
        </div>
      </section>
    `;
  }

  function renderClients() {
    const filtered = state.clients.filter((client) => normalize(client.name).includes(normalize(clientSearch)));
    return `
      <section>
        <div class="section-header">
          <div>
            <h2>Clientes</h2>
            <p>Cadastro de contatos e enderecos de entrega.</p>
          </div>
        </div>
        <div class="grid two">
          <form class="panel" data-action="add-client">
            <h3>Novo cliente</h3>
            <div class="form-grid">
              ${textField("client-name", "Nome", "", "text", true)}
              ${textField("client-phone", "Telefone", "", "tel", true)}
              <div style="grid-column:1 / -1">${textField("client-address", "Endereco", "", "text", true)}</div>
            </div>
            <div class="actions" style="margin-top:14px">
              <button class="button" type="submit">Adicionar</button>
            </div>
          </form>
          <div class="panel">
            <h3>Busca</h3>
            ${textField("client-search", "Buscar cliente", clientSearch)}
            <p class="muted">${filtered.length} cliente(s) encontrado(s)</p>
          </div>
        </div>
        <div class="panel" style="margin-top:16px">
          <h3>Lista de clientes</h3>
          ${filtered.length ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Nome</th><th>Telefone</th><th>Endereco</th><th>Acoes</th></tr></thead>
                <tbody>
                  ${filtered.map((client) => `
                    <tr>
                      <td><input aria-label="Nome" value="${escapeAttr(client.name)}" data-client-field="name" data-id="${client.id}"></td>
                      <td><input aria-label="Telefone" value="${escapeAttr(client.phone)}" data-client-field="phone" data-id="${client.id}"></td>
                      <td><input aria-label="Endereco" value="${escapeAttr(client.address)}" data-client-field="address" data-id="${client.id}"></td>
                      <td><button class="button icon" title="Excluir" data-action="delete-client" data-id="${client.id}">X</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty">Nenhum cliente cadastrado.</div>`}
        </div>
      </section>
    `;
  }

  function renderMovement() {
    const sales = state.movements.filter((item) => !item.type || item.type === "sale");
    const openSales = sales.filter((item) => item.status === "open").slice().reverse();
    const closedSales = sales.filter((item) => item.status === "closed");
    const visibleClosedSales = showAllMovements ? closedSales : closedSales.slice(-40);
    const fullInRoute = openSales.reduce((total, item) => total + toNonNegativeInt(item.quantityOut), 0);
    const soldTotal = closedSales.reduce((total, item) => total + toNonNegativeInt(item.soldQuantity), 0);
    return `
      <section>
        <div class="section-header">
          <div>
            <h2>Entregas e acertos</h2>
            <p>Controle das saidas com entregadores e fechamento das vendas.</p>
          </div>
          <div class="actions">
            <button class="button secondary" data-action="toggle-movements">${showAllMovements ? "Ver recentes" : "Ver todo historico"}</button>
            <button class="button danger" data-action="clear-movements">Limpar vendas</button>
          </div>
        </div>
        <div class="grid four movement-summary">
          <div class="metric"><span>Acertos pendentes</span><strong>${openSales.length}</strong></div>
          <div class="metric"><span>Cheios em rota</span><strong>${fullInRoute}</strong></div>
          <div class="metric"><span>Vendas fechadas</span><strong>${closedSales.length}</strong></div>
          <div class="metric"><span>Total vendido</span><strong>${soldTotal}</strong></div>
        </div>
        <div class="grid two">
          <form class="panel" data-action="create-movement">
            <h3>Nova saida para entregador</h3>
            <div class="form-grid">
              ${selectField("movement-courier", "Entregador", state.couriers.map((name) => ({ value: name, label: name })))}
              ${selectField("movement-product", "Produto", PRODUCTS.map((product) => ({ value: product.id, label: product.label })))}
              ${numberField("movement-full", "Cheios que sairam", 1)}
              ${numberField("movement-empty", "Vazios recebidos na saida", 0)}
            </div>
            <div class="actions" style="margin-top:14px">
              <button class="button" type="submit">Salvar saida</button>
            </div>
          </form>
          <form class="panel" data-action="add-courier">
            <h3>Entregadores</h3>
            <div class="actions">
              <div class="field" style="flex:1;min-width:220px">
                <label for="courier-name">Nome</label>
                <input id="courier-name" name="courier-name" required>
              </div>
              <button class="button" type="submit">Adicionar</button>
            </div>
            <div class="grid" style="margin-top:14px">
              ${state.couriers.map((name, index) => `
                <div class="row-card">
                  <div class="row-card-header">
                    <strong>${escapeHtml(name)}</strong>
                    <button class="button icon" title="Excluir" data-action="delete-courier" data-index="${index}">X</button>
                  </div>
                </div>
              `).join("")}
            </div>
          </form>
        </div>
        <div class="panel movement-panel">
          <h3>Acertos pendentes</h3>
          <div class="grid">
            ${openSales.length ? openSales.map(renderMovementCard).join("") : `<div class="empty">Nenhum acerto pendente.</div>`}
          </div>
        </div>
        <div class="panel movement-panel">
          <h3>Vendas fechadas (${visibleClosedSales.length} de ${closedSales.length})</h3>
          <div class="grid">
            ${visibleClosedSales.length ? visibleClosedSales.slice().reverse().map(renderMovementCard).join("") : `<div class="empty">Nenhuma venda fechada.</div>`}
          </div>
        </div>
      </section>
    `;
  }

  function renderMovementCard(item) {
    const product = getProductLabel(item.productId);
    if (item.type === "supply") {
      return `
        <article class="row-card">
          <div class="row-card-header">
            <div><span class="badge supply">Abastecimento</span> <strong>${product}</strong></div>
            <button class="button icon" title="Excluir" data-action="delete-movement" data-id="${item.id}">X</button>
          </div>
          <span class="muted">Recebidos: ${item.received} cheios. Vazios enviados: ${item.sentEmpty}. ${formatDateTime(item.createdAt)}</span>
        </article>
      `;
    }
    if (item.status === "open") {
      const soldId = `sold-${item.id}`;
      return `
        <article class="row-card movement-card open">
          <div class="row-card-header">
            <div>
              <span class="badge open">Pendente</span>
              <strong>${escapeHtml(item.courier)}</strong>
              <div class="muted">${product} - ${formatDateTime(item.createdAt)}</div>
            </div>
            <button class="button icon" title="Excluir" data-action="delete-movement" data-id="${item.id}">X</button>
          </div>
          <div class="movement-details">
            <span><strong>${item.quantityOut}</strong> cheios sairam</span>
            <span><strong>${item.emptyDelivered}</strong> vazios recebidos</span>
          </div>
          <form class="settlement-form" data-action="close-movement" data-id="${item.id}">
            <div class="field">
              <label for="${soldId}">Gas vendidos</label>
              <input id="${soldId}" name="sold" type="number" min="0" max="${item.quantityOut}" value="0" data-quantity-out="${item.quantityOut}" required>
            </div>
            <div class="settlement-total">
              <span>Cheios voltam</span>
              <strong data-returned-preview="${item.id}">${item.quantityOut}</strong>
            </div>
            <button class="button" type="submit">Fechar acerto</button>
          </form>
        </article>
      `;
    }
    return `
      <article class="row-card movement-card">
        <div class="row-card-header">
          <div>
            <span class="badge">Fechado</span>
            <strong>${escapeHtml(item.courier)}</strong>
            <div class="muted">${product} - ${formatDateTime(item.closedAt)}</div>
          </div>
          <button class="button icon" title="Excluir" data-action="delete-movement" data-id="${item.id}">X</button>
        </div>
        <div class="movement-details">
          <span><strong>${item.quantityOut}</strong> sairam</span>
          <span><strong>${item.returnedQuantity}</strong> voltaram</span>
          <span><strong>${item.soldQuantity}</strong> vendidos</span>
        </div>
      </article>
    `;
  }

  function renderSupply() {
    return `
      <section>
        <div class="section-header">
          <div>
            <h2>Abastecimento</h2>
            <p>Entrada de cheios no deposito e envio de vazios ao fornecedor.</p>
          </div>
          <button class="button danger" data-action="clear-supplies">Apagar historico</button>
        </div>
        <form class="panel" data-action="create-supply">
          <h3>Registrar abastecimento</h3>
          <div class="form-grid">
            ${PRODUCTS.map((product) => `
              <div class="panel" style="box-shadow:none;padding:12px">
                <h3>${product.label}</h3>
                ${numberField(`supply-${product.id}-received`, "Cheios recebidos", 0)}
                ${numberField(`supply-${product.id}-sent`, "Vazios enviados", 0)}
              </div>
            `).join("")}
          </div>
          <div class="actions" style="margin-top:14px">
            <button class="button" type="submit">Confirmar abastecimento</button>
          </div>
        </form>
        <div class="panel" style="margin-top:16px">
          <h3>Historico de abastecimento</h3>
          <div class="grid">
            ${state.supplies.length ? state.supplies.slice().reverse().map((item) => `
              <article class="row-card">
                <div class="row-card-header">
                  <strong>${getProductLabel(item.productId)}</strong>
                  <button class="button icon" title="Excluir" data-action="delete-supply" data-id="${item.id}">X</button>
                </div>
                <span class="muted">+${item.received} cheios, -${item.sentEmpty} vazios. ${formatDateTime(item.createdAt)}</span>
              </article>
            `).join("") : `<div class="empty">Nenhum abastecimento registrado.</div>`}
          </div>
        </div>
      </section>
    `;
  }

  function renderReports() {
    const selectedMonth = parseMonthInput(reportMonth);
    const monthlyTotals = calculateCourierTotals({ month: selectedMonth });
    const overallTotals = calculateCourierTotals();
    const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(selectedMonth);
    return `
      <section>
        <div class="section-header">
          <div>
            <h2>Relatorios</h2>
            <p>Resumo de vendas e historico de salvamentos de estoque.</p>
          </div>
          <div class="actions">
            <div class="field">
              <label for="report-month">Mes do relatorio</label>
              <input id="report-month" type="month" value="${escapeAttr(reportMonth)}">
            </div>
            <button class="button danger" data-action="clear-stock-snapshots">Limpar relatorios</button>
          </div>
        </div>
        <div class="grid two">
          <div class="panel">
            <h3>Vendas do mes por entregador</h3>
            <p class="muted">${escapeHtml(capitalize(monthLabel))}</p>
            ${renderCourierTotalsTable(monthlyTotals)}
          </div>
          <div class="panel">
            <h3>Indicadores</h3>
            <div class="grid">
              <div class="metric"><span>Movimentacoes abertas</span><strong>${state.movements.filter((item) => item.status === "open").length}</strong></div>
              <div class="metric"><span>Vendas fechadas no mes</span><strong>${countClosedSalesInMonth(selectedMonth)}</strong></div>
            </div>
          </div>
        </div>
        <div class="panel" style="margin-top:16px">
          <h3>Vendas gerais por entregador</h3>
          ${renderCourierTotalsTable(overallTotals)}
        </div>
        <div class="panel" style="margin-top:16px">
          <h3>Historico de estoque</h3>
          ${state.stockSnapshots.length ? `
            <div class="table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Resumo</th><th>Acoes</th></tr></thead>
                <tbody>
                  ${state.stockSnapshots.slice().reverse().map((snapshot) => `
                    <tr>
                      <td>${formatDateTime(snapshot.createdAt)}</td>
                      <td>${formatSnapshot(snapshot.stock)}</td>
                      <td><button class="button icon" title="Excluir" data-action="delete-stock-snapshot" data-id="${snapshot.id}">X</button></td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          ` : `<div class="empty">Nenhum salvamento de estoque registrado.</div>`}
        </div>
      </section>
    `;
  }

  function renderCourierTotalsTable(totals) {
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Entregador</th>
              ${PRODUCTS.map((product) => `<th>${product.label}</th>`).join("")}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${Object.keys(totals).length ? Object.entries(totals).map(([courier, values]) => `
              <tr>
                <td><strong>${escapeHtml(courier)}</strong></td>
                ${PRODUCTS.map((product) => `<td>${values[product.id] || 0}</td>`).join("")}
                <td><strong>${PRODUCTS.reduce((sum, product) => sum + (values[product.id] || 0), 0)}</strong></td>
              </tr>
            `).join("") : `<tr><td colspan="${PRODUCTS.length + 2}">Nenhuma venda fechada.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderSettings() {
    const canManageUsers = isAdminUser();
    return `
      <section>
        <div class="section-header">
          <div>
          <h2>Configuracoes</h2>
            <p>Backup, limpeza, senha e manutencao dos dados.</p>
          </div>
        </div>
        <div class="panel" style="margin-bottom:16px">
          <h3>Banco de dados</h3>
          <p class="muted">
            Status: <strong>${usingDatabase ? "SQLite ativo" : "modo navegador"}</strong>
            ${databasePath ? `<br>Arquivo: ${escapeHtml(databasePath)}` : ""}
          </p>
        </div>
        <div class="grid two">
          ${canManageUsers ? `
            <form class="panel" data-action="rename-company">
              <h3>Empresa</h3>
              ${textField("company-name", "Nome exibido", state.meta.companyName, "text", true)}
              <div class="actions" style="margin-top:14px"><button class="button" type="submit">Salvar nome</button></div>
            </form>
          ` : ""}
          ${canManageUsers ? renderUserManagement() : ""}
          <div class="panel">
            <h3>Aparencia</h3>
            <p class="muted">Tema atual: <strong>${state.meta.theme === "dark" ? "escuro" : "claro"}</strong>.</p>
            <div class="actions" style="margin-top:14px">
              <button class="button secondary" data-action="toggle-theme" type="button">${state.meta.theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}</button>
            </div>
          </div>
          <form class="panel" data-action="clean-old-movements">
            <h3>Limpeza por data</h3>
            ${numberField("months-to-keep", "Apagar vendas com mais de quantos meses", 3)}
            <div class="actions" style="margin-top:14px"><button class="button warning" type="submit">Limpar antigos</button></div>
          </form>
          <div class="panel">
            <h3>Backup</h3>
            <div class="actions">
              <button class="button secondary" data-action="export" type="button">Exportar JSON</button>
              <button class="button secondary" data-action="trigger-import" type="button">Importar JSON</button>
              <button class="button secondary" data-action="restore-emergency" type="button">Restaurar emergencia</button>
            </div>
            <input class="hidden" id="import-file" type="file" accept="application/json,.json">
          </div>
        </div>
      </section>
    `;
  }

  function renderUserManagement() {
    return `
      <form class="panel" data-action="add-user">
        <h3>Cadastrar usuario</h3>
        <div class="form-grid">
          ${textField("user-name", "Nome", "", "text", true)}
          ${textField("user-login", "Usuario", "", "text", true)}
          ${textField("user-password", "Senha", "", "password", true)}
        </div>
        <div class="actions" style="margin-top:14px"><button class="button" type="submit">Cadastrar</button></div>
      </form>
      <div class="panel">
        <h3>Usuarios cadastrados</h3>
        <div class="grid">
          ${state.users.map((user) => `
            <div class="row-card">
              <div class="row-card-header">
                <div>
                  <strong>${escapeHtml(user.name)}</strong>
                  <div class="muted">@${escapeHtml(user.username)} - ${user.role === "admin" ? "admin" : "comum"}</div>
                </div>
                <button class="button icon" title="Excluir" data-action="delete-user" data-id="${user.id}">X</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function handleSubmit(event) {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    const action = form.dataset.action;
    const data = new FormData(form);

    if (action === "login") {
      const username = normalizeUsername(String(data.get("username") || ""));
      const passwordHash = hashPin(String(data.get("password") || ""));
      const user = state.users.find((item) => item.username === username && item.passwordHash === passwordHash);
      if (!user) {
        showToast("Usuario ou senha incorretos.", "error");
        return;
      }
      sessionStorage.setItem(SESSION_KEY, "yes");
      sessionStorage.setItem(`${SESSION_KEY}_user`, user.username);
      activateUserWorkspace(user.username);
      showRegisterForm = false;
      showForgotPasswordForm = false;
      showToast(`Bem-vindo, ${user.name}.`, "success");
      render();
      return;
    }

    if (action === "register-user") {
      registerCommonUser(data);
      return;
    }

    if (action === "forgot-password") {
      resetOwnPasswordFromLogin(data);
      return;
    }

    if (action === "save-general-stock") {
      PRODUCTS.forEach((product) => {
        state.stock.general[product.id] = readNumber(`general-${product.id}`);
      });
      persist();
      showToast("Estoque geral salvo.", "success");
      render();
      return;
    }

    if (action === "save-operational-stock") {
      PRODUCTS.forEach((product) => {
        state.stock.operational[product.id].full = readNumber(`op-${product.id}-full`);
        state.stock.operational[product.id].empty = readNumber(`op-${product.id}-empty`);
      });
      state.stock.exchange.total = readNumber("exchange-total");
      state.stockSnapshots.push({ id: createId(), createdAt: new Date().toISOString(), stock: clone(state.stock) });
      persist();
      showToast("Estoque completo salvo.", "success");
      render();
      return;
    }

    if (action === "add-client") {
      addClient(data);
      return;
    }

    if (action === "add-user") {
      if (!isAdminUser()) return showToast("Apenas administrador pode cadastrar usuarios.", "error");
      addUser(data);
      return;
    }

    if (action === "create-movement") {
      createMovement(data);
      return;
    }

    if (action === "close-movement") {
      closeMovement(form.dataset.id, data);
      return;
    }

    if (action === "add-courier") {
      addCourier(data);
      return;
    }

    if (action === "create-supply") {
      createSupply();
      return;
    }

    if (action === "rename-company") {
      if (!isAdminUser()) return showToast("Apenas administrador pode alterar o nome da empresa.", "error");
      const name = sanitizeText(String(data.get("company-name") || ""));
      if (!name) return showToast("Informe o nome da empresa.", "error");
      state.meta.companyName = name;
      persist();
      showToast("Nome atualizado.", "success");
      render();
      return;
    }

    if (action === "clean-old-movements") {
      cleanOldMovements(readNumber("months-to-keep"));
    }
  }

  function handleClick(event) {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      activeView = nav.dataset.view;
      render();
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button || button.tagName === "FORM") return;
    const action = button.dataset.action;

    if (action === "logout") {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(`${SESSION_KEY}_user`);
      render();
    } else if (action === "export") {
      exportData();
    } else if (action === "toggle-theme") {
      toggleTheme();
    } else if (action === "undo-last-change") {
      undoLastChange();
    } else if (action === "toggle-register") {
      showRegisterForm = !showRegisterForm;
      if (showRegisterForm) showForgotPasswordForm = false;
      render();
    } else if (action === "toggle-forgot-password") {
      showForgotPasswordForm = !showForgotPasswordForm;
      if (showForgotPasswordForm) showRegisterForm = false;
      render();
    } else if (action === "delete-client") {
      removeById("clients", button.dataset.id, "Cliente excluido.");
    } else if (action === "delete-user") {
      if (!isAdminUser()) return showToast("Apenas administrador pode excluir usuarios.", "error");
      deleteUser(button.dataset.id);
    } else if (action === "delete-courier") {
      deleteCourier(Number(button.dataset.index));
    } else if (action === "toggle-movements") {
      showAllMovements = !showAllMovements;
      render();
    } else if (action === "delete-movement") {
      removeById("movements", button.dataset.id, "Registro excluido.");
    } else if (action === "clear-movements") {
      clearMovements();
    } else if (action === "delete-supply") {
      removeById("supplies", button.dataset.id, "Abastecimento excluido.");
    } else if (action === "clear-supplies") {
      clearSupplies();
    } else if (action === "clear-stock-snapshots") {
      clearStockSnapshots();
    } else if (action === "delete-stock-snapshot") {
      removeById("stockSnapshots", button.dataset.id, "Relatorio excluido.");
    } else if (action === "trigger-import") {
      document.getElementById("import-file").click();
    } else if (action === "restore-emergency") {
      restoreEmergency();
    }
  }

  function handleInput(event) {
    if (event.target.id === "client-search") {
      clientSearch = event.target.value;
      render();
      const input = document.getElementById("client-search");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (event.target.matches("[data-quantity-out]")) {
      updateReturnedPreview(event.target);
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.id === "report-month") {
      reportMonth = target.value || getMonthInputValue(new Date());
      render();
      return;
    }
    if (target.dataset.clientField) {
      const client = state.clients.find((item) => item.id === target.dataset.id);
      if (!client) return;
      client[target.dataset.clientField] = sanitizeText(target.value);
      persist();
      showToast("Cliente atualizado.", "success");
      return;
    }
    if (target.id === "import-file") {
      importData(target.files[0]);
      target.value = "";
    }
  }

  function addClient(data) {
    const name = sanitizeText(String(data.get("client-name") || ""));
    const phone = sanitizeText(String(data.get("client-phone") || ""));
    const address = sanitizeText(String(data.get("client-address") || ""));
    if (!name || !phone || !address) return showToast("Preencha todos os campos do cliente.", "error");
    state.clients.push({ id: createId(), name, phone, address, createdAt: new Date().toISOString() });
    persist();
    showToast("Cliente adicionado.", "success");
    render();
  }

  function addUser(data) {
    const name = sanitizeText(String(data.get("user-name") || ""));
    const username = normalizeUsername(String(data.get("user-login") || ""));
    const password = String(data.get("user-password") || "");
    createUser({ name, username, password, role: "operator", successMessage: "Usuario cadastrado." });
  }

  function registerCommonUser(data) {
    const name = sanitizeText(String(data.get("register-name") || ""));
    const username = normalizeUsername(String(data.get("register-username") || ""));
    const password = String(data.get("register-password") || "");
    createUser({ name, username, password, role: "operator", successMessage: "Acesso criado. Agora entre com seu usuario e senha." });
  }

  function resetOwnPasswordFromLogin(data) {
    const username = normalizeUsername(String(data.get("forgot-username") || ""));
    const password = String(data.get("forgot-password") || "");
    const user = state.users.find((item) => item.username === username);
    if (!username || !password) return showToast("Informe usuario e nova senha.", "error");
    if (!user) return showToast("Usuario nao encontrado.", "error");
    if (password.trim().length < 4) return showToast("A nova senha precisa ter pelo menos 4 caracteres.", "error");
    user.passwordHash = hashPin(password);
    persist();
    showForgotPasswordForm = false;
    showToast("Senha trocada. Entre com a nova senha.", "success");
    render();
  }

  function createUser({ name, username, password, role, successMessage }) {
    if (!name || !username || !password) return showToast("Preencha nome, usuario e senha.", "error");
    if (username.length < 3) return showToast("O usuario precisa ter pelo menos 3 caracteres.", "error");
    if (password.trim().length < 4) return showToast("A senha precisa ter pelo menos 4 caracteres.", "error");
    if (state.users.some((user) => user.username === username)) return showToast("Este usuario ja existe.", "error");

    state.users.push({
      id: createId(),
      name,
      username,
      passwordHash: hashPin(password),
      role,
      createdAt: new Date().toISOString()
    });
    state.workspaces = state.workspaces || {};
    state.workspaces[username] = createDefaultBusinessData();
    persist();
    showToast(successMessage, "success");
    render();
  }

  function deleteUser(id) {
    const index = state.users.findIndex((user) => user.id === id);
    if (index < 0) return;
    if (state.users.length <= 1) return showToast("Mantenha pelo menos um usuario cadastrado.", "error");
    const currentUsername = sessionStorage.getItem(`${SESSION_KEY}_user`);
    if (state.users[index].username === currentUsername) return showToast("Voce nao pode excluir o usuario logado.", "error");
    if (!confirm("Excluir este usuario?")) return;
    if (state.workspaces) {
      delete state.workspaces[state.users[index].username];
    }
    state.users.splice(index, 1);
    persist();
    showToast("Usuario excluido.", "success");
    render();
  }

  function createMovement(data) {
    const courier = sanitizeText(String(data.get("movement-courier") || ""));
    const productId = String(data.get("movement-product") || "");
    const quantityOut = toNonNegativeInt(data.get("movement-full"));
    const emptyDelivered = toNonNegativeInt(data.get("movement-empty"));
    if (!state.couriers.includes(courier)) return showToast("Entregador invalido.", "error");
    if (!PRODUCTS.some((product) => product.id === productId)) return showToast("Produto invalido.", "error");
    if (quantityOut <= 0) return showToast("Informe uma quantidade de cheios maior que zero.", "error");
    if (state.stock.operational[productId].full < quantityOut) return showToast("Estoque insuficiente para esta saida.", "error");

    state.stock.operational[productId].full -= quantityOut;
    state.stock.operational[productId].empty += emptyDelivered;
    state.movements.push({
      id: createId(),
      type: "sale",
      status: "open",
      courier,
      productId,
      quantityOut,
      emptyDelivered,
      returnedQuantity: 0,
      soldQuantity: 0,
      createdAt: new Date().toISOString(),
      closedAt: null
    });
    persist();
    showToast("Saida registrada.", "success");
    render();
  }

  function closeMovement(id, data) {
    const movement = state.movements.find((item) => item.id === id && item.status === "open");
    if (!movement) return showToast("Acerto pendente nao encontrado.", "error");
    const sold = toNonNegativeInt(data.get("sold"));
    if (sold > movement.quantityOut) return showToast("Venda nao pode ser maior que a saida.", "error");
    const returned = movement.quantityOut - sold;
    state.stock.operational[movement.productId].full += returned;
    movement.returnedQuantity = returned;
    movement.soldQuantity = sold;
    movement.status = "closed";
    movement.closedAt = new Date().toISOString();
    persist();
    showToast(`Acerto fechado: ${sold} vendido(s).`, "success");
    render();
  }

  function addCourier(data) {
    const name = sanitizeText(String(data.get("courier-name") || ""));
    if (!name) return showToast("Informe o nome do entregador.", "error");
    if (state.couriers.some((item) => normalize(item) === normalize(name))) return showToast("Entregador ja cadastrado.", "error");
    state.couriers.push(name);
    persist();
    showToast("Entregador adicionado.", "success");
    render();
  }

  function deleteCourier(index) {
    if (!Number.isInteger(index) || !state.couriers[index]) return;
    if (!confirm("Excluir este entregador?")) return;
    state.couriers.splice(index, 1);
    persist();
    showToast("Entregador excluido.", "success");
    render();
  }

  function createSupply() {
    let changed = false;
    PRODUCTS.forEach((product) => {
      const received = readNumber(`supply-${product.id}-received`);
      const sentEmpty = readNumber(`supply-${product.id}-sent`);
      if (!received && !sentEmpty) return;
      changed = true;
      state.stock.operational[product.id].full += received;
      state.stock.operational[product.id].empty = Math.max(0, state.stock.operational[product.id].empty - sentEmpty);
      const supply = {
        id: createId(),
        productId: product.id,
        received,
        sentEmpty,
        createdAt: new Date().toISOString()
      };
      state.supplies.push(supply);
      state.movements.push({ ...supply, type: "supply", status: "closed" });
    });
    if (!changed) return showToast("Informe pelo menos um item do abastecimento.", "error");
    persist();
    showToast("Abastecimento registrado.", "success");
    render();
  }

  function clearMovements() {
    if (!confirm("Apagar o historico de vendas e acertos?")) return;
    if (!confirm("Ultima confirmacao: essa limpeza cria backup de emergencia antes de apagar.")) return;
    state.emergencyBackup = buildBackup();
    state.movements = state.movements.filter((item) => item.type === "supply");
    persist();
    showToast("Historico de vendas apagado com backup de emergencia.", "success");
    render();
  }

  function clearSupplies() {
    if (!confirm("Apagar todo o historico de abastecimento?")) return;
    state.emergencyBackup = buildBackup();
    state.supplies = [];
    state.movements = state.movements.filter((item) => item.type !== "supply");
    persist();
    showToast("Historico de abastecimento apagado.", "success");
    render();
  }

  function clearStockSnapshots() {
    if (!confirm("Apagar o historico de salvamentos de estoque?")) return;
    state.stockSnapshots = [];
    persist();
    showToast("Relatorios de estoque apagados.", "success");
    render();
  }

  function cleanOldMovements(months) {
    if (months < 0) return showToast("Informe uma quantidade valida de meses.", "error");
    if (!confirm(`Apagar movimentacoes com mais de ${months} meses?`)) return;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    state.emergencyBackup = buildBackup();
    state.movements = state.movements.filter((item) => new Date(item.createdAt) > cutoff);
    persist();
    showToast("Limpeza concluida.", "success");
    render();
  }

  function restoreEmergency() {
    if (!state.emergencyBackup) return showToast("Nao existe backup de emergencia.", "error");
    if (!confirm("Restaurar o backup de emergencia e substituir os dados atuais?")) return;
    applyBackup(state.emergencyBackup);
    persist();
    showToast("Backup de emergencia restaurado.", "success");
    render();
  }

  function applyBackup(backup) {
    state.stock = clone(backup.stock);
    state.users = clone(backup.users || state.users || []);
    state.clients = clone(backup.clients || []);
    state.couriers = clone(backup.couriers || []);
    state.movements = clone(backup.movements || []);
    state.stockSnapshots = clone(backup.stockSnapshots || []);
    state.supplies = clone(backup.supplies || []);
    state = normalizeState(state);
  }

  function pushUndoSnapshot() {
    if (!lastPersistedState) return;
    const snapshot = clone(lastPersistedState);
    const stack = getUndoStack();
    stack.push(snapshot);
    while (stack.length > UNDO_LIMIT) stack.shift();
    sessionStorage.setItem(UNDO_KEY, JSON.stringify(stack));
  }

  function getUndoStack() {
    try {
      const stack = JSON.parse(sessionStorage.getItem(UNDO_KEY) || "[]");
      return Array.isArray(stack) ? stack : [];
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  function rememberPersistedState() {
    lastPersistedState = clone(state);
  }

  function undoLastChange() {
    const stack = getUndoStack();
    const previous = stack[stack.length - 1];
    if (!previous) return showToast("Nada para desfazer.", "error");
    if (!confirm("Desfazer a ultima alteracao salva?")) return;
    stack.pop();
    sessionStorage.setItem(UNDO_KEY, JSON.stringify(stack));
    state = normalizeState(previous);
    persist({ skipUndo: true, skipAutoBackup: true });
    showToast("Ultima alteracao desfeita.", "success");
    render();
  }

  function removeById(collection, id, message) {
    const list = state[collection];
    const index = Array.isArray(list) ? list.findIndex((item) => item.id === id) : -1;
    if (index < 0) return;
    if (!confirm("Excluir este registro?")) return;
    list.splice(index, 1);
    persist();
    showToast(message, "success");
    render();
  }

  function calculateCourierTotals(options = {}) {
    return state.movements.reduce((acc, item) => {
      if (item.type !== "sale" || item.status !== "closed") return acc;
      if (options.month && !isSameMonth(item.closedAt || item.createdAt, options.month)) return acc;
      if (!acc[item.courier]) {
        acc[item.courier] = PRODUCTS.reduce((map, product) => ({ ...map, [product.id]: 0 }), {});
      }
      acc[item.courier][item.productId] += item.soldQuantity;
      return acc;
    }, {});
  }

  function countClosedSalesInMonth(monthDate) {
    return state.movements.filter((item) => (
      item.type === "sale" &&
      item.status === "closed" &&
      isSameMonth(item.closedAt || item.createdAt, monthDate)
    )).length;
  }

  function isSameMonth(value, monthDate) {
    if (!value) return false;
    const date = new Date(value);
    return date.getFullYear() === monthDate.getFullYear() && date.getMonth() === monthDate.getMonth();
  }

  function getMonthInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function parseMonthInput(value) {
    const [year, month] = String(value || "").split("-").map((part) => Number.parseInt(part, 10));
    if (!year || !month) return new Date();
    return new Date(year, month - 1, 1);
  }

  function exportData() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.getElementById("download-template").content.firstElementChild.cloneNode();
    anchor.href = url;
    anchor.download = `backup-deposito-gas-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || "{}"));
        const imported = payload.state || payload;
        if (!imported || typeof imported !== "object") throw new Error("Invalid backup");
        if (!confirm("Importar backup e substituir os dados atuais?")) return;
        state.emergencyBackup = buildBackup();
        state = normalizeState(imported);
        persist();
        showToast("Backup importado.", "success");
        render();
      } catch (error) {
        console.error(error);
        showToast("Arquivo de backup invalido.", "error");
      }
    };
    reader.readAsText(file);
  }

  function numberField(id, label, value) {
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <input id="${id}" name="${id}" type="number" min="0" step="1" value="${toNonNegativeInt(value)}">
      </div>
    `;
  }

  function textField(id, label, value = "", type = "text", required = false) {
    const passwordAttributes = type === "password" ? 'autocomplete="off" data-lpignore="true" data-1p-ignore="true"' : "";
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <input id="${id}" name="${id}" type="${type}" value="${escapeAttr(value)}" autocomplete="off" ${passwordAttributes} ${required ? "required" : ""}>
      </div>
    `;
  }

  function selectField(id, label, options) {
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <select id="${id}" name="${id}">
          ${options.map((option) => `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  function readNumber(id) {
    return toNonNegativeInt(document.getElementById(id).value);
  }

  function updateReturnedPreview(input) {
    const form = input.closest("[data-id]");
    if (!form) return;
    const quantityOut = toNonNegativeInt(input.dataset.quantityOut);
    const sold = toNonNegativeInt(input.value);
    const preview = document.querySelector(`[data-returned-preview="${form.dataset.id}"]`);
    if (preview) preview.textContent = Math.max(0, quantityOut - sold);
  }

  function toNonNegativeInt(value) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function sanitizeText(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function normalizeUsername(value) {
    return normalize(value).replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  }

  function getProductLabel(productId) {
    return (PRODUCTS.find((product) => product.id === productId) || {}).label || productId;
  }

  function getCurrentUser() {
    const username = getSessionUsername();
    return state.users.find((user) => user.username === username) || null;
  }

  function getSessionUsername() {
    return sessionStorage.getItem(`${SESSION_KEY}_user`);
  }

  function isAdminUser() {
    const user = getCurrentUser();
    return Boolean(user && user.role === "admin");
  }

  function activateUserWorkspace(username) {
    state.workspaces = state.workspaces || {};
    state.workspaces[username] = normalizeBusinessData(state.workspaces[username] || createDefaultBusinessData());
    applyBusinessData(state, state.workspaces[username]);
  }

  function formatDateTime(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function formatSnapshot(stock) {
    return PRODUCTS.map((product) => {
      const item = stock.operational[product.id];
      return `${product.label}: ${item.full}/${item.empty}`;
    }).join(" | ") + ` | Trocas: ${stock.exchange.total}`;
  }

  function getStorageUsage() {
    const usedBytes = new Blob([JSON.stringify(localStorage)]).size;
    const limitBytes = 5 * 1024 * 1024;
    const percent = Math.min(100, Math.round((usedBytes / limitBytes) * 100));
    return {
      usedMb: (usedBytes / 1024 / 1024).toFixed(2),
      limitMb: 5,
      percent,
      color: percent >= 90 ? "var(--danger)" : percent >= 70 ? "var(--warning)" : "var(--success)"
    };
  }

  function capitalize(value) {
    return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
  }

  function toggleTheme() {
    state.meta.theme = state.meta.theme === "dark" ? "light" : "dark";
    persist();
    showToast(state.meta.theme === "dark" ? "Modo escuro ativado." : "Modo claro ativado.", "success");
    render();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.meta.theme === "dark" ? "dark" : "light";
  }

  function createId() {
    return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function hashPin(value) {
    let h1 = 0xdeadbeef ^ value.length;
    let h2 = 0x41c6ce57 ^ value.length;
    for (let index = 0; index < value.length; index += 1) {
      const char = value.charCodeAt(index);
      h1 = Math.imul(h1 ^ char, 2654435761);
      h2 = Math.imul(h2 ^ char, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function showToast(message, type = "") {
    clearTimeout(toastTimer);
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    document.body.appendChild(toast);
    toastTimer = setTimeout(() => toast.remove(), 3200);
  }
})();
