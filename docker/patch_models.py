"""Makes cline_models.py talk to OPENROUTER_BASE (the Cloudflare Worker) instead of openrouter.ai directly."""
p = "/opt/cline-auto/cline_models.py"
s = open(p, encoding="utf-8").read()
for old, new in [
    ('CATALOG_URL = "https://openrouter.ai/api/v1/models"',
     'OR_BASE = os.environ.get("OPENROUTER_BASE") or "https://openrouter.ai/api/v1"\nCATALOG_URL = OR_BASE + "/models"'),
    ('CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"', 'CHAT_URL = OR_BASE + "/chat/completions"'),
    ('"https://openrouter.ai/api/v1/key"', 'OR_BASE + "/key"'),
]:
    assert old in s, old
    s = s.replace(old, new)
open(p, "w", encoding="utf-8").write(s)
left = [l for l in s.splitlines() if "https://openrouter.ai" in l and not l.lstrip().startswith(("#", "OpenRouter's", "OR_BASE ="))]
print("remaining literal URLs:", left)
