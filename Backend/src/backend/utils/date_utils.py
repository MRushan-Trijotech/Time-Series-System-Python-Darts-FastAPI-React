"""Date/period parsing utilities."""
import re
import pandas as pd

# Primary monthly patterns:
# "Jan (2024)", "Feb (2024)"
MONTH_ABBR_PAREN = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\(\s*(\d{4})\s*\)$",
    re.IGNORECASE,
)

# "January 2024", "Jan 2024"
MONTH_FULL_SPACE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December"
    r"|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$",
    re.IGNORECASE,
)

# Quarter patterns: "Q1 (2024)", "Q1 2024", "2024 Q1"
QUARTER_PAREN = re.compile(r"^Q([1-4])\s*\(\s*(\d{4})\s*\)$", re.IGNORECASE)
QUARTER_SPACE = re.compile(r"^Q([1-4])\s+(\d{4})$", re.IGNORECASE)
QUARTER_YEAR_FIRST = re.compile(r"^(\d{4})\s+Q([1-4])$", re.IGNORECASE)

MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4,
    "june": 6, "july": 7, "august": 8, "september": 9,
    "october": 10, "november": 11, "december": 12,
}


def parse_period_label(label: str, allow_quarter: bool = False, allow_year: bool = False) -> pd.Timestamp | None:
    """
    Parse a column header as a date period.
    By default, focuses on monthly periods (the primary forecasting grain).
    Does NOT match raw 4-digit numbers as years by default (to avoid confusing
    entity codes like 1700 or account numbers with years).
    """
    if label is None:
        return None
    s = str(label).strip()
    if not s or s.lower() in ("(all)", "date", "none", "nan"):
        return None

    # Monthly: Jan (2024)
    m = MONTH_ABBR_PAREN.fullmatch(s)
    if m:
        month = MONTH_MAP[m.group(1).lower()]
        year = int(m.group(2))
        if 1950 <= year <= 2080:
            return pd.Timestamp(year=year, month=month, day=1)

    # Monthly: Jan 2024 / January 2024
    m = MONTH_FULL_SPACE.fullmatch(s)
    if m:
        month = MONTH_MAP[m.group(1).lower()]
        year = int(m.group(2))
        if 1950 <= year <= 2080:
            return pd.Timestamp(year=year, month=month, day=1)

    if allow_quarter:
        m = QUARTER_PAREN.fullmatch(s) or QUARTER_SPACE.fullmatch(s)
        if m:
            q = int(m.group(1))
            year = int(m.group(2))
            if 1950 <= year <= 2080:
                month = (q - 1) * 3 + 1
                return pd.Timestamp(year=year, month=month, day=1)

    if allow_year:
        if s.isdigit() and len(s) == 4:
            year = int(s)
            if 1990 <= year <= 2060:
                return pd.Timestamp(year=year, month=1, day=1)

    return None


def infer_frequency(timestamps: list[pd.Timestamp]) -> str:
    if len(timestamps) < 2:
        return "MS"
    deltas = [(timestamps[i + 1] - timestamps[i]).days for i in range(len(timestamps) - 1)]
    avg = sum(deltas) / len(deltas)
    if 25 <= avg <= 35:
        return "MS"
    if 80 <= avg <= 100:
        return "QS"
    if 350 <= avg <= 380:
        return "YS"
    return "MS"
