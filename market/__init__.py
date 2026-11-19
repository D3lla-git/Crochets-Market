"""Crochets Market — a marketplace of crochet makers, with a dashboard per seller, served by Flask."""
from __future__ import annotations

from pathlib import Path

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix

from . import accounts, api, config, db, lifecycle, views

__version__ = "4.0.0"


def create_app(overrides: dict | None = None) -> Flask:
    root = Path(__file__).resolve().parent.parent
    app = Flask(__name__, instance_path=str(root / "instance"))
    app.config.update(config.load(app.instance_path))
    if overrides:
        app.config.update(overrides)

    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    if app.config["APP_PRODUCTION"]:
        # Behind a hosting proxy (Render, PythonAnywhere, nginx…): trust its HTTPS/host headers.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    db.init_app(app)
    accounts.init_app(app)
    lifecycle.init_app(app)
    app.register_blueprint(views.bp)
    app.register_blueprint(api.bp)
    app.after_request(views.security_headers)
    return app
