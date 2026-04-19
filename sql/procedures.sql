CREATE TABLE IF NOT EXISTS procedures (
    sample_id TEXT PRIMARY KEY,
    question TEXT,
    video_id TEXT,
    video_url TEXT,
    answer_start INTEGER,
    answer_end INTEGER,
    answer_duration INTEGER,
    source TEXT
);

CREATE INDEX IF NOT EXISTS idx_procedures_video_id ON procedures (video_id);
CREATE INDEX IF NOT EXISTS idx_procedures_question ON procedures (question);
