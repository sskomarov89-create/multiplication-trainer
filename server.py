#!/usr/bin/env python3
"""Small same-origin API and static server for Умножайка."""

from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT / "data" / "multiplication-trainer.sqlite3"
ROUND_SIZE = 10
MAX_COUNTER = 1_000_000
GRADE_TIERS = (
    (0, "Искатель", "◇"),
    (10, "Знаток", "★"),
    (25, "Суперсчётчик", "✦"),
    (50, "Мастер", "◆"),
    (100, "Легенда", "♛"),
)


class InvalidNameError(ValueError):
    pass


class NameTakenError(ValueError):
    def __init__(self, suggestions: list[str]):
        super().__init__("name_taken")
        self.suggestions = suggestions


class InvalidTokenError(ValueError):
    pass


class InvalidAnswerError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def safe_counter(value: Any, maximum: int = MAX_COUNTER) -> int:
    if isinstance(value, bool):
        return 0
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return 0
    return min(max(number, 0), maximum)


def compute_level(total_correct: int) -> int:
    return 1 + safe_counter(total_correct) // 10


def grade_for_stars(ranking_stars: int) -> dict[str, Any]:
    stars = safe_counter(ranking_stars)
    tier_index = 0
    for index, (minimum, _name, _icon) in enumerate(GRADE_TIERS):
        if stars >= minimum:
            tier_index = index
    minimum, name, icon = GRADE_TIERS[tier_index]
    next_tier = GRADE_TIERS[tier_index + 1] if tier_index + 1 < len(GRADE_TIERS) else None
    return {
        "name": name,
        "icon": icon,
        "minimumStars": minimum,
        "nextName": next_tier[1] if next_tier else None,
        "nextAt": next_tier[0] if next_tier else None,
        "starsToNext": max(0, next_tier[0] - stars) if next_tier else 0,
    }


def reward_summary(
    *, ranking_stars: int, total_solved: int, total_correct: int,
    best_streak: int, completed_rounds: int,
) -> dict[str, Any]:
    solved = safe_counter(total_solved)
    correct = min(safe_counter(total_correct), solved)
    accuracy = correct / solved if solved else 0
    badges = [
        {"id": "first-star", "name": "Первая звезда", "icon": "★", "description": "Дать первый верный ответ", "unlocked": ranking_stars >= 1},
        {"id": "first-round", "name": "Первый раунд", "icon": "✓", "description": "Завершить первый раунд", "unlocked": completed_rounds >= 1},
        {"id": "streak-5", "name": "Пять подряд", "icon": "↗", "description": "Ответить верно 5 раз подряд", "unlocked": best_streak >= 5},
        {"id": "sharp-eye", "name": "Меткий счёт", "icon": "◎", "description": "Не меньше 80% верных после 10 примеров", "unlocked": solved >= 10 and accuracy >= 0.8},
        {"id": "star-collector", "name": "Собиратель", "icon": "✦", "description": "Заработать 50 рейтинговых звёзд", "unlocked": ranking_stars >= 50},
        {"id": "streak-10", "name": "Десять подряд", "icon": "◆", "description": "Ответить верно 10 раз подряд", "unlocked": best_streak >= 10},
    ]
    return {
        "grade": grade_for_stars(ranking_stars),
        "badges": badges,
        "unlockedCount": sum(1 for badge in badges if badge["unlocked"]),
    }


def canonical_key(a: int, b: int) -> str:
    return f"{min(a, b)}x{max(a, b)}"


def normalize_weak_pairs(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, int] = {}
    for key, raw_count in value.items():
        if not isinstance(key, str) or "x" not in key:
            continue
        parts = key.split("x")
        if len(parts) != 2 or not all(part.isdigit() for part in parts):
            continue
        a, b = (int(part) for part in parts)
        if not (1 <= a <= b <= 10) or key != canonical_key(a, b):
            continue
        count = safe_counter(raw_count)
        if count:
            result[key] = count
    return result


