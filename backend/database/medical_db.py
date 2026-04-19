"""
Medical procedure metadata storage backed by Neon PostgreSQL.
Qdrant remains the vector store; this module only manages procedure metadata.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool
from sentence_transformers import SentenceTransformer

PROCEDURE_COLUMNS = (
    "sample_id, question, video_id, video_url, " "answer_start, answer_end, answer_duration, source"
)

FETCH_ALL_PROCEDURES_SQL = (
    "SELECT sample_id, question, video_id, video_url, "
    "answer_start, answer_end, answer_duration, source "
    "FROM procedures ORDER BY question ASC"
)
FETCH_PROCEDURE_BY_VIDEO_ID_SQL = (
    "SELECT sample_id, question, video_id, video_url, "
    "answer_start, answer_end, answer_duration, source "
    "FROM procedures WHERE video_id = %s LIMIT 1"
)
FETCH_PROCEDURES_BY_VIDEO_IDS_SQL = (
    "SELECT sample_id, question, video_id, video_url, "
    "answer_start, answer_end, answer_duration, source "
    "FROM procedures WHERE video_id = ANY(%s)"
)


class MedicalDatabase:
    def __init__(self, config):
        """Initialize metadata database and embedding model configuration."""
        self.config = config
        self.procedures: list[dict[str, Any]] = []
        self.embedding_model = None
        self.pool: SimpleConnectionPool | None = None
        self.postgres_url = self._resolve_postgres_url()
        self.procedures_by_question: dict[str, dict[str, Any]] = {}
        self.procedures_by_video_id: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _resolve_postgres_url() -> str:
        """Read POSTGRES_URL from env first, then fall back to frontend/.env.local."""
        env_value = os.environ.get("POSTGRES_URL")
        if env_value:
            return env_value

        env_files = [
            Path(".env.local"),
            Path("frontend/.env.local"),
        ]
        for env_file in env_files:
            if not env_file.exists():
                continue
            for line in env_file.read_text().splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#") or "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                if key.strip() == "POSTGRES_URL":
                    return value.strip().strip("'").strip('"')

        msg = "POSTGRES_URL is not configured. Set it in the environment or frontend/.env.local."
        raise RuntimeError(msg)

    @staticmethod
    def _row_to_procedure(row: dict[str, Any]) -> dict[str, Any]:
        """Convert a Postgres row into the metadata shape used by the existing app."""
        video_id = row.get("video_id")
        answer_start = int(row.get("answer_start") or 0)
        answer_end = int(row.get("answer_end") or 0)
        procedure = {
            "sample_id": row.get("sample_id"),
            "question": row.get("question"),
            "video_id": video_id,
            "video_url": row.get("video_url"),
            "youtube_url": row.get("video_url"),
            "youtube_embed": (
                f"https://www.youtube.com/embed/{video_id}?start={answer_start}"
                if video_id
                else None
            ),
            "answer_start": answer_start,
            "answer_end": answer_end,
            "answer_duration": int(row.get("answer_duration") or max(answer_end - answer_start, 0)),
            "duration": int(row.get("answer_duration") or max(answer_end - answer_start, 0)),
            "source": row.get("source"),
            "steps": [
                {
                    "index": 0,
                    "heading": f"Watch from {answer_start} to {answer_end}",
                    "absolute_bounds": [answer_start, answer_end],
                }
            ],
        }
        return procedure

    @contextmanager
    def connection(self):
        """Borrow a connection from the pool and always return it."""
        if not self.pool:
            msg = "Database connection pool has not been initialized. Call load() first."
            raise RuntimeError(msg)

        conn = self.pool.getconn()
        try:
            yield conn
        finally:
            self.pool.putconn(conn)

    def _fetch_all_procedures(self) -> list[dict[str, Any]]:
        with self.connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(FETCH_ALL_PROCEDURES_SQL)
            rows = cur.fetchall()
        return [self._row_to_procedure(dict(row)) for row in rows]

    def load(self, _cache_dir=None):
        """
        Load procedure metadata from Neon and initialize the sentence embedding model.
        cache_dir is ignored but kept for backward compatibility with existing callers.
        """
        self.pool = SimpleConnectionPool(
            minconn=1,
            maxconn=5,
            dsn=self.postgres_url,
            connect_timeout=10,
        )

        self.procedures = self._fetch_all_procedures()
        self.procedures_by_question = {
            (proc.get("question") or "").lower(): proc
            for proc in self.procedures
            if proc.get("question")
        }
        self.procedures_by_video_id = {
            proc["video_id"]: proc for proc in self.procedures if proc.get("video_id")
        }

        model_name = self.config["database"]["embedding_model"]
        self.embedding_model = SentenceTransformer(model_name)

    def close(self) -> None:
        """Close all pooled Postgres connections."""
        if self.pool:
            self.pool.closeall()
            self.pool = None

    def get_procedure_by_video_id(self, video_id: str) -> dict[str, Any] | None:
        """Fetch one procedure by video_id from Neon."""
        if not video_id:
            return None
        cached = self.procedures_by_video_id.get(video_id)
        if cached:
            return cached.copy()

        with self.connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(FETCH_PROCEDURE_BY_VIDEO_ID_SQL, (video_id,))
            row = cur.fetchone()

        if not row:
            return None

        procedure = self._row_to_procedure(dict(row))
        self.procedures_by_video_id[video_id] = procedure
        if procedure.get("question"):
            self.procedures_by_question[procedure["question"].lower()] = procedure
        return procedure.copy()

    def get_procedures_by_video_ids(self, video_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Fetch multiple procedures keyed by video_id with one efficient query."""
        normalized_ids = sorted({video_id for video_id in video_ids if video_id})
        if not normalized_ids:
            return {}

        missing_ids = [
            video_id for video_id in normalized_ids if video_id not in self.procedures_by_video_id
        ]
        if missing_ids:
            with self.connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(FETCH_PROCEDURES_BY_VIDEO_IDS_SQL, (missing_ids,))
                rows = cur.fetchall()

            for row in rows:
                procedure = self._row_to_procedure(dict(row))
                if procedure.get("video_id"):
                    self.procedures_by_video_id[procedure["video_id"]] = procedure
                if procedure.get("question"):
                    self.procedures_by_question[procedure["question"].lower()] = procedure

        return {
            video_id: self.procedures_by_video_id[video_id].copy()
            for video_id in normalized_ids
            if video_id in self.procedures_by_video_id
        }

    def get_procedure_by_question(self, question: str) -> dict[str, Any] | None:
        """Look up one procedure by question text."""
        if not question:
            return None
        return self.procedures_by_question.get(question.lower(), None)
