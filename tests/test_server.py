import sqlite3
import tempfile
import unittest
from pathlib import Path

from server import (
    get_leaderboard,
    grade_for_stars,
    InvalidNameError,
    NameTakenError,
    get_profile_by_token,
    open_database,
    record_answer,
    register_profile,
    reward_summary,
    reset_progress,
)


class ProfileAndRoundTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test.sqlite3"
        self.db = open_database(self.db_path)

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def test_registers_trimmed_name_and_returns_private_session_token(self):
        created = register_profile(self.db, "  Маша  ")
        self.assertEqual(created["profile"]["name"], "Маша")
        self.assertGreaterEqual(len(created["sessionToken"]), 32)
        loaded = get_profile_by_token(self.db, created["sessionToken"])
        self.assertEqual(loaded["profile"]["name"], "Маша")
        self.assertEqual(loaded["progress"]["totalSolved"], 0)

    def test_name_is_globally_unique_case_insensitively(self):
        register_profile(self.db, "Маша")
        with self.assertRaises(NameTakenError) as error:
            register_profile(self.db, "мАшА")
        self.assertGreaterEqual(len(error.exception.suggestions), 2)
        self.assertTrue(all(name.casefold() != "маша" for name in error.exception.suggestions))

    def test_rejects_empty_short_long_and_symbol_only_names(self):
        for name in ("", " ", "А", "A" * 21, "***"):
            with self.subTest(name=name), self.assertRaises(InvalidNameError):
                register_profile(self.db, name)

    def test_progress_is_isolated_between_profiles(self):
        first = register_profile(self.db, "Маша")
        second = register_profile(self.db, "Петя")
        record_answer(self.db, first["sessionToken"], 7, 8, "56", "answer-1")
        first_loaded = get_profile_by_token(self.db, first["sessionToken"])
        second_loaded = get_profile_by_token(self.db, second["sessionToken"])
        self.assertEqual(first_loaded["progress"]["stars"], 1)
        self.assertEqual(second_loaded["progress"]["stars"], 0)
        self.assertEqual(second_loaded["progress"]["totalSolved"], 0)

    def test_duplicate_submission_is_idempotent(self):
        profile = register_profile(self.db, "Саша")
        token = profile["sessionToken"]
        first = record_answer(self.db, token, 6, 6, "36", "same-answer")
        repeated = record_answer(self.db, token, 6, 6, "36", "same-answer")
        self.assertEqual(first, repeated)
        self.assertEqual(repeated["progress"]["totalSolved"], 1)
        self.assertEqual(repeated["progress"]["stars"], 1)

    def test_round_completes_only_after_exactly_ten_answers(self):
        profile = register_profile(self.db, "Лёша")
        token = profile["sessionToken"]
        result = None
        for index in range(9):
            result = record_answer(self.db, token, 2, 3, "6", f"answer-{index}")
            self.assertIsNone(result["roundCompleted"])
            self.assertEqual(result["progress"]["currentRound"]["answered"], index + 1)
            self.assertEqual(result["progress"]["currentRound"]["number"], 1)
        result = record_answer(self.db, token, 2, 3, "5", "answer-9")
        self.assertEqual(result["roundCompleted"], {"number": 1, "correct": 9, "total": 10})
        self.assertEqual(result["progress"]["completedRounds"], 1)
        self.assertEqual(result["progress"]["currentRound"], {
            "number": 2,
            "answered": 0,
            "correct": 0,
            "total": 10,
        })

    def test_round_and_level_can_complete_on_same_answer(self):
        profile = register_profile(self.db, "Ира")
        token = profile["sessionToken"]
        result = None
        for index in range(10):
            result = record_answer(self.db, token, 1, 1, "1", f"answer-{index}")
        self.assertIn("level-up", result["events"])
        self.assertEqual(result["progress"]["level"], 2)
        self.assertEqual(result["roundCompleted"]["correct"], 10)

    def test_wrong_answer_resets_streak_without_removing_stars(self):
        profile = register_profile(self.db, "Коля")
        token = profile["sessionToken"]
        record_answer(self.db, token, 3, 3, "9", "correct-1")
        result = record_answer(self.db, token, 3, 3, "8", "wrong-01")
        self.assertFalse(result["isCorrect"])
        self.assertEqual(result["correctAnswer"], 9)
        self.assertEqual(result["progress"]["stars"], 1)
        self.assertEqual(result["progress"]["currentStreak"], 0)
        self.assertEqual(result["progress"]["weakPairs"], {"3x3": 1})

    def test_reset_only_clears_the_authenticated_profile(self):
        first = register_profile(self.db, "Оля")
        second = register_profile(self.db, "Ваня")
        record_answer(self.db, first["sessionToken"], 4, 5, "20", "answer-a")
        record_answer(self.db, second["sessionToken"], 4, 5, "20", "answer-b")
        reset = reset_progress(self.db, first["sessionToken"])
        self.assertEqual(reset["progress"]["totalSolved"], 0)
        self.assertEqual(get_profile_by_token(self.db, second["sessionToken"])["progress"]["stars"], 1)

    def test_can_migrate_existing_local_totals_into_first_profile(self):
        created = register_profile(self.db, "Дима", {
            "totalSolved": 12,
            "totalCorrect": 10,
            "stars": 10,
            "currentStreak": 3,
            "bestStreak": 5,
            "weakPairs": {"7x8": 2},
        })
        progress = created["progress"]
        self.assertEqual(progress["totalSolved"], 12)
        self.assertEqual(progress["level"], 2)
        self.assertEqual(progress["currentRound"]["answered"], 0)
        self.assertEqual(progress["weakPairs"], {"7x8": 2})
        self.assertEqual(progress["rankingStars"], 0)

    def test_grade_boundaries_are_positive_and_predictable(self):
        self.assertEqual(grade_for_stars(0)["name"], "Искатель")
        self.assertEqual(grade_for_stars(9)["name"], "Искатель")
        self.assertEqual(grade_for_stars(10)["name"], "Знаток")
        self.assertEqual(grade_for_stars(25)["name"], "Суперсчётчик")
        self.assertEqual(grade_for_stars(50)["name"], "Мастер")
        self.assertEqual(grade_for_stars(100)["name"], "Легенда")

    def test_reward_badges_unlock_from_real_progress(self):
        rewards = reward_summary(
            ranking_stars=50,
            total_solved=20,
            total_correct=18,
            best_streak=10,
            completed_rounds=2,
        )
        unlocked = {badge["id"] for badge in rewards["badges"] if badge["unlocked"]}
        self.assertEqual(unlocked, {
            "first-star", "first-round", "streak-5", "sharp-eye", "star-collector", "streak-10"
        })
        self.assertEqual(rewards["grade"]["name"], "Мастер")

    def test_imported_progress_does_not_allow_leaderboard_cheating(self):
        created = register_profile(self.db, "Импорт", {
            "totalSolved": 1000, "totalCorrect": 1000, "stars": 1000,
            "currentStreak": 1000, "bestStreak": 1000,
        })
        token = created["sessionToken"]
        self.assertEqual(created["progress"]["stars"], 1000)
        self.assertEqual(created["progress"]["rankingStars"], 0)
        result = record_answer(self.db, token, 2, 2, "4", "earned-star-1")
        self.assertEqual(result["progress"]["rankingStars"], 1)
        self.assertIn("badge:first-star", result["events"])

    def test_leaderboard_orders_by_stars_accuracy_then_best_streak(self):
        profiles = {
            name: register_profile(self.db, name)
            for name in ("Аня", "Боря", "Вера", "Глеб")
        }
        fixtures = {
            "Аня": (20, 10, 8, 5),
            "Боря": (20, 10, 9, 2),
            "Вера": (20, 10, 9, 7),
            "Глеб": (21, 30, 15, 1),
        }
        for name, (stars, solved, correct, streak) in fixtures.items():
            self.db.execute(
                "UPDATE profiles SET ranked_stars=?, stars=?, total_solved=?, total_correct=?, best_streak=? WHERE name=?",
                (stars, stars, solved, correct, streak, name),
            )
        board = get_leaderboard(self.db, profiles["Боря"]["sessionToken"])
        self.assertEqual([entry["name"] for entry in board["leaders"]], ["Глеб", "Вера", "Боря", "Аня"])
        self.assertEqual(board["me"]["position"], 3)
        self.assertEqual(board["me"]["stars"], 20)

    def test_reset_clears_ranked_stars_and_rewards(self):
        created = register_profile(self.db, "Рейтинг")
        token = created["sessionToken"]
        record_answer(self.db, token, 5, 5, "25", "rank-answer-1")
        reset = reset_progress(self.db, token)
        self.assertEqual(reset["progress"]["rankingStars"], 0)
        self.assertEqual(reset["progress"]["rewards"]["grade"]["name"], "Искатель")

    def test_schema_migration_preserves_existing_stars_as_ranked(self):
        path = Path(self.temp.name) / "legacy.sqlite3"
        legacy = sqlite3.connect(path)
        legacy.execute("""
            CREATE TABLE profiles (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
                token_hash TEXT NOT NULL UNIQUE, total_solved INTEGER NOT NULL DEFAULT 0,
                total_correct INTEGER NOT NULL DEFAULT 0, stars INTEGER NOT NULL DEFAULT 0,
                current_streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
                weak_pairs TEXT NOT NULL DEFAULT '{}', current_round_answered INTEGER NOT NULL DEFAULT 0,
                current_round_correct INTEGER NOT NULL DEFAULT 0, completed_rounds INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )
        """)
        legacy.execute(
            "INSERT INTO profiles VALUES (1,'Старый','старый','hash',10,7,7,3,4,'{}',0,0,1,'now','now')"
        )
        legacy.commit()
        legacy.close()

        migrated = open_database(path)
        row = migrated.execute("SELECT stars, ranked_stars FROM profiles WHERE id=1").fetchone()
        self.assertEqual((row["stars"], row["ranked_stars"]), (7, 7))
        migrated.close()


if __name__ == "__main__":
    unittest.main()
