import sqlite3
import tempfile
import unittest
from pathlib import Path

from server import (
    InvalidNameError,
    NameTakenError,
    get_profile_by_token,
    open_database,
    record_answer,
    register_profile,
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


if __name__ == "__main__":
    unittest.main()
