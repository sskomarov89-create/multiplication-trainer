# Project Map

- `PRODUCT.md` — цель, пользователь и правила.
- `ARCHITECTURE.md` — backend, identity, persistence и security.
- `DECISIONS.md` — ключевые продуктовые и технические решения.
- `server.py` — static server, JSON API, SQLite schema и business transitions.
- `data/` — runtime SQLite data; не хранится в Git.
- `index.html` — профиль, welcome, training, round result и progress dialogs.
- `styles.css` — mobile-first visual system.
- `src/core.js` — генерация примеров и shared browser calculations.
- `src/app.js` — sessions, API client, rounds и rendering.
- `tests/test_server.py` — profile/round domain tests.
- `tests/test_api.py` — HTTP/API и static exposure integration tests.
- `tests/core.test.js` — client domain tests.
- `tests/static.test.js` — PWA contract tests.
- `tests/uat.mjs` — mobile/desktop browser acceptance.
- `manifest.webmanifest`, `service-worker.js`, `assets/` — PWA shell.
