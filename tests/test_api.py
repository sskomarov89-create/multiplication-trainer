import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import AppHandler


class ApiIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        AppHandler.database_path = Path(self.temp.name) / "api.sqlite3"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, method, path, body=None, token=None):
        headers = {}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = Request(f"{self.base}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_register_duplicate_auth_and_answer_flow(self):
        status, created = self.request("POST", "/api/profiles", {"name": "Маша"})
        self.assertEqual(status, 201)
        token = created["sessionToken"]

        status, duplicate = self.request("POST", "/api/profiles", {"name": "маша"})
        self.assertEqual(status, 409)
        self.assertEqual(duplicate["error"], "name_taken")
        self.assertGreaterEqual(len(duplicate["suggestions"]), 2)

        status, unauthorized = self.request("GET", "/api/me")
        self.assertEqual(status, 401)
        self.assertEqual(unauthorized["error"], "invalid_session")

        status, me = self.request("GET", "/api/me", token=token)
        self.assertEqual(status, 200)
        self.assertEqual(me["profile"]["name"], "Маша")

        status, result = self.request("POST", "/api/answers", {
            "a": 7, "b": 8, "answer": "56", "submissionId": "integration-answer-1"
        }, token)
        self.assertEqual(status, 200)
        self.assertTrue(result["isCorrect"])
        self.assertEqual(result["progress"]["currentRound"]["answered"], 1)

    def test_static_app_and_health_endpoint_are_served(self):
        with urlopen(f"{self.base}/", timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertIn("Умножайка", response.read().decode())
        status, health = self.request("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertEqual(health, {"status": "ok"})

    def test_server_only_exposes_the_pwa_shell_not_source_or_database_paths(self):
        for path in ("/server.py", "/tests/test_server.py", "/data/multiplication-trainer.sqlite3", "/.git/config"):
            with self.subTest(path=path):
                status, payload = self.request("GET", path)
                self.assertEqual(status, 404)
                self.assertEqual(payload["error"], "not_found")


if __name__ == "__main__":
    unittest.main()
