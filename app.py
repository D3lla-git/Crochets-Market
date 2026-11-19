"""Start Crochets Market.

    python app.py                    → run on your computer: http://localhost:5000
    python app.py --host 0.0.0.0     → also reachable from phones on the same Wi-Fi

For a real website, see README.md → "Put it online" (uses waitress / gunicorn with wsgi:app).
"""
from __future__ import annotations

import argparse

from dotenv import load_dotenv

load_dotenv()   # read .env before the app loads its settings

from market import create_app  # noqa: E402
from market.db import seed_demo  # noqa: E402

app = create_app()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Crochets Market shop locally.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--no-seed", action="store_true", help="don't add sample crochets to an empty shop")
    parser.add_argument("--no-debug", action="store_true", help="turn off auto-reload and the debugger")
    args = parser.parse_args()

    if not args.no_seed and not app.config["APP_PRODUCTION"]:
        with app.app_context():
            if seed_demo():
                print(" * Added 3 demo sellers with sample crochets so you have something to look at.")

    print(f" * Marketplace: http://localhost:{args.port}/")
    print(f" * Dashboard:   http://localhost:{args.port}/admin")
    if not app.config["APP_PRODUCTION"]:
        print("     manager login: admin@crochets.local / admin   (local only)")
        print("     seller login:  sinkor@demo.local / demo-seller-123   (local only)")
    app.run(host=args.host, port=args.port, debug=not args.no_debug)


if __name__ == "__main__":
    main()
