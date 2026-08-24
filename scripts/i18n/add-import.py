import re

def add_imports(src: str, *imports: str) -> str:
    """Insert import lines after the LAST complete import statement.

    A multi-line import's continuation lines do not start with `import`, so
    matching on that alone lands inside the braces and breaks the file.
    Anchor on the line that CLOSES an import instead.
    """
    lines = src.split("\n")
    end = re.compile(r'^(?:import\b.*|\}.*)\s*from\s*".*";\s*$|^import\s+".*";\s*$')
    last = max(i for i, l in enumerate(lines) if end.match(l))
    for offset, imp in enumerate(imports):
        lines.insert(last + 1 + offset, imp)
    return "\n".join(lines)
