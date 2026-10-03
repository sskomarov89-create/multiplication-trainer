# Умножайка

Детская PWA-тренировка таблицы умножения с глобально уникальными игровыми именами, раздельным прогрессом, раундами по 10 примеров, значками, статусами и общим рейтингом.

## Локальный запуск

Требуются Python 3 и Node.js 20+ (Node нужен только для tests/UAT).

```bash
npm install
npm test
npm run serve
```

Откройте `http://localhost:4173`.

Backend и static frontend запускаются одной командой. SQLite автоматически создаётся в `data/multiplication-trainer.sqlite3`.

## Проверка

При уже запущенном приложении:

```bash
npm test
npm run uat
```

Для другого адреса используйте `UAT_BASE_URL=http://127.0.0.1:4174 npm run uat`.

## Данные и backup

Все профили, раунды и прогресс находятся в `data/multiplication-trainer.sqlite3`. Для backup остановите приложение и скопируйте этот файл вместе с возможными `-wal`/`-shm`, либо используйте SQLite backup API.

Браузер хранит только session tokens известных на этом устройстве. Сервер хранит их SHA-256 hashes.

## Deployment

Текущий production URL проксирует Tailscale Funnel на `127.0.0.1:4173`. Для обновления: прогнать tests, перезапустить `python3 server.py --port 4173`, затем проверить `/healthz` и основной user flow.

Для установки на iPhone откройте HTTPS-адрес в Safari → «Поделиться» → «На экран “Домой”».
