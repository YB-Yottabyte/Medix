"""Vision adapter configuration tests."""

from unittest.mock import MagicMock, patch

from PIL import Image

from backend.adapters.vision import MedicalImageRecognizer


def test_configured_model_is_sent_to_groq() -> None:
    groq_client = MagicMock()
    groq_client.chat.completions.create.return_value.choices = [
        MagicMock(
            message=MagicMock(
                content=(
                    "BODY_PART: hand\n"
                    "CONDITION: wound\n"
                    "SEVERITY: minor\n"
                    "DESCRIPTION: Small hand wound.\n"
                    "SEARCH_QUERY: How to bandage a hand wound"
                )
            )
        )
    ]
    config = {
        "ai": {"provider": "groq", "groq": {"api_key": "test-key"}},
        "vision": {"model": "test-vision-model"},
    }

    with patch("backend.adapters.vision.Groq", return_value=groq_client):
        recognizer = MedicalImageRecognizer(config, database=MagicMock())
        recognizer._analyze_image(Image.new("RGB", (8, 8)))

    assert groq_client.chat.completions.create.call_args.kwargs["model"] == ("test-vision-model")
