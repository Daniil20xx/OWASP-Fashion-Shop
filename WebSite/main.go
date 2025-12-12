package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	_ "github.com/lib/pq"
)

var db *sql.DB

func main() {
	var err error

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL not set")
	}

	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatal(err)
	}

	if err := db.Ping(); err != nil {
		log.Fatal("cannot connect to db:", err)
	}

	if err := runMigrationsAndSeed(); err != nil {
		log.Fatal(err)
	}

	// Serve frontend SPA (static files) under /app/ without changing existing API routes.
	// static/index.html, static/app.js, static/styles.css
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/app/", http.StripPrefix("/app/", fs))

	http.HandleFunc("/", catalogHandler)
	http.HandleFunc("/register", registerHandler)
	http.HandleFunc("/login", loginHandler) // SQL Injection
	http.HandleFunc("/profile", profileHandler)
	http.HandleFunc("/admin", adminHandler)
	http.HandleFunc("/proxy", ssrfProxyHandler) // SSRF
	http.HandleFunc("/preview", previewHandler) // Reflected XSS
	http.HandleFunc("/admin/add_product", adminAddProductHandler)
	http.HandleFunc("/image", imageFetchHandler)
	http.HandleFunc("/local-image", localImageHandler)
	http.HandleFunc("/cart", cartHandler)
	http.HandleFunc("/cart/add", addToCartHandler)
	http.HandleFunc("/cart/remove", removeFromCartHandler)
	http.HandleFunc("/checkout", checkoutHandler)
	http.HandleFunc("/orders", ordersHandler)
	http.HandleFunc("/logout", logoutHandler)
	http.HandleFunc("/auth/status", authStatusHandler)

	log.Println("Vulnerable Shop API running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

// ---------------- MIGRATIONS ----------------

func runMigrationsAndSeed() error {
	schema := `
		CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			is_admin BOOLEAN NOT NULL DEFAULT FALSE
		);

		CREATE TABLE IF NOT EXISTS products (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT,
			price_cents INT NOT NULL,
			image_url TEXT
		);

		CREATE TABLE IF NOT EXISTS cart (
			id SERIAL PRIMARY KEY,
			user_id INT NOT NULL REFERENCES users(id),
			product_id INT NOT NULL REFERENCES products(id),
			quantity INT NOT NULL DEFAULT 1,
			created_at TIMESTAMP DEFAULT NOW(),
			UNIQUE(user_id, product_id)
		);

		CREATE TABLE IF NOT EXISTS orders (
			id SERIAL PRIMARY KEY,
			user_id INT NOT NULL REFERENCES users(id),
			total_cents INT NOT NULL,
			created_at TIMESTAMP DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS order_items (
			id SERIAL PRIMARY KEY,
			order_id INT NOT NULL REFERENCES orders(id),
			product_id INT NOT NULL REFERENCES products(id),
			quantity INT NOT NULL,
			price_cents INT NOT NULL,
			created_at TIMESTAMP DEFAULT NOW()
		);
	`

	_, err := db.Exec(schema)
	if err != nil {
		return err
	}

	// Seed users
	var cnt int
	_ = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&cnt)
	if cnt == 0 {
		_, err = db.Exec(`
			INSERT INTO users (email, password, is_admin) VALUES
			('admin@shop.local', 'admin123', true),
			('alice@example.com', 'alicepass', false)
		`)
		if err != nil {
			return err
		}
	}

	// Seed products
	_ = db.QueryRow("SELECT COUNT(*) FROM products").Scan(&cnt)
	if cnt == 0 {
		_, err = db.Exec(`
			INSERT INTO products (name, description, price_cents, image_url) VALUES
			('Faded Jeans', 'Classic Faded Jeans for everyday wear', 6300, 'http://localhost:8080/local-image?id=1'),
			('Black Jeans', 'Classic Black Jeans for everyday wear', 7200, 'http://localhost:8080/local-image?id=2'),
			('CHOCOOLATE Shoulder Tee', 'Shoulder Tee (NOT WHITE)', 5999, 'http://localhost:8080/local-image?id=3'),
			('CHOCOOLATE_T-shirt', 'T-shirt (Chocoolate) with title', 3690, 'http://localhost:8080/local-image?id=4'),
			('Casual Solid Drop Shoulder Tee', 'White and 100% Cotton', 5500, 'http://localhost:8080/local-image?id=5')
		`)
		if err != nil {
			return err
		}
	}

	return nil
}

// ---------------- HANDLERS ----------------

