"""Mechanical quote verification: a quote must appear in the source, whitespace-normalised.

This verifies quotation accuracy only. Whether the quote supports the conclusion is a
human judgement (Josh's acceptance check).
"""
import re


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def quote_in_source(quote: str, source: str) -> bool:
    q = norm(quote)
    return bool(q) and q in norm(source)
