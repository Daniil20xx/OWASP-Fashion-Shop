# OWASP-Fashion-Shop
A training web application “Clothing Store” on Go with three intentional OWASP vulnerabilities: SQL Injection, Reflected XSS and SSRF. The application is run in Docker, secure PoC exploits are created for each vulnerability, the causes of the problems are analyzed and recommendations on how to fix them are given.

### Struct of project:
```
OWASP-Fashion-Shop/
|--- WebSite
|---|--- main.go
|---|--- docker-compose.yaml
|---|--- Dockerfile
|---|--- go.mod
|---|--- go.sum
|---|--- README_backend.md
|---|--- static/
|---|---|---app.js
|---|---|---index.html
|---|---|---style.css
|---|---|---images - images.png [1-5]
|--- Exploit
|---|--- SSRF.py
|---|--- SQL Injection Payload.txt
|---|--- XSS/
|---|---|--- payload.txt
|---|---|--- evil.py
|--- README.md
```

### How to start:

Server (Site script):
``` bash
cd WebSite
docker compose up -d
```

XSS attack:
``` bash
cd Exploit/XSS/
python evil.py
```

SSRF attack
``` bash
cd Exploit/
python SSRF.py
```

### Default credentials:
Email | Password | Role
-|-|-
admin@shop.local | admin123 | admin
alice@example.com | alicepass | User

### Application Features:
- Product catalog - view and add to cart
- User Profile - account management
- Shopping cart - making orders
- Admin panel - adding products (for administrators only)
- Sandbox attacks - demonstration of vulnerabilities
