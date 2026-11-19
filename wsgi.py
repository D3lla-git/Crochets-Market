"""Production entry point.

    waitress-serve --listen=0.0.0.0:8000 wsgi:app      (Windows / any OS)
    gunicorn -w 2 -b 0.0.0.0:8000 wsgi:app             (Linux hosts)
"""
from dotenv import load_dotenv

load_dotenv()

from market import create_app  # noqa: E402

app = create_app()
