const views = {
  catalog: document.getElementById('view-catalog'),
  cart: document.getElementById('view-cart'),
  vuln: document.getElementById('view-vuln'),
  auth: document.getElementById('view-auth'),
  profile: document.getElementById('view-profile'),
  admin: document.getElementById('view-admin'),
};

let cartItems = [];

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
  window.location.hash = name;
  if (name === 'catalog') loadCatalog();
  if (name === 'cart') loadCart();
  if (name === 'profile') loadProfile();
  if (name === 'admin') loadAdmin();
}

// --- Catalog ---
async function loadCatalog() {
  views.catalog.innerHTML = '<h1>Catalog</h1><p>Loading...</p>';
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
        <button class="add-to-cart-btn" data-product-id="${item.id}" data-product-name="${item.name}" data-product-price="${item.price_cents}" data-product-image="${item.image_url}">
          Add to Cart
        </button>
      `;
      list.appendChild(card);
    });
    views.catalog.innerHTML = '<h1>Catalog</h1>';
    views.catalog.appendChild(list);
    
    // Add event listeners to cart buttons
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      btn.addEventListener('click', addToCart);
    });
  } catch (e) {
    views.catalog.innerHTML = `<h1>Catalog</h1><p class="error">Failed to load catalog: ${e}</p>`;
  }
}

function addToCart(e) {
  const btn = e.target;
  const product = {
    id: btn.dataset.productId,
    name: btn.dataset.productName,
    price: parseInt(btn.dataset.productPrice),
    image: btn.dataset.productImage,
    quantity: 1
  };
  
  const existingItem = cartItems.find(item => item.id === product.id);
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cartItems.push(product);
  }
  
  updateCartButton();
  showNotification('Product added to cart!');
}

function updateCartButton() {
  const cartBtn = document.querySelector('[data-view="cart"]');
  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  cartBtn.textContent = `Cart (${totalItems})`;
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #10b981;
    color: white;
    padding: 1rem;
    border-radius: 0.5rem;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Cart ---
function loadCart() {
  if (cartItems.length === 0) {
    views.cart.innerHTML = '<h1>Cart</h1><p>Your cart is empty</p>';
    return;
  }

  const cartHTML = `
    <h1>Cart</h1>
    <div class="cart-items">
      ${cartItems.map(item => `
        <div class="cart-item" data-product-id="${item.id}">
          <img src="${item.image}" alt="${item.name}" />
          <div class="cart-item-info">
            <h3>${item.name}</h3>
            <div class="price">${(item.price / 100).toFixed(2)}$</div>
          </div>
          <div class="cart-item-quantity">
            <button class="quantity-btn decrease" data-product-id="${item.id}">-</button>
            <span>${item.quantity}</span>
            <button class="quantity-btn increase" data-product-id="${item.id}">+</button>
          </div>
          <button class="remove-btn" data-product-id="${item.id}">Remove</button>
        </div>
      `).join('')}
    </div>
    <div class="cart-summary">
      <div class="total">Total: ${calculateTotal()}$</div>
      <button class="checkout-btn">Checkout</button>
    </div>
  `;
  
  views.cart.innerHTML = cartHTML;
  
  // Add event listeners
  document.querySelectorAll('.quantity-btn').forEach(btn => {
    btn.addEventListener('click', updateQuantity);
  });
  
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', removeFromCart);
  });
  
  document.querySelector('.checkout-btn').addEventListener('click', checkout);
}

function calculateTotal() {
  return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0) / 100;
}

function updateQuantity(e) {
  const productId = e.target.dataset.productId;
  const item = cartItems.find(item => item.id === productId);
  
  if (e.target.classList.contains('increase')) {
    item.quantity += 1;
  } else if (e.target.classList.contains('decrease') && item.quantity > 1) {
    item.quantity -= 1;
  }
  
  updateCartButton();
  loadCart();
}

function removeFromCart(e) {
  const productId = e.target.dataset.productId;
  cartItems = cartItems.filter(item => item.id !== productId);
  updateCartButton();
  loadCart();
  showNotification('Product removed from cart');
}

function checkout() {
  if (cartItems.length === 0) {
    showNotification('Cart is empty!');
    return;
  }
  
  // Create order
  const order = {
    id: Date.now(),
    date: new Date().toISOString(),
    items: [...cartItems],
    total: calculateTotal()
  };
  
  // Save to localStorage (demo purposes)
  const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
  orderHistory.push(order);
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
  
  // Clear cart
  cartItems = [];
  updateCartButton();
  loadCart();
  
  showNotification('Order placed! Check your profile.');
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
    
    // Get order history from localStorage (demo purposes)
    const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
    
    views.profile.innerHTML = `
      <h1>Profile</h1>
      <div class="profile-layout">
        <div class="panel">
          <h2>User Information</h2>
          <p><strong>ID:</strong> ${data.id}</p>
          <p><strong>Email:</strong> ${data.email}</p>
          <p><strong>is_admin:</strong> ${data.is_admin}</p>
        </div>
        
        <div class="panel">
          <h2>Current Cart</h2>
          ${cartItems.length > 0 ? `
            <div class="cart-summary">
              <p><strong>Items:</strong> ${cartItems.reduce((sum, item) => sum + item.quantity, 0)}</p>
              <p><strong>Total:</strong> ${calculateTotal()}$</p>
              <button class="checkout-btn" onclick="showView('cart')">View Cart</button>
            </div>
          ` : '<p>Your cart is empty</p>'}
        </div>
        
        <div class="panel">
          <h2>Order History</h2>
          ${orderHistory.length > 0 ? `
            <div class="order-history">
              ${orderHistory.map((order, index) => `
                <div class="order-item">
                  <h4>Order #${order.id || index + 1}</h4>
                  <p><strong>Date:</strong> ${new Date(order.date).toLocaleDateString()}</p>
                  <p><strong>Total:</strong> ${order.total}$</p>
                  <p><strong>Items:</strong> ${order.items.length}</p>
                  <div class="order-items">
                    ${order.items.map(item => `
                      <div class="order-product">
                        <img src="${item.image}" alt="${item.name}" />
                        <div>
                          <p>${item.name}</p>
                          <p>Qty: ${item.quantity} × ${(item.price / 100).toFixed(2)}$</p>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<p>No orders yet</p>'}
        </div>
      </div>
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
