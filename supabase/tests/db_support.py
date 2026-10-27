"""Fail closed before destructive fixture resets. Production URLs are never accepted."""
import os
from urllib.parse import urlparse, parse_qs
DB = os.environ['LOVE_CAPSULE_TEST_DB']
parsed = urlparse(DB)
host = parse_qs(parsed.query).get('host', [parsed.hostname or ''])[0]
if not parsed.path.lstrip('/').startswith('lovecapsule_test_') or not (
    host in ('localhost', '127.0.0.1', '::1') or host.startswith(('/private/tmp/', '/tmp/'))
):
    raise RuntimeError('Use a LOCAL disposable database named lovecapsule_test_*. Refusing fixture reset.')
