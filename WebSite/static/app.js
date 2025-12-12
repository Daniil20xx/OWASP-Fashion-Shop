const views = {
  catalog: document.getElementById('view-catalog'),
  vuln: document.getElementById('view-vuln'),
  auth: document.getElementById('view-auth'),
  profile: document.getElementById('view-profile'),
  admin: document.getElementById('view-admin'),
  cart: document.getElementById('view-cart'),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  window.location.hash = name;
  if (name === 'catalog') loadCatalog();
  if (name === 'profile') loadProfile();
  if (name === 'admin') loadAdmin();
  if (name === 'cart') loadCartView(); 
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

// --- Cart Functions ---
async function loadCart() {
    try {
        const resp = await fetch('/cart', { credentials: 'include' });
        if (!resp.ok) {
            return [];
        }
        return await resp.json();
    } catch (e) {
        console.error('Failed to load cart:', e);
        return [];
    }
}

// Обновите функцию loadProfile для отображения корзины:
function renderCart(items) {
    if (items.length === 0) {
        return '<p>Your cart is empty. Add items from Catalog!</p>';
    }
    
    let total = 0;
    const html = items.map(item => {
        const itemTotal = (item.price_cents * item.quantity) / 100;
        total += itemTotal;
        return `
            <div class="cart-item" data-cart-id="${item.id}">
                <div class="cart-item-info">
                    <strong>${item.name}</strong>
                    <div class="cart-item-details">
                        Quantity: ${item.quantity} × $${(item.price_cents / 100).toFixed(2)}
                        <span class="cart-item-total">$${itemTotal.toFixed(2)}</span>
                    </div>
                </div>
                <button class="btn-remove" data-cart-id="${item.id}">Remove</button>
            </div>
        `;
    }).join('');
    
    return `
        ${html}
        <div class="cart-total">
            <strong>Total: $${total.toFixed(2)}</strong>
        </div>
        <button id="btn-checkout" class="btn-checkout">💳 Checkout & Pay</button>
    `;
}

function renderOrders(orders) {
    if (orders.length === 0) {
        return '<p>No orders yet.</p>';
    }
    
    return orders.map(order => `
        <div class="order-item">
            <strong>Order #${order.id}</strong>
            <div class="order-details">
                Total: $${(order.total_cents / 100).toFixed(2)}
                <small>${new Date(order.created_at).toLocaleDateString()}</small>
            </div>
        </div>
    `).join('');
}

async function loadOrders() {
    try {
        const resp = await fetch('/orders', { credentials: 'include' });
        if (!resp.ok) {
            return [];
        }
        return await resp.json();
    } catch (e) {
        console.error('Failed to load orders:', e);
        return [];
    }
}

function addCartEventListeners() {
    // Удаление товара
    document.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cartId = btn.getAttribute('data-cart-id');
            try {
                const resp = await fetch('/cart/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `cart_id=${cartId}`,
                    credentials: 'include'
                });
                if (resp.ok) {
                    loadProfile(); // Перезагружаем профиль
                }
            } catch (e) {
                console.error('Failed to remove item:', e);
            }
        });
    });
    
    // Оформление заказа
    const checkoutBtn = document.getElementById('btn-checkout');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', async () => {
            try {
                const resp = await fetch('/checkout', {
                    method: 'POST',
                    credentials: 'include'
                });
                const result = await resp.json();
                if (resp.ok) {
                    alert(`✅ Order #${result.order_id} placed successfully! Total: $${(result.total_cents / 100).toFixed(2)}`);
                    loadProfile(); // Перезагружаем профиль
                } else {
                    alert('Failed to checkout: ' + result.error);
                }
            } catch (e) {
                console.error('Checkout failed:', e);
            }
        });
    }
}

