"""Prompt optimization registers routes only; no workflow execution node."""


def register():
    from .api import register_routes
    register_routes()
