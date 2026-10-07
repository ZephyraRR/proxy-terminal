"""Queries test/fake.log (JSON lines written by fake-openrouter.js) for run-tests.sh.

  check.py count KEY WORKER MODEL STREAM   chat-completion requests (not probes); empty string = any, STREAM 1/0/-
  check.py models KEY                      sorted models used by streamed (real Cline) requests with this key
  check.py url KEY WORKER URL              requests to URL with this key through this worker
"""
import json
import os
import sys

log = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake.log")
rows = [json.loads(line) for line in open(log) if line.strip()]
mode = sys.argv[1]
if mode == "count":
    key, worker, model, stream = sys.argv[2:6]
    n = [r for r in rows
         if r["url"] == "/api/v1/chat/completions" and not r["probe"]
         and (not key or r["auth"] == key) and (not worker or r["worker"] == worker)
         and (not model or r["model"] == model) and (stream == "-" or r["stream"] == (stream == "1"))]
    print(len(n))
elif mode == "models":
    seen = []
    for r in rows:
        if r["auth"] == sys.argv[2] and r["stream"] and not r["probe"] and r["model"] not in seen:
            seen.append(r["model"])
    print(" ".join(seen))
elif mode == "url":
    key, worker, url = sys.argv[2:5]
    print(len([r for r in rows if r["auth"] == key and r["worker"] == worker and r["url"] == url]))
