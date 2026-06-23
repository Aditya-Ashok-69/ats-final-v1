from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# The system prompt now forces the LLM to normalize dates to one of these
# two formats, so we no longer need to guess across 5 formats. Keeping a
# couple of fallbacks anyway in case the model still slips.
DATE_FORMATS = ["%Y-%m", "%Y"]


def parse_date(date_str):
    if not date_str:
        return None

    date_str = str(date_str).strip()

    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue

    logger.warning("Could not parse date '%s' -- skipping this entry", date_str)
    return None


def merge_intervals(intervals):
    if not intervals:
        return []

    intervals.sort()
    merged = [intervals[0]]

    for start, end in intervals[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return merged


def calculate_experience(work_experience):
    all_intervals = []
    technical_intervals = []
    skipped_entries = 0

    now = datetime.now()

    for job in work_experience:
        start = parse_date(job.get("start_date"))
        if not start:
            skipped_entries += 1
            continue

        if job.get("currently_working"):
            end = now
        else:
            end = parse_date(job.get("end_date"))

        if not end:
            skipped_entries += 1
            continue

        if end < start:
            # Defensive: malformed/swapped dates shouldn't silently produce
            # negative experience.
            logger.warning(
                "Skipping job '%s' -- end date before start date",
                job.get("company", "unknown")
            )
            skipped_entries += 1
            continue

        all_intervals.append((start, end))

        if job.get("is_technical_role", False):
            technical_intervals.append((start, end))

    merged_all = merge_intervals(all_intervals)
    merged_technical = merge_intervals(technical_intervals)

    total_months = sum(
        (end.year - start.year) * 12 + (end.month - start.month)
        for start, end in merged_all
    )

    technical_months = sum(
        (end.year - start.year) * 12 + (end.month - start.month)
        for start, end in merged_technical
    )

    result = {
        "total_experience_years": round(total_months / 12, 1),
        "technical_experience_years": round(technical_months / 12, 1),
    }

    if skipped_entries:
        # Surface this rather than hiding it -- a recruiter/reviewer
        # should know if entries were dropped, not just see a number.
        result["skipped_entries"] = skipped_entries

    return result