// Обновите функцию loadCatalog для добавления кнопки в карточку товара:
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
                <button class="btn-add-to-cart" data-product-id="${item.id}">Add to Cart</button>
            `;
            list.appendChild(card);
        });
        views.catalog.innerHTML = '<h1>Catalog</h1>';
        views.catalog.appendChild(list);
        
        // Добавляем обработчики для кнопок добавления в корзину
        document.querySelectorAll('.btn-add-to-cart').forEach(btn => {
            btn.addEventListener('click', async () => {
                const productId = btn.getAttribute('data-product-id');
                try {
                    const resp = await fetch('/cart/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: `product_id=${productId}`,
                        credentials: 'include'
                    });
                    if (resp.ok) {
                        btn.textContent = '✓ Added!';
                        btn.disabled = true;
                        setTimeout(() => {
                            btn.textContent = 'Add to Cart';
                            btn.disabled = false;
                        }, 2000);
                    }
                } catch (e) {
                    console.error('Failed to add to cart:', e);
                }
            });
        });
    } catch (e) {
        views.catalog.innerHTML = `<h1>Catalog</h1><p class="error">Failed to load catalog: ${e}</p>`;
    }
}

// --- Cart View ---
async function loadCartView() {
    if (!authState.authenticated) {
        views.cart.innerHTML = `
            <h1>🛒 Your Cart</h1>
            <div class="panel">
                <p>Please login to view your cart.</p>
                <button onclick="showView('auth')" class="btn-checkout">Login / Register</button>
            </div>
        `;
        return;
    }
    views.cart.innerHTML = '<h1>🛒 Your Cart</h1><p>Loading...</p>';
    try {
        // Загружаем корзину
        const cartResp = await fetch('/cart', { credentials: 'include' });
        if (!cartResp.ok) {
            views.cart.innerHTML = '<h1>🛒 Your Cart</h1><p>Please login to view your cart.</p>';
            return;
        }
        const cartItems = await cartResp.json();
        
        // Загружаем заказы
        let orders = [];
        try {
            const ordersResp = await fetch('/orders', { credentials: 'include' });
            if (ordersResp.ok) {
                orders = await ordersResp.json();
            }
        } catch (e) {
            console.error('Failed to load orders:', e);
        }
        
        views.cart.innerHTML = `
            <h1>🛒 Your Cart</h1>
            <div class="cart-container">
                <div class="cart-items-panel panel">
                    <h2>Items in Cart</h2>
                    ${renderCartItems(cartItems)}
                </div>
                
                <div class="cart-summary-panel panel">
                    <h2>Order Summary</h2>
                    ${renderCartSummary(cartItems)}
                </div>
                
                <div class="orders-panel panel">
                    <h2>📦 Order History</h2>
                    ${renderOrders(orders)}
                </div>
            </div>
        `;
        
        addCartEventListeners();
        
    } catch (e) {
        views.cart.innerHTML = `<h1>🛒 Your Cart</h1><p class="error">Error loading cart: ${e.message}</p>`;
    }
}

function renderCartItems(items) {
    if (!items || items.length === 0) {
        return '<p>Your cart is empty. Add items from Catalog!</p>';
    }
    
    return items.map(item => `
        <div class="cart-item" data-cart-id="${item.id}">
            <div class="cart-item-image">
                <img src="${item.image_url}" alt="${item.name}" />
            </div>
            <div class="cart-item-info">
                <strong>${item.name}</strong>
                <div class="cart-item-details">
                    <span>Price: $${(item.price_cents / 100).toFixed(2)}</span>
                    <span>Quantity: ${item.quantity}</span>
                    <span class="cart-item-total">$${(item.price_cents * item.quantity / 100).toFixed(2)}</span>
                </div>
            </div>
            <button class="btn-remove" data-cart-id="${item.id}">Remove</button>
        </div>
    `).join('');
}

function renderCartSummary(items) {
    if (!items || items.length === 0) {
        return '<p>Add items to see summary</p>';
    }
    
    const subtotal = items.reduce((sum, item) => sum + (item.price_cents * item.quantity), 0);
    const tax = subtotal * 0.1; // 10% tax
    const total = subtotal + tax;
    
    return `
        <div class="summary-row">
            <span>Subtotal:</span>
            <span>$${(subtotal / 100).toFixed(2)}</span>
        </div>
        <div class="summary-row">
            <span>Tax (10%):</span>
            <span>$${(tax / 100).toFixed(2)}</span>
        </div>
        <div class="summary-row total">
            <strong>Total:</strong>
            <strong>$${(total / 100).toFixed(2)}</strong>
        </div>
        <button id="btn-checkout" class="btn-checkout" ${items.length === 0 ? 'disabled' : ''}>
            💳 Proceed to Checkout
        </button>
    `;
}

function renderOrders(orders) {
    if (!orders || orders.length === 0) {
        return '<p>No orders yet.</p>';
    }
    
    return orders.map(order => `
        <div class="order-item">
            <div class="order-header">
                <strong>Order #${order.id}</strong>
                <small>${new Date(order.created_at).toLocaleDateString()}</small>
            </div>
            <div class="order-total">
                Total: $${(order.total_cents / 100).toFixed(2)}
            </div>
        </div>
    `).join('');
}

function addCartEventListeners() {
    // Удаление товара
    document.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cartId = btn.getAttribute('data-cart-id');
            try {
                const resp = await fetch('/cart/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `cart_id=${cartId}`,
                    credentials: 'include'
                });
                if (resp.ok) {
                    loadCartView(); // Перезагружаем корзину
                }
            } catch (e) {
                console.error('Failed to remove item:', e);
            }
        });
    });
    
    // Оформление заказа
    const checkoutBtn = document.getElementById('btn-checkout');
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', async () => {
            if (checkoutBtn.disabled) return;
            
            if (!confirm('Are you sure you want to proceed with checkout?')) {
                return;
            }
            
            try {
                const resp = await fetch('/checkout', {
                    method: 'POST',
                    credentials: 'include'
                });
                if (resp.ok) {
                    const result = await resp.json();
                    alert(`✅ Order #${result.order_id} placed successfully!\nTotal: $${(result.total_cents / 100).toFixed(2)}`);
                    loadCartView(); // Перезагружаем корзину
                } else {
                    const error = await resp.text();
                    alert('Failed to checkout: ' + error);
                }
            } catch (e) {
                console.error('Checkout failed:', e);
                alert('Checkout failed: ' + e.message);
            }
        });
    }
}

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
                <button class="btn-add-to-cart" data-product-id="${item.id}">Add to Cart</button>
            `;
            list.appendChild(card);
        });
        views.catalog.innerHTML = '<h1>Catalog</h1>';
        views.catalog.appendChild(list);
        
        document.querySelectorAll('.btn-add-to-cart').forEach(btn => {
            btn.addEventListener('click', async () => {
                const productId = btn.getAttribute('data-product-id');
                const originalText = btn.textContent;
                btn.textContent = 'Adding...';
                btn.disabled = true;
                
                try {
                    const resp = await fetch('/cart/add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: `product_id=${productId}`,
                        credentials: 'include'
                    });
                    if (resp.ok) {
                        btn.textContent = '✓ Added to Cart!';
                        setTimeout(() => {
                            btn.textContent = originalText;
                            btn.disabled = false;
                        }, 1500);
                    } else {
                        throw new Error('Failed to add to cart');
                    }
                } catch (e) {
                    console.error('Failed to add to cart:', e);
                    btn.textContent = 'Failed!';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.disabled = false;
                    }, 1500);
                }
            });
        });
    } catch (e) {
        views.catalog.innerHTML = `<h1>Catalog</h1><p class="error">Failed to load catalog: ${e}</p>`;
    }
}
// --- Auth State Management ---
let authState = {
    authenticated: false,
    user_id: null,
    email: null,
    is_admin: false
};

async function checkAuth() {
    try {
        const resp = await fetch('/auth/status', { credentials: 'include' });
        if (resp.ok) {
            authState = await resp.json();
            updateUIForAuthState();
            return authState;
        }
    } catch (e) {
        console.error('Auth check failed:', e);
    }
    return { authenticated: false };
}

function updateUIForAuthState() {
    const nav = document.querySelector('.nav');
    if (!nav) return;

    // Обновляем текст кнопок
    const profileBtn = nav.querySelector('button[data-view="profile"]');
    const authBtn = nav.querySelector('button[data-view="auth"]');
    const cartBtn = nav.querySelector('button[data-view="cart"]');
    const adminBtn = nav.querySelector('button[data-view="admin"]');

    if (authState.authenticated) {
        // Пользователь залогинен
        if (profileBtn) {
            profileBtn.textContent = `👤 ${authState.email || 'Profile'}`;
            profileBtn.style.display = 'inline-block';
        }
        
        if (authBtn) {
            authBtn.textContent = 'Logout';
            authBtn.setAttribute('data-action', 'logout');
        }
        
        if (cartBtn) {
            cartBtn.style.display = 'inline-block';
        }
        
        if (adminBtn) {
            adminBtn.style.display = authState.is_admin ? 'inline-block' : 'none';
        }
    } else {
        // Пользователь не залогинен
        if (profileBtn) profileBtn.style.display = 'none';
        if (authBtn) {
            authBtn.textContent = 'Login / Register';
            authBtn.removeAttribute('data-action');
        }
        if (cartBtn) cartBtn.style.display = 'none';
        if (adminBtn) adminBtn.style.display = 'none';
    }
}

// --- Logout Function ---
async function handleLogout() {
    try {
        const resp = await fetch('/logout', {
            method: 'POST',
            credentials: 'include'
        });
        if (resp.ok) {
            authState = { authenticated: false, user_id: null, email: null, is_admin: false };
            updateUIForAuthState();
            showView('catalog'); // Перенаправляем на каталог
            alert('Logged out successfully!');
        }
    } catch (e) {
        console.error('Logout failed:', e);
    }
}

// --- Update showView function ---
function showView(name) {
    // Если пытаемся открыть профиль/корзину/админку без авторизации - показываем auth
    if (!authState.authenticated && ['profile', 'cart', 'admin'].includes(name)) {
        name = 'auth';
    }
    
    // Если пытаемся открыть логин уже авторизованным - показываем профиль
    if (authState.authenticated && name === 'auth') {
        name = 'profile';
    }

    Object.entries(views).forEach(([key, el]) => {
        el.classList.toggle('active', key === name);
    });
    window.location.hash = name;
    
    if (name === 'catalog') loadCatalog();
    if (name === 'profile') loadProfile();
    if (name === 'admin') loadAdmin();
    if (name === 'cart') loadCartView();
    if (name === 'auth' && !views.auth.hasChildNodes()) {
        renderAuth();
    }
}

// --- Update navigation setup ---
document.querySelectorAll('nav button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-view');
        
        // Обработка выхода
        if (btn.getAttribute('data-action') === 'logout') {
            handleLogout();
            return;
        }
        
        if (v === 'auth' && !views.auth.hasChildNodes()) {
            renderAuth();
        }
        if (v === 'vuln' && !views.vuln.hasChildNodes()) {
            renderVulnDemo();
        }
        showView(v);
    });
});

// --- Update renderAuth function ---
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
            msgEl.textContent = 'Login successful! Redirecting...';
            
            // Обновляем статус аутентификации
            await checkAuth();
            setTimeout(() => {
                showView('profile');
            }, 1000);
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
            if (resp.ok) {
                msgEl.textContent = 'Registration successful! Please login.';
                // Очищаем форму регистрации
                registerForm.reset();
                // Переключаем на логин
                document.querySelector('#form-login input[name="email"]').focus();
            } else {
                msgEl.textContent = `Error: ${resp.status} ${text}`;
            }
        } catch (err) {
            msgEl.textContent = 'Error: ' + err;
        }
    });
}

// --- Update window load event ---
window.addEventListener('load', async () => {
    await checkAuth();
    
    const initial = window.location.hash.replace('#', '') || 'catalog';
    
    if (!authState.authenticated && ['profile', 'cart'].includes(initial)) {
        showView('auth');
    } else if (authState.authenticated && initial === 'auth') {
        showView('profile');
    } else {
        if (initial === 'auth') renderAuth();
        if (initial === 'vuln') renderVulnDemo();
        showView(initial);
    }
});

async function updateAuthAndUI() {
    await checkAuth();
    updateUIForAuthState();
}
