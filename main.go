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

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    total_cents INT NOT NULL,
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
			('T-Shirt', 'Simple cotton t-shirt', 1999, 'http://example.com/tshirt.png'),
			('Jeans', 'Blue jeans', 4999, 'http://example.com/jeans.png')
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
