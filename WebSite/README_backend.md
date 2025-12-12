Vulnerable Shop API — Documentation

**Overview**
- **Purpose**: Учебный бэкенд магазина с намеренно оставленными уязвимостями для обучения: SQL-injection (login), Reflected XSS (preview), SSRF (proxy/image flow).
- **Language**: Go
- **Entry point**: `main.go`
- **DB**: PostgreSQL (env: `DATABASE_URL`). Tests use Testcontainers to spawn Postgres.

**Quick start (developer)**
- **Run tests**: `go test ./... -v` (требует установленный `go` и работающий `docker` для testcontainers)
- **Run locally** (requires `DATABASE_URL` pointing to a running Postgres):

```
export DATABASE_URL="postgres://user:pass@host:5432/dbname?sslmode=disable"
go run main.go
```

**High-level architecture**
- `runMigrationsAndSeed()` — создаёт таблицы и первичную seed-дату (admin и пользователь, пара товаров).
- HTTP handlers (все в `main.go`) — описаны ниже.
- `ssrfProxyHandler` — делает `http.Get(target)` напрямую по URL из запроса (уязвимость SSRF).
- `imageFetchHandler` — для загрузки изображений делает внутренний запрос к `/proxy?url=...`, т.е. сервер будет сам запрашивать указанный URL (посредник для SSRF).

**Endpoints (полный список)**
- **`GET /`** — Catalog
  - **Что возвращает**: JSON-массив товаров. Каждый товар содержит `id`, `name`, `description`, `price_cents`, `image_url`.
  - **Особенность**: `image_url` переписывается как `/image?url=<original>` — браузер/фронтенд должен использовать этот URL для показа картинки.
  - **Пример ответа**:
    ```json
    [
      {"id":1,"name":"T-Shirt","description":"Simple cotton t-shirt","price_cents":1999,"image_url":"/image?url=http://example.com/tshirt.png"},
      ...
    ]
    ```

- **`POST /register`** — Register
  - **Параметры (form-urlencoded)**: `email`, `password`
  - **Поведение**: создаёт запись в `users` (использует параметризованный `INSERT`, безопасно).
  - **Успех**: возвращает `registered` (200).

- **`POST /login`** — Login (НАМЕРЕННО УЯЗВИМЫЙ)
  - **Параметры (form-urlencoded)**: `email`, `password`
  - **Важное**: реализация использует `fmt.Sprintf` и подставляет значения в SQL напрямую — это даёт возможность SQL Injection. Пример полезной нагрузки для bypass: `email=' OR 1=1 --`.
  - **Поведение при успехе**: устанавливает cookie `user_id` со значением id пользователя (plain integer). Cookie без флагов `HttpOnly`/`Secure`/`SameSite`.
  - **Пример использования (frontend)**:
    ```js
    // form-encoded POST
    fetch('/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'email=test@go.com&password=123',
      credentials: 'include' // чтобы браузер сохранил cookie
    })
    ```

- **`GET /profile`** — Profile
  - **Auth**: ожидает cookie `user_id`. По нему делает запрос в БД и возвращает JSON с `id`, `email`, `is_admin`.
  - **Пример**:
    ```js
    fetch('/profile', {credentials: 'include'}).then(r=>r.json()).then(console.log)
    ```

- **`GET /admin`** — Admin panel
  - **Auth**: cookie `user_id`. Проверяет, что у пользователя `is_admin=true`. Если нет — возвращает `403`.
  - **Важное**: в теле страницы возвращается строка `SECRET_KEY = TOP-SECRET` — пример чувствительной информации, доступной только администраторам.

- **`POST /admin/add_product`** — Admin adds product (SSRF entry point)
  - **Auth**: только admin (проверка по cookie `user_id` и флагу `is_admin` в БД).
  - **Параметры (form-urlencoded)**: `name`, `description`, `price_cents`, `image_url`.
  - **Поведение**: вставляет новую запись в таблицу `products`. `image_url` сохраняется как указано — может быть любой URL.
  - **Frontend примечание**: админский UI может отправлять форму с `image_url`. В учебном проекте это демонстрирует как админ может невольно добавить SSRF-вектор.

- **`GET /proxy?url=<target>`** — SSRF proxy (НАМЕРЕННО УЯЗВИМЫЙ)
  - **Параметр**: `url` — любой URL.
  - **Поведение**: делает `http.Get(target)` и проксирует заголовки и тело обратно клиенту. Никакой проверки host/IP не делается.
  - **Риск**: сервер может быть использован для доступа к внутренним сервисам (metadata, внутренние API, localhost и т.д.).
  - **Frontend**: В обычном фронтенде вы не должны вызывать `/proxy` с непроверенным URL. В проекте `/image` делает это автоматически.

