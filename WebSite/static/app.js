const views = {
  catalog: document.getElementById('view-catalog'),
  vuln: document.getElementById('view-vuln'),
  auth: document.getElementById('view-auth'),
  profile: document.getElementById('view-profile'),
  admin: document.getElementById('view-admin'),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  window.location.hash = name;
  if (name === 'catalog') loadCatalog();
  if (name === 'profile') loadProfile();
  if (name === 'admin') loadAdmin();
}

// --- Catalog ---
async function loadCatalog() {
  views.catalog.innerHTML = '<h1>Каталог</h1><p>Загрузка...</p>';
  try {
    const resp = await fetch('/', { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const items = await resp.json();
    const list = document.createElement('div');
    list.className = 'catalog-grid';
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'product-card';
      card.innerHTML = `
        <img src="${item.image_url}" alt="${item.name}" />
        <h2>${item.name}</h2>
        <p class="desc">${item.description || ''}</p>
        <div class="price">${(item.price_cents / 100).toFixed(2)}$</div>
      `;
      list.appendChild(card);
    });
    views.catalog.innerHTML = '<h1>Catalog</h1>';
    views.catalog.appendChild(list);
  } catch (e) {
    views.catalog.innerHTML = `<h1>Catalog</h1><p class="error">Failed to load catalog: ${e}</p>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- SSRF & XSS Demo ---
function renderVulnDemo() {
  views.vuln.innerHTML = `
    <h1>Attack Playground (Demo)</h1>
    <div class="vuln-layout">
      <div class="panel">
        <h2>SSRF via /proxy</h2>
        <p>Fetch any URL (including internal services) via the vulnerable proxy.</p>
        <form id="form-ssrf">
          <label>Target URL <input name="url" type="text" placeholder="https://httpbin.org/get" required /></label>
          <button type="submit">Fetch via /proxy</button>
          <div class="msg" data-role="msg"></div>
        </form>
      </div>
      <div class="panel">
        <h2>Reflected XSS via /preview</h2>
        <p>Echoes user input without escaping (XSS).</p>
        <form id="form-xss">
          <label>Text to preview <input name="text" type="text" placeholder="<script>alert(1)</script>" required /></label>
          <button type="submit">Preview via /preview</button>
          <div class="msg" data-role="msg"></div>
        </form>
      </div>
    </div>
  `;

  const ssrfForm = document.getElementById('form-ssrf');
  const xssForm = document.getElementById('form-xss');

  ssrfForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(ssrfForm);
    const url = data.get('url');
    const msgEl = ssrfForm.querySelector('[data-role="msg"]');
    msgEl.textContent = 'Fetching...';
    try {
      const resp = await fetch('/proxy?' + new URLSearchParams({ url }));
      const text = await resp.text();
      msgEl.innerHTML = `<strong>Status ${resp.status}</strong><br><pre>${escapeHtml(text)}</pre>`;
    } catch (err) {
      msgEl.textContent = 'Error: ' + err;
    }
  });

  xssForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(xssForm);
    const text = data.get('text');
    const msgEl = xssForm.querySelector('[data-role="msg"]');
    msgEl.textContent = 'Loading preview...';
    try {
      const resp = await fetch('/preview?' + new URLSearchParams({ text }));
      const html = await resp.text();
      // Intentionally render unsanitized HTML to demonstrate XSS
      msgEl.innerHTML = `<strong>Status ${resp.status}</strong><br>${html}`;
    } catch (err) {
      msgEl.textContent = 'Error: ' + err;
    }
  });
}

// --- Auth (login/register) ---
function renderAuth() {
  views.auth.innerHTML = `
    <h1>Login / Registration</h1>
    <div class="auth-layout">
      <form id="form-login" class="panel">
        <h2>Login</h2>
        <label>Email <input name="email" type="text" required /></label>
        <label>Password <input name="password" type="password" required /></label>
        <button type="submit">Login</button>
        <p class="hint">Backend login is intentionally vulnerable to SQL injection (see README_backend.md).</p>
        <div class="msg" data-role="msg"></div>
      </form>
      <form id="form-register" class="panel">
        <h2>Registration</h2>
        <label>Email <input name="email" type="email" required /></label>
        <label>Password <input name="password" type="password" required /></label>
        <button type="submit">Register</button>
        <div class="msg" data-role="msg"></div>
      </form>
    </div>
  `;

  const loginForm = document.getElementById('form-login');
  const registerForm = document.getElementById('form-register');

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(loginForm);
    const body = new URLSearchParams(data).toString();
    const msgEl = loginForm.querySelector('[data-role="msg"]');
    msgEl.textContent = 'Logging in...';
    try {
      const resp = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'include',
      });
      if (!resp.ok) {
        msgEl.textContent = 'Login failed: ' + resp.status;
        return;
      }
      msgEl.textContent = 'Login OK (cookie user_id is set, see /profile).';
    } catch (err) {
      msgEl.textContent = 'Error: ' + err;
    }
  });

  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(registerForm);
    const body = new URLSearchParams(data).toString();
    const msgEl = registerForm.querySelector('[data-role="msg"]');
    msgEl.textContent = 'Registering...';
    try {
      const resp = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const text = await resp.text();
      msgEl.textContent = `Response: ${resp.status} ${text}`;
    } catch (err) {
      msgEl.textContent = 'Error: ' + err;
    }
  });
}

// --- Profile ---
async function loadProfile() {
  views.profile.innerHTML = '<h1>Profile</h1><p>Loading...</p>';
  try {
    const resp = await fetch('/profile', { credentials: 'include' });
    if (!resp.ok) {
      views.profile.innerHTML = `<h1>Profile</h1><p class="error">${resp.status} not logged in?</p>`;
      return;
    }
    const data = await resp.json();
    views.profile.innerHTML = `
      <h1>Profile</h1>
      <div class="panel">
        <p><strong>ID:</strong> ${data.id}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>is_admin:</strong> ${data.is_admin}</p>
      </div>
      <form id="form-avatar" class="panel">
        <h2>Update Avatar URL (SSRF Demo)</h2>
        <label>Avatar URL <input name="avatar_url" type="text" placeholder="http://localhost:8081/secret" /></label>
        <button type="submit">Update Avatar</button>
        <div class="msg" data-role="msg"></div>
      </form>
    `;
    const avatarForm = document.getElementById('form-avatar');
    avatarForm.addEventListener('submit', async e => {
      e.preventDefault();
      const data = new FormData(avatarForm);
      const url = data.get('avatar_url');
      const msgEl = avatarForm.querySelector('[data-role="msg"]');
      msgEl.textContent = 'Fetching avatar...';
      try {
        const resp = await fetch('/image?' + new URLSearchParams({ url }));
        const blob = await resp.blob();
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        msgEl.innerHTML = '';
        msgEl.appendChild(img);
      } catch (err) {
        msgEl.textContent = 'Error: ' + err;
      }
    });
  } catch (e) {
    views.profile.innerHTML = `<h1>Profile</h1><p class="error">Error: ${e}</p>`;
  }
}

// --- Admin ---
function renderAdmin() {
  views.admin.innerHTML = `
    <h1>Admin panel</h1>
    <div id="admin-info" class="panel">Loading /admin...</div>
    <form id="form-add-product" class="panel">
      <h2>Add product (POST /admin/add_product)</h2>
      <label>Name <input name="name" required /></label>
      <label>Description <input name="description" /></label>
      <label>Price (cents) <input name="price_cents" type="number" required /></label>
      <label>Image URL <input name="image_url" required /></label>
      <button type="submit">Add product</button>
      <p class="hint">image_url is stored as provided and then used via SSRF chain /image → /proxy.</p>
      <div class="msg" data-role="msg"></div>
    </form>
  `;

  const addForm = document.getElementById('form-add-product');
  addForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data = new FormData(addForm);
    const body = new URLSearchParams(data).toString();
    const msgEl = addForm.querySelector('[data-role="msg"]');
    msgEl.textContent = 'Sending...';
    try {
      const resp = await fetch('/admin/add_product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        credentials: 'include',
      });
      const text = await resp.text();
      msgEl.textContent = `Response: ${resp.status} ${text}`;
    } catch (err) {
      msgEl.textContent = 'Error: ' + err;
    }
  });
}

async function loadAdmin() {
  if (!views.admin.hasChildNodes()) {
    renderAdmin();
  }
  const infoEl = document.getElementById('admin-info');
  infoEl.textContent = 'Loading /admin panel...';
  try {
    const resp = await fetch('/admin', { credentials: 'include' });
    const text = await resp.text();
    infoEl.textContent = `Response from /admin (status ${resp.status}):\n` + text;
  } catch (e) {
    infoEl.textContent = 'Error: ' + e;
  }
}

// --- Navigation setup ---
document.querySelectorAll('nav button[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.getAttribute('data-view');
    if (v === 'auth' && !views.auth.hasChildNodes()) {
      renderAuth();
    }
    if (v === 'vuln' && !views.vuln.hasChildNodes()) {
      renderVulnDemo();
    }
    showView(v);
  });
});

window.addEventListener('load', () => {
  const initial = window.location.hash.replace('#', '') || 'catalog';
  if (initial === 'auth') renderAuth();
  if (initial === 'vuln') renderVulnDemo();
  showView(initial);
});
