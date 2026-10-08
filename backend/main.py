"""Backward-compatible ASGI entry point for the supported application."""

from app.main import app

__all__ = ['app']