// Catalog
func catalogHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, name, description, price_cents, image_url FROM products")
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	type P struct {
		ID          int    `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		PriceCents  int    `json:"price_cents"`
		ImageURL    string `json:"image_url"`
	}

	var out []P
	for rows.Next() {
		var p P
		rows.Scan(&p.ID, &p.Name, &p.Description, &p.PriceCents, &p.ImageURL)
		// переписываем URL чтобы всегда шёл через SSRF
		p.ImageURL = "/image?url=" + p.ImageURL
		out = append(out, p)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

// Register (no SQLi)
func registerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST required", 405)
		return
	}
	email := r.FormValue("email")
	password := r.FormValue("password")
	if email == "" || password == "" {
		http.Error(w, "missing email/password", 400)
		return
	}

	_, err := db.Exec("INSERT INTO users (email, password) VALUES ($1, $2)", email, password)
	if err != nil {
		http.Error(w, "cannot register: "+err.Error(), 500)
		return
	}

	w.Write([]byte("registered"))
}

// LOGIN — intentionally vulnerable to SQL injection
func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}

	email := r.FormValue("email")
	password := r.FormValue("password")

	// ⚠ SQL Injection (dangerous)
	query := fmt.Sprintf(
		"SELECT id, is_admin FROM users WHERE email = '%s' AND password = '%s' LIMIT 1",
		email,
		password,
	)

	var id int
	var isAdmin bool
	err := db.QueryRow(query).Scan(&id, &isAdmin)
	if err != nil {
		http.Error(w, "invalid credentials", 401)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:  "user_id",
		Value: strconv.Itoa(id),
		Path:  "/",
	})

	w.Write([]byte("ok"))
}

// Profile
func profileHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}

	uid, _ := strconv.Atoi(c.Value)

	var email string
	var isAdmin bool

	err = db.QueryRow("SELECT email, is_admin FROM users WHERE id=$1", uid).Scan(&email, &isAdmin)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}

	resp := map[string]interface{}{
		"id":       uid,
		"email":    email,
		"is_admin": isAdmin,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Admin
func adminHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}

	uid, _ := strconv.Atoi(c.Value)

	var isAdmin bool
	var email string
	err = db.QueryRow("SELECT email, is_admin FROM users WHERE id=$1", uid).Scan(&email, &isAdmin)
	if err != nil {
		http.Error(w, "not found", 404)
		return
	}
	if !isAdmin {
		http.Error(w, "forbidden", 403)
		return
	}

	w.Write([]byte("ADMIN PANEL\n"))
	w.Write([]byte("Welcome " + email + "\n"))
	w.Write([]byte("SECRET_KEY = TOP-SECRET\n"))
}

// SSRF
func ssrfProxyHandler(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "missing url", 400)
		return
	}

	// ⚠ SSRF — no validation
	resp, err := http.Get(target)
	if err != nil {
		http.Error(w, "fetch error: "+err.Error(), 500)
		return
	}
	defer resp.Body.Close()

	for k, vals := range resp.Header {
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}

	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// Reflected XSS
func previewHandler(w http.ResponseWriter, r *http.Request) {
	text := r.URL.Query().Get("text")
	w.Header().Set("Content-Type", "text/html")
	// ⚠ no escaping — reflected XSS
	fmt.Fprintf(w, "<h1>Preview</h1><div>%s</div>", text)
}

// Admin adds new product (SSRF entry point)
func adminAddProductHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}

	uid, _ := strconv.Atoi(c.Value)

	var isAdmin bool
	err = db.QueryRow("SELECT is_admin FROM users WHERE id=$1", uid).Scan(&isAdmin)
	if err != nil || !isAdmin {
		http.Error(w, "forbidden", 403)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "POST required", 405)
		return
	}

	name := r.FormValue("name")
	desc := r.FormValue("description")
	price := r.FormValue("price_cents")
	img := r.FormValue("image_url") // ⚠ пользователю можно указать любой URL (SSRF vector)

	_, err = db.Exec(
		"INSERT INTO products (name, description, price_cents, image_url) VALUES ($1, $2, $3, $4)",
		name, desc, price, img,
	)
	if err != nil {
		http.Error(w, "db error: "+err.Error(), 500)
		return
	}

	w.Write([]byte("product added"))
}

// imageFetcher – fetch image using SSRF proxy
func imageFetchHandler(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		http.Error(w, "missing url", 400)
		return
	}

	// вместо прямой загрузки — дергаем внутренний SSRF эндпоинт
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	proxyURL := scheme + "://" + r.Host + "/proxy?url=" + url

	resp, err := http.Get(proxyURL)
	if err != nil {
		http.Error(w, "proxy err: "+err.Error(), 500)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	io.Copy(w, resp.Body)
}

// Local Images
func localImageHandler(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id parameter", 400)
		return
	}

	for _, c := range id {
		if c < '0' || c > '9' {
			http.Error(w, "invalid id", 400)
			return
		}
	}

	filePath := fmt.Sprintf("static/images/%s.jpg", id)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		filePath = fmt.Sprintf("static/images/%s.png", id)
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			http.Error(w, "image not found", 404)
			return
		}
	}

	http.ServeFile(w, r, filePath)
}

// ------------------- НОВЫЕ ХЕНДЛЕРЫ ДЛЯ КОРЗИНЫ -------------------

// Получить корзину пользователя
func cartHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}
	uid, _ := strconv.Atoi(c.Value)

	rows, err := db.Query(`
        SELECT c.id, p.id as product_id, p.name, p.price_cents, p.image_url, c.quantity 
        FROM cart c 
        JOIN products p ON c.product_id = p.id 
        WHERE c.user_id = $1
    `, uid)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	type CartItem struct {
		ID        int    `json:"id"`
		ProductID int    `json:"product_id"`
		Name      string `json:"name"`
		Price     int    `json:"price_cents"`
		ImageURL  string `json:"image_url"`
		Quantity  int    `json:"quantity"`
	}

	var items []CartItem
	for rows.Next() {
		var item CartItem
		rows.Scan(&item.ID, &item.ProductID, &item.Name, &item.Price, &item.ImageURL, &item.Quantity)
		items = append(items, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// Добавить товар в корзину
func addToCartHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}
	uid, _ := strconv.Atoi(c.Value)

	productID := r.FormValue("product_id")
	if productID == "" {
		http.Error(w, "missing product_id", 400)
		return
	}
	pid, _ := strconv.Atoi(productID)

	// Проверяем существует ли товар
	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = $1)", pid).Scan(&exists)
	if err != nil || !exists {
		http.Error(w, "product not found", 404)
		return
	}

	// Добавляем или обновляем количество
	_, err = db.Exec(`
        INSERT INTO cart (user_id, product_id, quantity) 
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, product_id) 
        DO UPDATE SET quantity = cart.quantity + 1
    `, uid, pid)

	if err != nil {
		http.Error(w, "db error: "+err.Error(), 500)
		return
	}

	w.Write([]byte("added to cart"))
}

// Удалить товар из корзины
func removeFromCartHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}
	uid, _ := strconv.Atoi(c.Value)

	cartID := r.FormValue("cart_id")
	if cartID == "" {
		http.Error(w, "missing cart_id", 400)
		return
	}
	cid, _ := strconv.Atoi(cartID)

	// Проверяем, что товар принадлежит пользователю
	_, err = db.Exec("DELETE FROM cart WHERE id = $1 AND user_id = $2", cid, uid)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}

	w.Write([]byte("removed from cart"))
}

// Оформить заказ
func checkoutHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}
	uid, _ := strconv.Atoi(c.Value)

	// Рассчитываем общую сумму
	var totalCents int
	err = db.QueryRow(`
        SELECT COALESCE(SUM(p.price_cents * c.quantity), 0) 
        FROM cart c 
        JOIN products p ON c.product_id = p.id 
        WHERE c.user_id = $1
    `, uid).Scan(&totalCents)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}

	if totalCents == 0 {
		http.Error(w, "cart is empty", 400)
		return
	}

	// Создаём заказ
	var orderID int
	err = db.QueryRow(`
        INSERT INTO orders (user_id, total_cents) 
        VALUES ($1, $2) 
        RETURNING id
    `, uid, totalCents).Scan(&orderID)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}

	// Копируем товары из корзины в order_items
	_, err = db.Exec(`
        INSERT INTO order_items (order_id, product_id, quantity, price_cents)
        SELECT $1, c.product_id, c.quantity, p.price_cents
        FROM cart c 
        JOIN products p ON c.product_id = p.id 
        WHERE c.user_id = $2
    `, orderID, uid)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}

	// Очищаем корзину
	_, err = db.Exec("DELETE FROM cart WHERE user_id = $1", uid)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}

	resp := map[string]interface{}{
		"order_id":    orderID,
		"total_cents": totalCents,
		"message":     "Order placed successfully!",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Получить историю заказов
func ordersHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		http.Error(w, "not logged in", 401)
		return
	}
	uid, _ := strconv.Atoi(c.Value)

	rows, err := db.Query(`
        SELECT o.id, o.total_cents, o.created_at 
        FROM orders o 
        WHERE o.user_id = $1 
        ORDER BY o.created_at DESC
    `, uid)
	if err != nil {
		http.Error(w, "db error", 500)
		return
	}
	defer rows.Close()

	type Order struct {
		ID         int       `json:"id"`
		TotalCents int       `json:"total_cents"`
		CreatedAt  time.Time `json:"created_at"`
	}

	var orders []Order
	for rows.Next() {
		var o Order
		rows.Scan(&o.ID, &o.TotalCents, &o.CreatedAt)
		orders = append(orders, o)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orders)
}

// Logout
func logoutHandler(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:    "user_id",
		Value:   "",
		Path:    "/",
		MaxAge:  -1, // Удалить cookie
		Expires: time.Now().Add(-1 * time.Hour),
	})
	w.Write([]byte("logged out"))
}

// Check auth status
func authStatusHandler(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("user_id")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": false,
			"user_id":       nil,
			"is_admin":      false,
		})
		return
	}

	uid, _ := strconv.Atoi(c.Value)
	var email string
	var isAdmin bool

	err = db.QueryRow("SELECT email, is_admin FROM users WHERE id=$1", uid).
		Scan(&email, &isAdmin)

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"authenticated": false,
			"user_id":       nil,
			"is_admin":      false,
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"authenticated": true,
		"user_id":       uid,
		"email":         email,
		"is_admin":      isAdmin,
	})
}
