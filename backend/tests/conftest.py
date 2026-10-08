import os
import shutil
import tempfile
from pathlib import Path


TEST_ROOT = Path(tempfile.mkdtemp(prefix='signal-clone-tests-'))
os.environ['DATABASE_URL'] = f"sqlite:///{TEST_ROOT.as_posix()}/test.db"
os.environ['UPLOAD_DIR'] = str(TEST_ROOT / 'uploads')
os.environ['APP_ENV'] = 'test'
os.environ['JWT_SECRET'] = 'test-only-secret-with-at-least-32-characters'


def pytest_sessionfinish(session, exitstatus):
    del session, exitstatus
    try:
        from app.db import engine
        engine.dispose()
    finally:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
