# Contributing to MedVidQA

Thank you for your interest in contributing to the MedVidQA project. This document provides guidelines for contributing.

## Getting Started

### 1. Fork and Clone

```bash
git clone https://github.com/YB-Yottabyte/medical-video-qa.git
cd medical-video-qa
```

### 2. Set Up the Environment

```bash
pip install -r requirements.txt
```

### 3. Get a Groq API Key

Sign up for a free key at [console.groq.com/keys](https://console.groq.com/keys) and add it to `config.yaml`.

### 4. Build the Database

```bash
python scripts/build_database.py
```

### 5. Run the Server

```bash
python app.py
```

## How to Contribute

### Reporting Issues

- Use the [GitHub Issues](https://github.com/YB-Yottabyte/medical-video-qa/issues) tab
- Include steps to reproduce the issue
- Include your Python version and OS
- Attach error logs if applicable

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Explain how it fits the research goals of the project

### Submitting Code

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and test them locally

3. Commit with a clear message:
   ```bash
   git commit -m "Add: description of your change"
   ```

4. Push your branch and open a Pull Request:
   ```bash
   git push origin feature/your-feature-name
   ```

5. Describe your changes in the PR description

## Code Guidelines

- **Python**: Follow PEP 8 style conventions
- **JavaScript**: Use `const`/`let` (no `var`), prefer arrow functions where appropriate
- **Comments**: Write clear docstrings for new functions and classes
- **Config**: Do not commit API keys or secrets. Use `config.yaml` placeholders

## Project Areas Open for Contribution

| Area | Description |
|---|---|
| **AR Integration** | Unity/Meta Quest 3 client that calls the Flask API |
| **Offline Mode** | Caching procedures for low-connectivity environments |
| **Evaluation** | Task-based testing framework for measuring accuracy and latency |
| **Dataset** | Expanding verified procedures or improving video metadata |
| **UI/UX** | Improving the web interface, mobile responsiveness, accessibility |
| **Models** | Experimenting with different VLMs or embedding models |

## Testing

Before submitting a PR, verify:

1. `python app.py` starts without errors
2. Text queries return relevant results at `http://localhost:8080`
3. Image upload produces correct VLM analysis
4. Voice input transcribes correctly (test in Chrome)
5. No API keys are committed in your changes

## Questions?

Open an issue or contact the maintainer at [skkukunu@asu.edu](mailto:skkukunu@asu.edu).
