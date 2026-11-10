#!/usr/bin/env python3
"""
Count DeepSeek tokens offline (AI Workspace W-1, D-#1230).

Reads JSON from stdin:   {"texts": ["...", "..."]}
Writes JSON to stdout:   {"counts": [123, 456], "method": "tokenizer"}

Uses DeepSeek's official offline tokenizer package (the `deepseek_v3_tokenizer` zip linked
from api-docs.deepseek.com "Token & Token Usage"), unpacked into DEEPSEEK_TOKENIZER_DIR
(default: server/ai/deepseek_tokenizer, NOT committed — download it on the VM). The light
`tokenizers` package reads its tokenizer.json; `transformers` is the fallback, as in
DeepSeek's own demo.

The count is an estimate in DeepSeek's own words: the API's usage figures are the authority
and replace this count once a file has been sent (tokenMethod "measured").

Exit codes: 0 ok; 2 tokenizer or library missing (the server then estimates from characters);
1 bad input.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOKENIZER_DIR = os.environ.get("DEEPSEEK_TOKENIZER_DIR") or os.path.join(HERE, "deepseek_tokenizer")


def load_counter():
    path = os.path.join(TOKENIZER_DIR, "tokenizer.json")
    if not os.path.exists(path):
        return None
    try:
        from tokenizers import Tokenizer  # type: ignore

        tok = Tokenizer.from_file(path)
        return lambda t: len(tok.encode(t, add_special_tokens=False).ids)
    except ImportError:
        pass
    try:
        from transformers import AutoTokenizer  # type: ignore

        tok = AutoTokenizer.from_pretrained(TOKENIZER_DIR, trust_remote_code=True)
        return lambda t: len(tok.encode(t, add_special_tokens=False))
    except Exception:
        return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        texts = payload["texts"]
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            raise ValueError("texts must be a list of strings")
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"bad input: {e}\n")
        return 1
    count = load_counter()
    if count is None:
        sys.stderr.write(f"no tokenizer at {TOKENIZER_DIR}\n")
        return 2
    json.dump({"counts": [count(t) for t in texts], "method": "tokenizer"}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
