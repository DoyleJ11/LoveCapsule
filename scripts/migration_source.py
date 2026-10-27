"""One documented ordering fix for an EMPTY database, without changing history."""
def migration_source(path):
    source = path.read_text()
    if path.name.startswith('001_'):
        start = source.index('CREATE POLICY "Users can view partner profile"')
        end = source.index('CREATE POLICY "Users can update own profile"')
        source = source[:start] + source[end:] + '\n' + source[start:end]
    return source