- **`GET /image?url=<target>`** — Image fetcher (используется в каталоге)
  - **Параметр**: `url` — исходный URL изображения.
  - **Поведение**: формирует внутренний URL `scheme://<r.Host>/proxy?url=<target>` и делает запрос к нему; возвращает контент и `Content-Type` как пришло.
  - **Frontend use**: в каталоге `image_url` уже переписан: используйте `<img src="/image?url=...">` для отображения картинок.
  - **Важно**: через этот эндпоинт можно вызвать внутренние URL — реальный SSRF в связке с `admin/add_product`.

- **`GET /preview?text=<text>`** — Reflected XSS (НАМЕРЕННО УЯЗВИМЫЙ)
  - **Параметр**: `text`
  - **Поведение**: возвращает HTML с неэкранированным `text` внутри `<div>` — отражённая XSS.
  - **Frontend**: Не вставляйте непроверённый `text` как HTML на странице. Для демонстрации учебного примера фронтенд может просто ссылаться на `/preview?text=...`.

**Как фронтендеру использовать ручки — примеры**
- Получить каталог и отобразить товары:
  - Fetch JSON с `GET /`.
  - Для каждой записи используйте полученный `image_url` (он будет выглядеть как `/image?url=http://...`) в теге `<img>`.
  - Пример (vanilla JS):
    ```js
    fetch('/').then(r=>r.json()).then(items => {
      items.forEach(item => {
        const img = document.createElement('img');
        img.src = item.image_url; // /image?url=...
        document.body.appendChild(img);
      });
    });
    ```

- Регистрация и вход:
  - Для `POST /register` и `POST /login` используйте `Content-Type: application/x-www-form-urlencoded`.
  - Важно: у `login` cookie выставляется сервером (`user_id`), поэтому при запросах с клиента используйте `credentials: 'include'`.
  - Пример логина (fetch):
    ```js
    fetch('/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: 'email=admin@shop.local&password=admin123',
      credentials: 'include'
    }).then(resp => { /* проверить статус */ })
    ```

- Проверка админки и добавление товара (на стороне фронтенда):
  - Сначала залогиньтесь админом (см. выше).
  - Затем отправьте `POST /admin/add_product` с form-encoded полями. Пример:
    ```js
    fetch('/admin/add_product', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      credentials: 'include',
      body: 'name=New&description=Hi&price_cents=1000&image_url=http://evil.com/p.png'
    })
    ```
  - Сервер ответит `product added` при успехе.

**Security notes (важно для фронтенда и преподавателя)**
- Этот проект намеренно содержит уязвимости для обучения:
  - **SQLi**: `POST /login` — не используйте такое в реальном приложении. Для демонстрации можно показать, как payload `email=' OR 1=1 --` даёт вход.
  - **Reflected XSS**: `GET /preview` — отражает пользовательский ввод без экранирования. На фронтенде демонстрируйте на изолированном окружении.
  - **SSRF**: `GET /proxy` и поток `/admin/add_product` → `/image` → `/proxy` позволяют проводить SSRF — потенциально доступ к внутренним сервисам.
- Рекомендации для безопасной frontend-разработки (если захотите убрать уязвимости):
  - Не генерировать HTML с непроверяемым вводом; использовать `textContent`/шаблоны.
  - Не позволять пользователям указывать произвольные URL для загрузки контента; используйте белые списки.
  - Не передавать конфиденциальные токены в URL-параметрах.

**Dev notes / тестирование**
- Тесты расположены в `main_test.go` и используют `testcontainers` для поднятия Postgres (Docker должен быть доступен).
- Если у вас не запускается `go test` из-за отсутствия toolchain в CI/окружении — установите `go` и `docker`.

**Where to look in code**
- `main.go` — основной файл с handler-ами и миграциями.
- `main_test.go` — интеграционные тесты, которые демонстрируют кейсы (включая тесты для SSRF через `/image`).

**Примеры вызовов (curl)**
- Login (form-encoded):
```
curl -v -X POST -d "email=admin@shop.local&password=admin123" -c cookies.txt http://localhost:8080/login
```
- Get catalog:
```
curl -v http://localhost:8080/
```
- Preview XSS (демонстрация):
```
curl -v "http://localhost:8080/preview?text=<script>alert(1)</script>"
```

**Вопросы/дальше**
- Хотите, чтобы я подготовил отдельную «безопасную» ветку с фиксами (параметризованный `login`, экранирование `preview`, SSRF-ограничения), или оставить уязвимости как есть для обучения?
- Нужны ли вам готовые фронтенд-страницы (простая SPA) для демонстрации уязвимостей в браузере?

---
Файл документации создан как `README.md` в корне репозитория.