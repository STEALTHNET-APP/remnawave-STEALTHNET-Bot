import argparse
import ast
import datetime
import os
from pathlib import Path
import shutil
import tempfile

ORIGINAL = "def get_current_user(request: Request):\n    user_id = request.session.get('user_id')\n    if not user_id:\n        return None\n    data = load_data()\n    for u in data.get('users', []):\n        if u['id'] == user_id:\n            if not u.get('enabled', True) or u.get('role') == 'none':\n                return None\n            return u\n    return None\n"
PATCHED = "def get_current_user(request: Request):\n    data = load_data()\n    user_id = request.session.get('user_id')\n    if user_id:\n        for user in data.get('users', []):\n            if user['id'] == user_id:\n                if not user.get('enabled', True) or user.get('role') == 'none':\n                    return None\n                return user\n    auth = request.headers.get('Authorization', '')\n    if auth.lower().startswith('bearer '):\n        resolved = _resolve_api_token(data, auth[7:].strip())\n        if resolved:\n            entry, user = resolved\n            if _touch_api_token(entry):\n                save_data(data)\n            return user\n    return None\n"


def signature(source):
    return ast.dump(ast.parse(source), include_attributes=False)


def patch(path, apply=False):
    path = path.resolve(strict=True)
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "get_current_user"]
    if len(functions) != 1:
        raise ValueError("Не найдена единственная функция get_current_user; файл не изменён")
    node = functions[0]
    lines = source.splitlines(keepends=True)
    current = "".join(lines[node.lineno - 1:node.end_lineno])
    if signature(current) == signature(PATCHED):
        return "Патч уже установлен"
    if signature(current) != signature(ORIGINAL):
        raise ValueError("Эта версия Amnezia Web Panel отличается от проверенной; файл не изменён")
    for required in ("_resolve_api_token", "_touch_api_token", "load_data", "save_data"):
        if not any(isinstance(n, ast.FunctionDef) and n.name == required for n in tree.body):
            raise ValueError("В панели отсутствует поддержка API-токенов; файл не изменён")
    updated = "".join(lines[:node.lineno - 1]) + PATCHED + "".join(lines[node.end_lineno:])
    compile(updated, str(path), "exec")
    if not apply:
        return "Версия совместима. Для установки повторите с --apply"
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = path.with_name(path.name + ".stealthnet-token-auth." + stamp + ".bak")
    shutil.copy2(path, backup)
    info = path.stat()
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, info.st_mode)
        if os.geteuid() == 0:
            os.chown(tmp, info.st_uid, info.st_gid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return "Патч установлен. Перезапустите Amnezia Web Panel. Резервная копия: " + str(backup)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Совместимость API-токенов Amnezia Web Panel со STEALTHNET")
    parser.add_argument("app_py", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        print(patch(args.app_py, args.apply))
    except (OSError, ValueError, SyntaxError) as error:
        parser.exit(1, str(error) + "\n")
