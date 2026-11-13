import base64
import hashlib
import io
import json
import os
import secrets
import shutil
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path
from functools import wraps

from flask import Flask, abort, g, jsonify, request, send_file
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError
from werkzeug.exceptions import HTTPException

Image.MAX_IMAGE_PIXELS = 16000000
STATUSES = {"new": "Новая", "triage": "Проверяем", "in_progress": "В работе", "done": "Исправлено", "duplicate": "Дубликат", "declined": "Закрыто"}
AREAS = ["Панель", "Telegram-бот", "Подписки", "Оплата", "Установка и обновление", "Другое"]


def create_app(config=None):
    app = Flask(__name__, static_url_path="/static")
    app.config.update(DATA_DIR=os.environ.get("DATA_DIR", "/data"), PUBLIC_URL=os.environ.get("PUBLIC_URL", "http://127.0.0.1:8091").rstrip("/"), PANEL_URL=os.environ.get("PANEL_URL", "http://api:5000").rstrip("/"), MAX_CONTENT_LENGTH=12 * 1024 * 1024, MAX_FORM_MEMORY_SIZE=262144, MAX_FORM_PARTS=20)
    if config:
        app.config.update(config)
    root = Path(app.config["DATA_DIR"])
    root.mkdir(parents=True, exist_ok=True)
    (root / "uploads").mkdir(exist_ok=True)
    database = root / "reports.sqlite"
    with sqlite3.connect(database) as conn:
        conn.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, title TEXT NOT NULL, area TEXT NOT NULL, version TEXT NOT NULL, steps TEXT NOT NULL, expected TEXT NOT NULL, actual TEXT NOT NULL, contact TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', published INTEGER NOT NULL DEFAULT 0, answer TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, updated INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES reports(id), mime TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, email TEXT NOT NULL, pending TEXT NOT NULL DEFAULT '', expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS rates(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS owners(report_id INTEGER PRIMARY KEY REFERENCES reports(id), owner TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS owners_owner ON owners(owner);
          CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, answer TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL, report_id INTEGER NOT NULL, changes TEXT NOT NULL, created INTEGER NOT NULL);
        ''')
    conn.close()
    database.chmod(0o600)

    def db():
        if "db" not in g:
            g.db = sqlite3.connect(database, timeout=10)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys=ON")
        return g.db

    @app.teardown_appcontext
    def close_db(error=None):
        conn = g.pop("db", None)
        if conn:
            conn.close()

    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def limit(label, count, window, global_limit=False):
        now = int(time.time())
        ip = "global" if global_limit else request.headers.get("X-Real-IP", request.remote_addr or "unknown")
        key = digest(f"{label}:{ip}:{now // window}")
        conn = db()
        with conn:
            conn.execute("DELETE FROM rates WHERE expires < ?", (now,))
            conn.execute("INSERT INTO rates VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1", (key, now + window))
            value = conn.execute("SELECT count FROM rates WHERE key=?", (key,)).fetchone()[0]
        if value > count:
            abort(429, "Слишком много запросов. Попробуйте позже.")

    @app.before_request
    def protect():
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("Origin") != app.config["PUBLIC_URL"]:
            abort(403, "Обновите страницу и повторите действие.")

    @app.after_request
    def headers(response):
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(message=error.description if error.code != 413 else "Файлы слишком большие. Максимум 3 изображения по 3 МБ."), error.code

    def visitor():
        value = request.cookies.get("reports_owner", "")
        return value if len(value) == 43 else ""

    @app.get("/api/captcha")
    def captcha():
        limit("captcha", 30, 600)
        limit("captcha-global", 1000, 3600, True)
        owner = visitor() or secrets.token_urlsafe(32)
        token = secrets.token_urlsafe(32)
        answer = "".join(secrets.choice("23456789") for _ in range(6))
        canvas = Image.new("RGB", (260, 80), "#f3f4ee")
        draw = ImageDraw.Draw(canvas)
        for _ in range(12):
            draw.line([(secrets.randbelow(260), secrets.randbelow(80)), (secrets.randbelow(260), secrets.randbelow(80))], fill="#c3c8bb", width=1)
        font = ImageFont.load_default(size=36)
        for i, char in enumerate(answer):
            tile = Image.new("RGBA", (44, 60))
            ImageDraw.Draw(tile).text((6, 6), char, font=font, fill="#243326", stroke_width=1)
            tile = tile.rotate(secrets.randbelow(31) - 15, resample=Image.Resampling.BICUBIC)
            canvas.paste(tile, (i * 39 + 10, secrets.randbelow(12) + 5), tile)
        output = io.BytesIO()
        canvas.save(output, format="PNG")
        now = int(time.time())
        with db() as conn:
            conn.execute("DELETE FROM challenges WHERE expires < ?", (now,))
            conn.execute("INSERT INTO challenges VALUES (?,?,?,?)", (digest(token), digest(token + answer), digest(owner), now + 300))
        response = jsonify(token=token, image="data:image/png;base64," + base64.b64encode(output.getvalue()).decode())
        response.set_cookie("reports_owner", owner, max_age=365 * 86400, httponly=True, secure=app.config["PUBLIC_URL"].startswith("https://"), samesite="Strict")
        return response

    def verify_captcha():
        token = request.form.get("captcha_token", "")
        answer = request.form.get("captcha_answer", "").strip()
        conn = db()
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM challenges WHERE id=? AND owner=?", (digest(token), digest(visitor()))).fetchone()
            if row:
                conn.execute("DELETE FROM challenges WHERE id=?", (row["id"],))
        if not row or row["expires"] <= int(time.time()) or not secrets.compare_digest(row["answer"], digest(token + answer)):
            abort(400, "Код неверный или устарел. Введите код с новой картинки.")

    def session():
        token = request.cookies.get("reports_session", "")
        if not token:
            return None
        return db().execute("SELECT * FROM sessions WHERE id=? AND expires>?", (digest(token), int(time.time()))).fetchone()

    def admin_only(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            g.admin = session()
            if not g.admin or g.admin["pending"]:
                abort(401, "Войдите в аккаунт администратора.")
            return fn(*args, **kwargs)
        return wrapped

    def panel_login(path, payload):
        raw = json.dumps(payload).encode()
        req = urllib.request.Request(app.config["PANEL_URL"] + "/api/auth/" + path, data=raw, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code in (400, 401, 403):
                abort(401, "Проверьте данные для входа.")
            abort(503, "Панель временно недоступна. Попробуйте позже.")
        except (OSError, ValueError):
            abort(503, "Панель временно недоступна. Попробуйте позже.")

    def set_session(email, pending=""):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        conn = db()
        with conn:
            conn.execute("DELETE FROM sessions WHERE expires < ? OR id=?", (now, digest(request.cookies.get("reports_session", ""))))
            conn.execute("INSERT INTO sessions VALUES (?,?,?,?)", (digest(token), email, pending, now + (300 if pending else 1800)))
        response = jsonify(requires2FA=bool(pending), email=email if not pending else "")
        response.set_cookie("reports_session", token, max_age=300 if pending else 1800, httponly=True, secure=app.config["PUBLIC_URL"].startswith("https://"), samesite="Strict")
        return response

    @app.post("/api/admin/login")
    def login():
        limit("login", 10, 600)
        limit("login-global", 200, 3600, True)
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            abort(400, "Ожидается JSON-объект.")
        current = session()
        if data.get("code") and current and current["pending"]:
            result = panel_login("2fa-login", {"tempToken": current["pending"], "code": str(data["code"])[:6]})
        else:
            email, password = data.get("email"), data.get("password")
            if not isinstance(email, str) or not isinstance(password, str) or len(email) > 254 or len(password) > 256:
                abort(400, "Укажите email и пароль администратора панели.")
            result = panel_login("login", {"email": email.strip(), "password": password})
        if result.get("requires2FA"):
            return set_session("", result["tempToken"])
        admin = result.get("admin", {})
        if result.get("refreshToken"):
            try:
                panel_login("logout", {"refreshToken": result["refreshToken"]})
            except HTTPException:
                pass
        if admin.get("role") != "ADMIN" or admin.get("mustChangePassword"):
            abort(403, "Нужен аккаунт администратора. При первом входе сначала смените пароль в панели.")
        return set_session(admin["email"])

    @app.post("/api/admin/logout")
    def logout():
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE id=?", (digest(request.cookies.get("reports_session", "")),))
        response = jsonify(ok=True)
        response.delete_cookie("reports_session")
        return response

    @app.get("/api/admin/session")
    @admin_only
    def whoami():
        return jsonify(email=g.admin["email"])

    def serialize(row, private=False):
        fields = ["id", "title", "area", "version", "steps", "expected", "actual", "status", "answer", "created", "updated"]
        if private:
            fields += ["contact", "published"]
        value = {key: row[key] for key in fields}
        if private:
            value["attachments"] = [a["id"] for a in db().execute("SELECT id FROM attachments WHERE report_id=?", (row["id"],))]
        return value

    def listing(private=False, mine=False):
        query = request.args.get("q", "").strip()[:120]
        status = request.args.get("status", "")
        try:
            page = max(1, min(10000, int(request.args.get("page", "1"))))
        except ValueError:
            abort(400, "Некорректная страница.")
        clauses, params = (["1=1"] if private else ["published=1"]), []
        if mine:
            clauses, params = ["id IN (SELECT report_id FROM owners WHERE owner=?)"], [digest(visitor())]
        if private and request.args.get("publication") == "pending":
            clauses.append("published=0")
        if query:
            clauses.append("(title LIKE ? ESCAPE '\\' OR CAST(id AS TEXT)=?)")
            params += ["%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%", query.lstrip("#")]
        if status in STATUSES:
            clauses.append("status=?")
            params.append(status)
        where = " AND ".join(clauses)
        total = db().execute("SELECT COUNT(*) FROM reports WHERE " + where, params).fetchone()[0]
        rows = db().execute("SELECT * FROM reports WHERE " + where + " ORDER BY created DESC, id DESC LIMIT 25 OFFSET ?", [*params, (page - 1) * 25]).fetchall()
        return jsonify(items=[serialize(row, private) for row in rows], total=total, page=page)

    @app.get("/api/reports")
    def reports():
        return listing()

    @app.get("/api/my-reports")
    def my_reports():
        return listing(mine=True)

    @app.get("/api/my-reports/<int:report_id>")
    def my_report(report_id):
        row = db().execute("SELECT * FROM reports WHERE id=? AND id IN (SELECT report_id FROM owners WHERE owner=?)", (report_id, digest(visitor()))).fetchone()
        if not row:
            abort(404, "Заявка не найдена в этом браузере.")
        return jsonify(serialize(row))

    @app.get("/api/admin/reports")
    @admin_only
    def admin_reports():
        return listing(True)

    @app.get("/api/reports/<int:report_id>")
    def report(report_id):
        row = db().execute("SELECT * FROM reports WHERE id=? AND published=1", (report_id,)).fetchone()
        if not row:
            abort(404, "Заявка пока не опубликована или не найдена.")
        return jsonify(serialize(row))

    @app.post("/api/reports")
    def submit():
        if shutil.disk_usage(root).free < 2 * 1024 ** 3:
            abort(503, "Приём заявок временно недоступен. Попробуйте позже.")
        limit("submit-attempt", 30, 3600)
        if request.form.get("website"):
            abort(400, "Не удалось отправить заявку.")
        verify_captcha()
        fields = {}
        for key, minimum, maximum in [("title", 5, 160), ("area", 1, 40), ("version", 0, 80), ("steps", 10, 6000), ("expected", 0, 3000), ("actual", 0, 3000), ("contact", 0, 254)]:
            value = request.form.get(key, "").strip()
            if not minimum <= len(value) <= maximum or "\x00" in value:
                abort(400, "Проверьте заголовок и описание: укажите, как повторить проблему.")
            fields[key] = value
        if fields["area"] not in AREAS:
            abort(400, "Выберите раздел.")
        files = [f for f in request.files.getlist("files") if f.filename]
        if len(files) > 3:
            abort(400, "Можно приложить не больше трёх изображений.")
        pictures = []
        for file in files:
            raw = file.stream.read(3 * 1024 * 1024 + 1)
            if len(raw) > 3 * 1024 * 1024:
                abort(400, "Каждое изображение должно быть не больше 3 МБ.")
            try:
                with Image.open(io.BytesIO(raw)) as image:
                    if image.format not in ("PNG", "JPEG", "WEBP") or image.width * image.height > 16000000:
                        abort(400, "Поддерживаются PNG, JPEG и WebP до 16 мегапикселей.")
                    image.load()
                    image.thumbnail((2400, 2400))
                    out = io.BytesIO()
                    image.convert("RGB").save(out, format="JPEG", quality=88)
                    pictures.append((secrets.token_hex(20), out.getvalue()))
            except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
                abort(400, "Не удалось прочитать изображение.")
        limit("submit", 5, 3600)
        limit("submit-global", 200, 86400, True)
        now = int(time.time())
        created_files = []
        try:
            with db() as conn:
                cursor = conn.execute("INSERT INTO reports(title,area,version,steps,expected,actual,contact,created,updated) VALUES (?,?,?,?,?,?,?,?,?)", (*fields.values(), now, now))
                report_id = cursor.lastrowid
                conn.execute("INSERT INTO owners VALUES (?,?)", (report_id, digest(visitor())))
                for name, content in pictures:
                    path = root / "uploads" / name
                    path.write_bytes(content)
                    created_files.append(path)
                    conn.execute("INSERT INTO attachments VALUES (?,?,?)", (name, report_id, "image/jpeg"))
        except Exception:
            for path in created_files:
                path.unlink(missing_ok=True)
            raise
        return jsonify(id=report_id), 201

    @app.patch("/api/admin/reports/<int:report_id>")
    @admin_only
    def update(report_id):
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            abort(400, "Ожидается JSON-объект.")
        if data.get("status") not in STATUSES or not isinstance(data.get("published"), bool) or not isinstance(data.get("answer"), str) or len(data["answer"]) > 6000:
            abort(400, "Проверьте статус и ответ.")
        with db() as conn:
            row = conn.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
            if not row:
                abort(404, "Заявка не найдена.")
            conn.execute("UPDATE reports SET status=?,published=?,answer=?,updated=? WHERE id=?", (data["status"], int(data["published"]), data["answer"].strip(), int(time.time()), report_id))
            conn.execute("INSERT INTO audit(actor,report_id,changes,created) VALUES (?,?,?,?)", (g.admin["email"], report_id, json.dumps({"before": {k: row[k] for k in ("status", "published", "answer")}, "after": data}, ensure_ascii=False), int(time.time())))
        return jsonify(ok=True)

    @app.get("/api/admin/attachments/<name>")
    @admin_only
    def attachment(name):
        row = db().execute("SELECT mime FROM attachments WHERE id=?", (name,)).fetchone()
        if not row:
            abort(404)
        return send_file(root / "uploads" / name, mimetype=row["mime"], download_name="screenshot.jpg")

    @app.get("/api/health")
    def health():
        db().execute("SELECT 1").fetchone()
        return jsonify(status="ok")

    @app.get("/")
    @app.get("/new")
    @app.get("/mine")
    @app.get("/mine/<int:report_id>")
    @app.get("/admin")
    @app.get("/r/<int:report_id>")
    def index(report_id=None):
        return app.send_static_file("index.html")

    return app


app = create_app()
