# Explicitly requested registry publishing or project scaffolding

Use only the sections needed for the current task.

Contents:
- Publishing to ComfyUI Registry
- Scaffolding with comfy-cli

## Publishing to ComfyUI Registry

### 1. Create `pyproject.toml`

```toml
[project]
name = "comfyui-my-nodes"
version = "1.0.0"
description = "My custom nodes"
license = "MIT"

[tool.comfy]
PublisherId = "your-publisher-id"
```

### 2. Publish

```bash
comfy node publish
```

### CI/CD with GitHub Actions

```yaml
# .github/workflows/publish.yml
name: Publish to ComfyUI Registry
on:
  push:
    tags:
      - 'v*'
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install comfy-cli
      - run: comfy node publish
        env:
          COMFY_API_KEY: ${{ secrets.COMFY_API_KEY }}
```

## Scaffolding with comfy-cli

```bash
# Install comfy-cli
pip install comfy-cli

# Create new custom node project
cd ComfyUI/custom_nodes
comfy node scaffold
```

This generates the boilerplate structure with all necessary files.