def normalize_name(raw_name: Any) -> tuple[str, str]:
    if not isinstance(raw_name, str):
        raise InvalidNameError("Введите имя")
    name = " ".join(raw_name.strip().split())
    if not 2 <= len(name) <= 20:
        raise InvalidNameError("Имя должно быть от 2 до 20 символов")
    if not any(character.isalnum() for character in name):
        raise InvalidNameError("Добавьте в имя буквы или цифры")
    if any(not (character.isalnum() or character in " -") for character in name):
        raise InvalidNameError("Можно использовать буквы, цифры, пробел и дефис")
    return name, name.casefold()


def initial_values(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    total_solved = safe_counter(source.get("totalSolved"))
    total_correct = min(safe_counter(source.get("totalCorrect")), total_solved)
    current_streak = min(safe_counter(source.get("currentStreak")), total_correct)
    best_streak = min(
        max(safe_counter(source.get("bestStreak")), current_streak),
        total_correct,
    )
    return {
        "total_solved": total_solved,
        "total_correct": total_correct,
        "stars": total_correct,
        "current_streak": current_streak,
        "best_streak": best_streak,
        "weak_pairs": json.dumps(normalize_weak_pairs(source.get("weakPairs")), ensure_ascii=False),
    }


def open_database(path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    database_path = Path(path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10, isolation_level=None, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            name_key TEXT NOT NULL UNIQUE,
            token_hash TEXT NOT NULL UNIQUE,
            total_solved INTEGER NOT NULL DEFAULT 0 CHECK(total_solved >= 0),
            total_correct INTEGER NOT NULL DEFAULT 0 CHECK(total_correct >= 0),
            stars INTEGER NOT NULL DEFAULT 0 CHECK(stars >= 0),
            ranked_stars INTEGER NOT NULL DEFAULT 0 CHECK(ranked_stars >= 0),
            current_streak INTEGER NOT NULL DEFAULT 0 CHECK(current_streak >= 0),
            best_streak INTEGER NOT NULL DEFAULT 0 CHECK(best_streak >= 0),
            weak_pairs TEXT NOT NULL DEFAULT '{}',
            current_round_answered INTEGER NOT NULL DEFAULT 0 CHECK(current_round_answered BETWEEN 0 AND 9),
            current_round_correct INTEGER NOT NULL DEFAULT 0 CHECK(current_round_correct >= 0),
            completed_rounds INTEGER NOT NULL DEFAULT 0 CHECK(completed_rounds >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rounds (
            id INTEGER PRIMARY KEY,
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            round_number INTEGER NOT NULL,
            correct INTEGER NOT NULL CHECK(correct BETWEEN 0 AND 10),
            completed_at TEXT NOT NULL,
            UNIQUE(profile_id, round_number)
        );

        CREATE TABLE IF NOT EXISTS submissions (
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            submission_id TEXT NOT NULL,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(profile_id, submission_id)
        );
        """
    )
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(profiles)")}
    if "ranked_stars" not in columns:
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "ALTER TABLE profiles ADD COLUMN ranked_stars INTEGER NOT NULL DEFAULT 0 CHECK(ranked_stars >= 0)"
            )
            # Existing server-earned stars predate the leaderboard and remain valid.
            connection.execute("UPDATE profiles SET ranked_stars = stars")
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return connection


def name_suggestions(connection: sqlite3.Connection, base_name: str) -> list[str]:
    suggestions: list[str] = []
    for suffix in range(2, 100):
        suffix_text = str(suffix)
        candidate = f"{base_name[:20 - len(suffix_text)]}{suffix_text}"
        _, candidate_key = normalize_name(candidate)
        exists = connection.execute(
            "SELECT 1 FROM profiles WHERE name_key = ?", (candidate_key,)
        ).fetchone()
        if not exists:
            suggestions.append(candidate)
        if len(suggestions) == 3:
            break
    return suggestions


def row_payload(row: sqlite3.Row) -> dict[str, Any]:
    weak_pairs = normalize_weak_pairs(json.loads(row["weak_pairs"] or "{}"))
    total_solved = row["total_solved"]
    total_correct = row["total_correct"]
    ranking_stars = row["ranked_stars"]
    rewards = reward_summary(
        ranking_stars=ranking_stars,
        total_solved=total_solved,
        total_correct=total_correct,
        best_streak=row["best_streak"],
        completed_rounds=row["completed_rounds"],
    )
    return {
        "profile": {"name": row["name"]},
        "progress": {
            "totalSolved": total_solved,
            "totalCorrect": total_correct,
            "accuracy": round(total_correct / total_solved, 4) if total_solved else 0,
            "stars": row["stars"],
            "rankingStars": ranking_stars,
            "currentStreak": row["current_streak"],
            "bestStreak": row["best_streak"],
            "level": compute_level(total_correct),
            "weakPairs": weak_pairs,
            "completedRounds": row["completed_rounds"],
            "rewards": rewards,
            "currentRound": {
                "number": row["completed_rounds"] + 1,
                "answered": row["current_round_answered"],
                "correct": row["current_round_correct"],
                "total": ROUND_SIZE,
            },
        },
    }


def profile_row_by_token(connection: sqlite3.Connection, token: str) -> sqlite3.Row:
    if not isinstance(token, str) or len(token) < 32:
        raise InvalidTokenError("invalid_session")
    row = connection.execute(
        "SELECT * FROM profiles WHERE token_hash = ?", (token_hash(token),)
    ).fetchone()
    if row is None:
        raise InvalidTokenError("invalid_session")
    return row


def register_profile(
    connection: sqlite3.Connection,
    raw_name: Any,
    existing_progress: Any = None,
) -> dict[str, Any]:
    name, name_key = normalize_name(raw_name)
    values = initial_values(existing_progress)
    token = secrets.token_urlsafe(32)
    timestamp = now_iso()
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            INSERT INTO profiles (
                name, name_key, token_hash, total_solved, total_correct, stars, ranked_stars,
                current_streak, best_streak, weak_pairs, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                name_key,
                token_hash(token),
                values["total_solved"],
                values["total_correct"],
                values["stars"],
                0,
                values["current_streak"],
                values["best_streak"],
                values["weak_pairs"],
                timestamp,
                timestamp,
            ),
        )
        row = connection.execute("SELECT * FROM profiles WHERE name_key = ?", (name_key,)).fetchone()
        connection.commit()
    except sqlite3.IntegrityError as error:
        connection.rollback()
        if "name_key" in str(error):
            raise NameTakenError(name_suggestions(connection, name)) from error
        raise
    payload = row_payload(row)
    payload["sessionToken"] = token
    return payload


def get_profile_by_token(connection: sqlite3.Connection, token: str) -> dict[str, Any]:
    return row_payload(profile_row_by_token(connection, token))


def leaderboard_entry(row: sqlite3.Row, position: int) -> dict[str, Any]:
    solved = row["total_solved"]
    accuracy = round(row["total_correct"] / solved * 100) if solved else 0
    return {
        "position": position,
        "name": row["name"],
        "stars": row["ranked_stars"],
        "accuracy": accuracy,
        "bestStreak": row["best_streak"],
        "completedRounds": row["completed_rounds"],
        "grade": grade_for_stars(row["ranked_stars"]),
    }


def get_leaderboard(connection: sqlite3.Connection, token: str, limit: int = 10) -> dict[str, Any]:
    current = profile_row_by_token(connection, token)
    rows = connection.execute(
        """
        SELECT * FROM profiles
        ORDER BY ranked_stars DESC,
            CASE WHEN total_solved = 0 THEN 0.0
                 ELSE CAST(total_correct AS REAL) / total_solved END DESC,
            best_streak DESC, created_at ASC, id ASC
        """
    ).fetchall()
    entries = [leaderboard_entry(row, index + 1) for index, row in enumerate(rows)]
    me = next(
        (entry for entry, row in zip(entries, rows) if row["id"] == current["id"]),
        None,
    )
    if me is None:
        raise InvalidTokenError("invalid_session")
    return {"leaders": entries[:max(1, min(limit, 50))], "me": me, "totalPlayers": len(entries)}


def record_answer(
    connection: sqlite3.Connection,
    token: str,
    a: Any,
    b: Any,
    answer: Any,
    submission_id: Any,
) -> dict[str, Any]:
    if not isinstance(a, int) or isinstance(a, bool) or not 1 <= a <= 10:
        raise InvalidAnswerError("invalid_problem")
    if not isinstance(b, int) or isinstance(b, bool) or not 1 <= b <= 10:
        raise InvalidAnswerError("invalid_problem")
    if not isinstance(answer, (str, int)) or not str(answer).strip().isdigit():
        raise InvalidAnswerError("invalid_answer")
    if not isinstance(submission_id, str) or not 8 <= len(submission_id) <= 100:
        raise InvalidAnswerError("invalid_submission")

    connection.execute("BEGIN IMMEDIATE")
    try:
        profile = profile_row_by_token(connection, token)
        existing = connection.execute(
            "SELECT result_json FROM submissions WHERE profile_id = ? AND submission_id = ?",
            (profile["id"], submission_id),
        ).fetchone()
        if existing:
            connection.commit()
            return json.loads(existing["result_json"])

        expected = a * b
        is_correct = int(str(answer).strip()) == expected
        old_rewards = row_payload(profile)["progress"]["rewards"]
        total_solved = profile["total_solved"] + 1
        total_correct = profile["total_correct"] + (1 if is_correct else 0)
        stars = profile["stars"] + (1 if is_correct else 0)
        ranking_stars = profile["ranked_stars"] + (1 if is_correct else 0)
        current_streak = profile["current_streak"] + 1 if is_correct else 0
        best_streak = max(profile["best_streak"], current_streak)
        weak_pairs = normalize_weak_pairs(json.loads(profile["weak_pairs"] or "{}"))
        events: list[str] = []

        if is_correct:
            if current_streak > profile["best_streak"]:
                events.append("new-record")
            if current_streak == 5:
                events.append("streak-5")
            if current_streak == 10:
                events.append("streak-10")
            if compute_level(total_correct) > compute_level(profile["total_correct"]):
                events.append("level-up")
        else:
            key = canonical_key(a, b)
            weak_pairs[key] = weak_pairs.get(key, 0) + 1

        round_answered = profile["current_round_answered"] + 1
        round_correct = profile["current_round_correct"] + (1 if is_correct else 0)
        completed_rounds = profile["completed_rounds"]
        round_completed = None
        timestamp = now_iso()
        if round_answered == ROUND_SIZE:
            round_number = completed_rounds + 1
            round_completed = {"number": round_number, "correct": round_correct, "total": ROUND_SIZE}
            connection.execute(
                "INSERT INTO rounds (profile_id, round_number, correct, completed_at) VALUES (?, ?, ?, ?)",
                (profile["id"], round_number, round_correct, timestamp),
            )
            completed_rounds += 1
            round_answered = 0
            round_correct = 0

        connection.execute(
            """
            UPDATE profiles SET
                total_solved = ?, total_correct = ?, stars = ?, ranked_stars = ?, current_streak = ?,
                best_streak = ?, weak_pairs = ?, current_round_answered = ?,
                current_round_correct = ?, completed_rounds = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                total_solved,
                total_correct,
                stars,
                ranking_stars,
                current_streak,
                best_streak,
                json.dumps(weak_pairs, ensure_ascii=False, sort_keys=True),
                round_answered,
                round_correct,
                completed_rounds,
                timestamp,
                profile["id"],
            ),
        )
        updated = connection.execute("SELECT * FROM profiles WHERE id = ?", (profile["id"],)).fetchone()
        new_rewards = row_payload(updated)["progress"]["rewards"]
        if new_rewards["grade"]["name"] != old_rewards["grade"]["name"]:
            events.append("grade-up")
        old_badges = {badge["id"] for badge in old_rewards["badges"] if badge["unlocked"]}
        for badge in new_rewards["badges"]:
            if badge["unlocked"] and badge["id"] not in old_badges:
                events.append(f"badge:{badge['id']}")
        result = {
            **row_payload(updated),
            "isCorrect": is_correct,
            "correctAnswer": expected,
            "events": events,
            "roundCompleted": round_completed,
        }
        connection.execute(
            "INSERT INTO submissions (profile_id, submission_id, result_json, created_at) VALUES (?, ?, ?, ?)",
            (profile["id"], submission_id, json.dumps(result, ensure_ascii=False), timestamp),
        )
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise


def reset_progress(connection: sqlite3.Connection, token: str) -> dict[str, Any]:
    connection.execute("BEGIN IMMEDIATE")
    try:
        profile = profile_row_by_token(connection, token)
        connection.execute("DELETE FROM submissions WHERE profile_id = ?", (profile["id"],))
        connection.execute("DELETE FROM rounds WHERE profile_id = ?", (profile["id"],))
        connection.execute(
            """
            UPDATE profiles SET total_solved = 0, total_correct = 0, stars = 0, ranked_stars = 0,
                current_streak = 0, best_streak = 0, weak_pairs = '{}',
                current_round_answered = 0, current_round_correct = 0,
                completed_rounds = 0, updated_at = ? WHERE id = ?
            """,
            (now_iso(), profile["id"]),
        )
        updated = connection.execute("SELECT * FROM profiles WHERE id = ?", (profile["id"],)).fetchone()
        connection.commit()
        return row_payload(updated)
    except Exception:
        connection.rollback()
        raise


class AppHandler(SimpleHTTPRequestHandler):
    database_path = DEFAULT_DB_PATH
    allowed_static_paths = {
        "/", "/index.html", "/styles.css", "/manifest.webmanifest", "/service-worker.js",
        "/src/app.js", "/src/core.js", "/assets/icon.svg", "/assets/icon-192.png",
        "/assets/icon-512.png",
    }

    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("invalid_json") from error
        if not 0 < length <= 65_536:
            raise ValueError("invalid_json")
        try:
            data = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("invalid_json") from error
        if not isinstance(data, dict):
            raise ValueError("invalid_json")
        return data

    def bearer_token(self) -> str:
        authorization = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not authorization.startswith(prefix):
            raise InvalidTokenError("invalid_session")
        return authorization[len(prefix):]

    def database(self) -> sqlite3.Connection:
        return open_database(self.database_path)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/healthz":
            self.send_json(HTTPStatus.OK, {"status": "ok"})
            return
        if path == "/api/me":
            try:
                with closing(self.database()) as database:
                    payload = get_profile_by_token(database, self.bearer_token())
                self.send_json(HTTPStatus.OK, payload)
            except InvalidTokenError:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_session"})
            return
        if path == "/api/leaderboard":
            try:
                with closing(self.database()) as database:
                    payload = get_leaderboard(database, self.bearer_token())
                self.send_json(HTTPStatus.OK, payload)
            except InvalidTokenError:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_session"})
            return
        if path.startswith("/api/"):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if path not in self.allowed_static_paths:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        path = urlparse(self.path).path
        if path not in self.allowed_static_paths:
            self.send_response(HTTPStatus.NOT_FOUND)
            self.end_headers()
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            data = self.read_json()
            if path == "/api/profiles":
                with closing(self.database()) as database:
                    payload = register_profile(database, data.get("name"), data.get("existingProgress"))
                self.send_json(HTTPStatus.CREATED, payload)
                return
            if path == "/api/answers":
                with closing(self.database()) as database:
                    payload = record_answer(
                        database,
                        self.bearer_token(),
                        data.get("a"),
                        data.get("b"),
                        data.get("answer"),
                        data.get("submissionId"),
                    )
                self.send_json(HTTPStatus.OK, payload)
                return
            if path == "/api/progress/reset":
                with closing(self.database()) as database:
                    payload = reset_progress(database, self.bearer_token())
                self.send_json(HTTPStatus.OK, payload)
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
        except InvalidNameError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_name", "message": str(error)})
        except NameTakenError as error:
            self.send_json(
                HTTPStatus.CONFLICT,
                {
                    "error": "name_taken",
                    "message": "Это имя уже занято. Попробуй другое.",
                    "suggestions": error.suggestions,
                },
            )
        except InvalidTokenError:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "invalid_session"})
        except InvalidAnswerError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"})
        except sqlite3.Error:
            self.log_error("Database error")
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "server_error"})


def run_server(host: str, port: int, database_path: Path) -> None:
    AppHandler.database_path = database_path
    open_database(database_path).close()
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"Умножайка запущена: http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Умножайка web server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    arguments = parser.parse_args()
    run_server(arguments.host, arguments.port, arguments.db)


if __name__ == "__main__":
    main()
