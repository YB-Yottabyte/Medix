"""Application-level errors that can be translated into HTTP responses."""


class MedixError(Exception):
    """Base class for expected application errors."""


class ValidationError(MedixError):
    """The caller supplied invalid or incomplete input."""


class ResourceNotFoundError(MedixError):
    """A requested medical procedure or match was not found."""


class ServiceUnavailableError(MedixError):
    """A required model, cache, or external service is unavailable."""
