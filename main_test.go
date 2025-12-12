package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/docker/go-connections/nat"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

var testServer *httptest.Server

// ----------- SETUP TEST POSTGRES + SERVER -----------

func TestMain(m *testing.M) {
	ctx := context.Background()
	req := testcontainers.ContainerRequest{
		Image:        "postgres:15",
		Env:          map[string]string{"POSTGRES_USER": "shop", "POSTGRES_PASSWORD": "shop", "POSTGRES_DB": "shopdb"},
		ExposedPorts: []string{"5432/tcp"},
		WaitingFor: wait.ForSQL("5432/tcp", "postgres", func(host string, port nat.Port) string {
			return fmt.Sprintf("postgres://shop:shop@%s:%s/shopdb?sslmode=disable", host, port.Port())
		}),
	}

	pg, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		panic(err)
	}

	host, _ := pg.Host(ctx)
	port, _ := pg.MappedPort(ctx, "5432")

	os.Setenv("DATABASE_URL", "postgres://shop:shop@"+host+":"+port.Port()+"/shopdb?sslmode=disable")

	// стартуем API
	initServer()

	code := m.Run()

	pg.Terminate(ctx)
	os.Exit(code)
}

// запуск тестового API-сервера
func initServer() {
	// создаём реальную бд
	var err error
	db, err = sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		panic(err)
	}
	if err := runMigrationsAndSeed(); err != nil {
		panic(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", catalogHandler)
	mux.HandleFunc("/register", registerHandler)
	mux.HandleFunc("/login", loginHandler)
	mux.HandleFunc("/profile", profileHandler)
	mux.HandleFunc("/admin", adminHandler)
	mux.HandleFunc("/proxy", ssrfProxyHandler)
	mux.HandleFunc("/preview", previewHandler)
	mux.HandleFunc("/admin/add_product", adminAddProductHandler)
	mux.HandleFunc("/image", imageFetchHandler)

	testServer = httptest.NewServer(mux)
}

// helper
func post(path string, body string) *http.Response {
	resp, _ := http.Post(testServer.URL+path, "application/x-www-form-urlencoded", bytes.NewBufferString(body))
	return resp
}

func get(path string, cookies ...*http.Cookie) *http.Response {
	req, _ := http.NewRequest("GET", testServer.URL+path, nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, _ := http.DefaultClient.Do(req)
	return resp
}

// -------------------- TESTS --------------------

func TestCatalog(t *testing.T) {
	resp := get("/")
	if resp.StatusCode != 200 {
		t.Fatal("catalog should work")
	}
	var list []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&list)
	if len(list) == 0 {
		t.Fatal("catalog empty, seed failed")
	}
	fmt.Println(list)
}

func TestRegisterAndLogin(t *testing.T) {
	// регистрация
	resp := post("/register", "email=test@go.com&password=123")
	if resp.StatusCode != 200 {
		t.Fatal("register failed")
	}

	// обычный логин
	resp = post("/login", "email=test@go.com&password=123")
	if resp.StatusCode != 200 {
		t.Fatal("login failed")
	}

	// проверяем cookie
	if len(resp.Cookies()) == 0 {
		t.Fatal("login did not set cookie")
	}
}

func TestSQLInjectionBypass(t *testing.T) {
	// SQLi атаковать логин
	// email = ' OR 1=1 --
	resp := post("/login", "email=' OR 1=1 --&password=abc")

	// если запрос уязвим — сервер войдёт под первого пользователя
	if resp.StatusCode != 200 {
		t.Fatal("SQL injection should bypass login, but did not")
	}

	if len(resp.Cookies()) == 0 {
		t.Fatal("SQL injection did not set session cookie")
	}
}

func TestProfile(t *testing.T) {
	// логин
	resp := post("/login", "email=admin@shop.local&password=admin123")
	cookie := resp.Cookies()[0]

	resp = get("/profile", cookie)
	if resp.StatusCode != 200 {
		t.Fatal("profile auth failed")
	}
}

func TestAdminAccess(t *testing.T) {
	// логин как админ
	resp := post("/login", "email=admin@shop.local&password=admin123")
	cookie := resp.Cookies()[0]

	resp = get("/admin", cookie)
	data, _ := io.ReadAll(resp.Body)

	if !strings.Contains(string(data), "ADMIN PANEL") {
		t.Fatal("admin page should work")
	}
}

func TestAdminForbidden(t *testing.T) {
	resp := post("/login", "email=alice@example.com&password=alicepass")
	cookie := resp.Cookies()[0]

	resp = get("/admin", cookie)
	if resp.StatusCode != 403 {
		t.Fatal("non-admin should NOT access admin panel")
	}
}

func TestReflectedXSS(t *testing.T) {
	xss := "<script>alert(1)</script>"
	resp := get("/preview?text=" + xss)
	body, _ := io.ReadAll(resp.Body)

	if !strings.Contains(string(body), xss) {
		t.Fatal("XSS not reflected — previewHandler escaped output")
	}
}

func TestSSRF(t *testing.T) {
	// используем httpbin (или любой публичный echo endpoint)
	resp := get("/proxy?url=https://httpbin.org/get")

	if resp.StatusCode != 200 {
		t.Fatal("SSRF proxy should fetch external URLs")
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"url":`) {
		t.Fatal("SSRF proxy did not return body")
	}
}

// ------------------------------------------------------------
// NEW TESTS FOR ADD_PRODUCT & IMAGE SSRF
// ------------------------------------------------------------

// 1) Admin can add product
func TestAdminCanAddProduct(t *testing.T) {
	// login admin
	resp := post("/login", "email=admin@shop.local&password=admin123")
	if resp.StatusCode != 200 {
		t.Fatal("admin login failed")
	}
	cookie := resp.Cookies()[0]

	body := "name=HackShirt&description=hax&price_cents=777&image_url=http://evil.com/img.png"
	req, _ := http.NewRequest("POST", testServer.URL+"/admin/add_product", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(cookie)

	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 200 {
		t.Fatalf("admin add_product failed: %d", resp.StatusCode)
	}
	bodyBytes, _ := io.ReadAll(resp.Body)
	fmt.Println("Response body:", string(bodyBytes))

	// verify in DB
	var cnt int
	err := db.QueryRow(`SELECT COUNT(*) FROM products WHERE name='HackShirt'`).Scan(&cnt)
	if err != nil || cnt == 0 {
		t.Fatal("product was NOT inserted into DB")
	}
}

// 2) Non-admin cannot add product
func TestNonAdminAddProductForbidden(t *testing.T) {
	// login regular user
	resp := post("/login", "email=alice@example.com&password=alicepass")
	if resp.StatusCode != 200 {
		t.Fatal("user login failed")
	}
	cookie := resp.Cookies()[0]

	body := "name=BadShirt&description=xxx&price_cents=500&image_url=http://evil"
	req, _ := http.NewRequest("POST", testServer.URL+"/admin/add_product", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(cookie)

	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 403 {
		t.Fatalf("non-admin should not be able to add products, got %d", resp.StatusCode)
	}
}

// 3) Catalog returns products whose image is wrapped in /image?url=
func TestCatalogImageProxyIntegration(t *testing.T) {
	resp := get("/")
	if resp.StatusCode != 200 {
		t.Fatal("catalog failed")
	}

	var items []map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&items)

	if len(items) == 0 {
		t.Fatal("seed products missing")
	}

	img := items[0]["image_url"].(string)

	if !strings.HasPrefix(img, "/image?url=") {
		t.Fatalf("catalog did not wrap image_url via /image?url=, got: %s", img)
	}
}

// 4) /image?url= triggers real SSRF through /proxy
func TestImageHandlerTriggersSSRF(t *testing.T) {
	// Мы поднимаем локальный echo-сервер внутри теста,
	// чтобы заставить /image → /proxy сделать запрос к нему.
	echo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("INTERNAL_OK"))
	}))
	defer echo.Close()

	// encode echo URL
	target := "/image?url=" + echo.URL

	resp := get(target)
	if resp.StatusCode != 200 {
		t.Fatalf("/image failed: %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "INTERNAL_OK") {
		t.Fatal("/image did NOT perform SSRF request")
	}
}

// 5) /image should accept arbitrary internal IP (true SSRF)
func TestImageSSRFToInternalNetwork(t *testing.T) {
	// создаём фейковый internal endpoint
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("SECRET_INTERNAL_SERVICE"))
	}))
	defer internal.Close()

	resp := get("/image?url=" + internal.URL)
	if resp.StatusCode != 200 {
		t.Fatal("internal SSRF request failed")
	}

	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "SECRET_INTERNAL_SERVICE") {
		t.Fatal("SSRF through /image did not reach internal endpoint")
	}
}
