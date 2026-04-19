"""Compatibility package re-exporting backend database modules."""

from backend.database.medical_db import MedicalDatabase
from backend.database.retriever import ProcedureRetriever

__all__ = ["MedicalDatabase", "ProcedureRetriever"]
