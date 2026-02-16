# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 2.0.x (current) | Yes |
| 1.x | No |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email: [skukunu1@asu.edu](mailto:skukunu1@asu.edu)

Include:
- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional)

You will receive a response within 48 hours acknowledging your report.

## Security Considerations

### API Keys

- The Groq API key in `config.yaml` should never be committed to a public repository with a real key
- Use environment variables (`GROQ_API_KEY`) in production
- Rotate keys regularly

### User Data

- This system does not store user queries, uploaded images, or audio recordings beyond the duration of a single request
- No user data is sent to third parties other than the Groq API for model inference
- Uploaded images are processed in memory and not saved to disk

### Medical Safety

- This system is an academic research prototype
- All outputs include disclaimers that they do not replace professional medical advice
- Emergency conditions trigger explicit 911 warnings
- The system should not be used as a sole source of medical guidance

### Network

- The Flask development server is not intended for production deployment
- For production, use a WSGI server (Gunicorn, uWSGI) behind a reverse proxy (Nginx)
- Enable HTTPS for any public-facing deployment
- Consider rate limiting to prevent API abuse
