"""Configuration validation tests."""

import pytest

from backend.config import AppSettings, ConfigurationError
from tests.test_application import make_settings


def test_legacy_mapping_keeps_adapter_contract() -> None:
    config = make_settings().as_legacy_dict()

    assert config["database"]["embedding_model"] == "test-embeddings"
    assert config["ai"]["provider"] == "groq"
    assert config["ai"]["groq"]["model"] == "test-model"
    assert config["vision"]["model"] == "test-vision-model"


def test_invalid_similarity_threshold_is_rejected() -> None:
    values = make_settings().as_legacy_dict()
    values["database"]["similarity_threshold"] = 1.5

    with pytest.raises(ConfigurationError, match="similarity_threshold"):
        AppSettings.from_mapping(values)


def test_invalid_answer_confidence_threshold_is_rejected() -> None:
    values = make_settings().as_legacy_dict()
    values["safety"]["answer_confidence_threshold"] = 1.5

    with pytest.raises(ConfigurationError, match="answer_confidence_threshold"):
        AppSettings.from_mapping(values)


def test_safe_defaults_use_reachable_groq_model() -> None:
    settings = AppSettings.safe_defaults()

    assert settings.ai.active["model"] == "openai/gpt-oss-20b"
    assert settings.research.enabled is False


def test_research_pipeline_settings_are_validated() -> None:
    values = make_settings().as_legacy_dict()
    values["research_pipeline"]["retrieval_weight"] = 1.5

    with pytest.raises(ConfigurationError, match="retrieval_weight"):
        AppSettings.from_mapping(values)


def test_ccal_is_an_explicit_research_localizer_strategy() -> None:
    values = make_settings().as_legacy_dict()
    values["research_pipeline"]["localizer_strategy"] = "ccal"
    values["research_pipeline"]["supported_collection_only"] = True

    settings = AppSettings.from_mapping(values)

    assert settings.research.localizer_strategy == "ccal"
    assert settings.research.supported_collection_only is True


def test_unknown_research_localizer_strategy_is_rejected() -> None:
    values = make_settings().as_legacy_dict()
    values["research_pipeline"]["localizer_strategy"] = "unknown"

    with pytest.raises(ConfigurationError, match="localizer_strategy"):
        AppSettings.from_mapping(values)


def test_structured_ollama_is_an_explicit_answer_model_strategy() -> None:
    values = make_settings().as_legacy_dict()
    values["ai"]["ollama"] = {
        "base_url": "http://localhost:11434",
        "model": "qwen-test",
        "temperature": 0,
    }
    values["research_pipeline"]["answer_model"] = "structured_ollama"

    settings = AppSettings.from_mapping(values)

    assert settings.research.answer_model == "structured_ollama"
