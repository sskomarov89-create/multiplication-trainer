# Architecture

## Решение
Минимальный монолит без framework-зависимостей:

- `server.py` — Python stdlib HTTP server, same-origin JSON API и SQLite persistence;
- `index.html`, `styles.css`, `src/app.js` — mobile-first PWA UI;
- `src/core.js` — генерация примеров и чистая клиентская математика;
- `data/multiplication-trainer.sqlite3` — operational state;
- `service-worker.js` — только статический app shell; `/api/*` никогда не кэшируется.

## Идентичность
При регистрации сервер проверяет нормализованное имя с уникальным `name_key`. Клиент получает случайный session token; в БД хранится только SHA-256 hash. На устройстве можно сохранить несколько token-профилей и переключаться между ними.

Это device-bound вход, а не password authentication: восстановление на новом устройстве без token не предусмотрено.

## Данные
SQLite хранит профиль, global counters, отдельные `ranked_stars`, текущий раунд, завершённые раунды, weak pairs и idempotency results по `submission_id`.

Запись ответа выполняется в `BEGIN IMMEDIATE` transaction. Десятый ответ атомарно фиксирует round result и открывает следующий раунд.

## Награды и рейтинг
Статусы и значки вычисляются детерминированно из server state, отдельные таблицы наград не нужны. `GET /api/leaderboard` требует session token и возвращает top-10 плюс личную позицию. Сортировка: `ranked_stars DESC`, accuracy DESC, best streak DESC, затем стабильный порядок создания. При миграции существующей server DB текущие звёзды становятся рейтинговыми; клиентский импорт старого localStorage не увеличивает `ranked_stars`.

## Security
- API и статика работают с одного origin;
- токены передаются в `Authorization: Bearer`;
- исходники backend, tests, `.git` и каталог `data` не раздаются HTTP-сервером;
- SQLite-файл исключён из Git;
- destructive reset действует только на профиль из session token.

## Smart practice
Ошибочные пары получают небольшой ограниченный дополнительный вес. Все комбинации 1×1–10×10 остаются достижимыми.
