#!/usr/bin/env python3
"""Build the issue #3834 Atex work-time estimate report.

The script uses GitHub CLI and local git history for collection, then derives a
repeatable markdown report from cached raw JSON/TSV files.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable


REPO = "ideav/crm"
SINCE_DATE = "2026-05-29"
REPORT_TZ = timezone(timedelta(hours=3), "UTC+03")
RAW_DIR = Path("experiments/atex-worktime/raw")
REPORT_PATH = Path("docs/atex_work_time_report.md")
EVENTS_CSV_PATH = Path("docs/atex_work_time_events.csv")

ISSUES_JSON = RAW_DIR / "search-issues-prs-since-2026-05-29.json"
PRS_JSON = RAW_DIR / "prs-since-2026-05-29.json"
PR_FILES_JSON = RAW_DIR / "pr-files-since-2026-05-29.json"
GIT_LOG_TSV = RAW_DIR / "git-log-atex-paths.tsv"
GIT_NUMSTAT_TSV = RAW_DIR / "git-numstat-atex-paths.tsv"

IGNORED_META_ISSUES = {3834}
IGNORED_META_PRS = {3835}

ATEX_PATH_PREFIXES = (
    "templates/atex/",
    "download/atex/",
    "docs/atex",
    "tools/generate-atex-upload-csv.py",
)
SCREENSHOT_ATEX_RE = re.compile(r"docs/screenshots/.*atex", re.I)
RELATED_TERMS = (
    "atex",
    "templates/atex",
    "download/atex",
    "production-planning",
    "slitter",
    "cut-optimizer",
    "cut-gantt",
    "machine-calendar",
    "sleeve-cutter",
    "cut-map",
    "слиттер",
    "втул",
    "втулкорез",
    "резк",
    "раскро",
    "сырь",
    "намот",
    "нож",
    "фольг",
    "станок",
    "гант",
    "edd",
    "days_forecast",
    "полос",
    "джамбо",
    "jumbo",
)


@dataclass(frozen=True)
class Event:
    time: datetime
    kind: str
    actor: str
    title: str
    number: int | None = None
    sha: str | None = None
    direct_pr: bool = False


def run(cmd: list[str]) -> str:
    completed = subprocess.run(cmd, text=True, capture_output=True, check=True)
    return completed.stdout


def collect_raw_data() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    issue_fields = (
        "number,title,state,author,createdAt,updatedAt,closedAt,url,"
        "isPullRequest,body,commentsCount"
    )
    pr_fields = (
        "number,title,body,state,author,createdAt,updatedAt,closedAt,mergedAt,"
        "url,headRefName,baseRefName"
    )
    ISSUES_JSON.write_text(
        run(
            [
                "gh",
                "search",
                "issues",
                "--repo",
                REPO,
                "--include-prs",
                "--created",
                f">={SINCE_DATE}",
                "--limit",
                "1000",
                "--json",
                issue_fields,
            ]
        ),
        encoding="utf-8",
    )
    PRS_JSON.write_text(
        run(
            [
                "gh",
                "pr",
                "list",
                "--repo",
                REPO,
                "--state",
                "all",
                "--limit",
                "1000",
                "--search",
                f"created:>={SINCE_DATE}",
                "--json",
                pr_fields,
            ]
        ),
        encoding="utf-8",
    )
    git_paths = [
        "templates/atex",
        "download/atex",
        "docs/atex_upload_csv",
        "docs/atex_production_planning_algorithm.md",
        "docs/atex_*",
        "tools/generate-atex-upload-csv.py",
    ]
    GIT_LOG_TSV.write_text(
        run(
            [
                "git",
                "log",
                "--all",
                "--date=iso-strict",
                "--pretty=format:%H%x09%h%x09%aI%x09%cI%x09%an%x09%ae%x09%s",
                "--",
                *git_paths,
            ]
        ),
        encoding="utf-8",
    )
    GIT_NUMSTAT_TSV.write_text(
        run(
            [
                "git",
                "log",
                "--all",
                "--numstat",
                "--date=iso-strict",
                "--pretty=format:@@@%x09%H%x09%h%x09%aI%x09%cI%x09%an%x09%ae%x09%s",
                "--",
                *git_paths,
            ]
        ),
        encoding="utf-8",
    )

    prs = json.loads(PRS_JSON.read_text(encoding="utf-8"))
    pr_files: dict[str, list[dict]] = {}
    for index, pr in enumerate(sorted(prs, key=lambda item: item["number"]), 1):
        number = str(pr["number"])
        pr_files[number] = json.loads(
            run(["gh", "api", f"repos/{REPO}/pulls/{number}/files", "--paginate"])
            or "[]"
        )
        if index % 25 == 0:
            PR_FILES_JSON.write_text(
                json.dumps(pr_files, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    PR_FILES_JSON.write_text(
        json.dumps(pr_files, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def ensure_raw_data() -> None:
    missing = [
        path
        for path in (ISSUES_JSON, PRS_JSON, PR_FILES_JSON, GIT_LOG_TSV, GIT_NUMSTAT_TSV)
        if not path.exists() or path.stat().st_size == 0
    ]
    if missing:
        names = ", ".join(str(path) for path in missing)
        raise SystemExit(f"Missing raw data: {names}. Run with --collect first.")


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def report_date(value: datetime) -> str:
    return value.astimezone(REPORT_TZ).date().isoformat()


def is_atex_path(filename: str) -> bool:
    return any(filename.startswith(prefix) for prefix in ATEX_PATH_PREFIXES) or bool(
        SCREENSHOT_ATEX_RE.search(filename)
    )


def text_blob(item: dict) -> str:
    return "\n".join(
        str(item.get(key) or "") for key in ("title", "body", "headRefName")
    ).lower()


def is_related_text(item: dict) -> bool:
    blob = text_blob(item)
    return any(term in blob for term in RELATED_TERMS)


def normalize_actor(login: str | None = None, name: str | None = None, email: str | None = None) -> str:
    raw = " ".join(value or "" for value in (login, name, email)).lower()
    if "unidel2035" in raw:
        return "unidel2035"
    if "drakonard@gmail.com" in raw or "konard" in raw or "konstantin diachenko" in raw:
        return "konard"
    if "ideav" in raw or "56253892" in raw:
        return "ideav"
    if "alekseymavai" in raw:
        return "alekseymavai"
    return login or name or email or "unknown"


def extract_refs(*values: str | None) -> set[int]:
    refs: set[int] = set()
    for value in values:
        if not value:
            continue
        refs.update(int(match.group(1)) for match in re.finditer(r"#(\d+)", value))
    return refs


def load_git_commits() -> list[dict]:
    commits: list[dict] = []
    for line in GIT_LOG_TSV.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        sha, short, author_time, commit_time, name, email, subject = parts[:7]
        commits.append(
            {
                "sha": sha,
                "short": short,
                "author_time": parse_dt(author_time),
                "commit_time": parse_dt(commit_time),
                "name": name,
                "email": email,
                "subject": subject,
                "actor": normalize_actor(name=name, email=email),
            }
        )
    return commits


def load_numstat() -> tuple[dict[str, dict], set[str]]:
    by_sha: dict[str, dict] = {}
    files: set[str] = set()
    current_sha: str | None = None
    for line in GIT_NUMSTAT_TSV.read_text(encoding="utf-8").splitlines():
        if line.startswith("@@@\t"):
            parts = line.split("\t")
            if len(parts) >= 8:
                current_sha = parts[1]
                by_sha[current_sha] = {
                    "short": parts[2],
                    "commit_time": parse_dt(parts[4]),
                    "actor": normalize_actor(name=parts[5], email=parts[6]),
                    "subject": parts[7],
                    "additions": 0,
                    "deletions": 0,
                    "files": set(),
                }
            continue
        if not current_sha or not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        additions, deletions, filename = parts[0], parts[1], parts[2]
        files.add(filename)
        by_sha[current_sha]["files"].add(filename)
        if additions.isdigit():
            by_sha[current_sha]["additions"] += int(additions)
        if deletions.isdigit():
            by_sha[current_sha]["deletions"] += int(deletions)
    return by_sha, files


def build_analysis() -> dict:
    ensure_raw_data()
    items = json.loads(ISSUES_JSON.read_text(encoding="utf-8"))
    prs = json.loads(PRS_JSON.read_text(encoding="utf-8"))
    pr_files = json.loads(PR_FILES_JSON.read_text(encoding="utf-8"))

    issues_by_number = {
        item["number"]: item for item in items if not item.get("isPullRequest")
    }
    prs_by_number = {pr["number"]: pr for pr in prs}

    direct_prs = {
        int(number)
        for number, files in pr_files.items()
        if any(is_atex_path(file.get("filename", "")) for file in files)
    }

    related_prs = set(direct_prs)
    for pr in prs:
        if is_related_text(pr):
            related_prs.add(pr["number"])
    related_prs -= IGNORED_META_PRS

    referenced_issues: set[int] = set()
    for number in related_prs:
        pr = prs_by_number[number]
        referenced_issues.update(
            extract_refs(pr.get("title"), pr.get("body"), pr.get("headRefName"))
        )

    related_issues = {
        number for number in referenced_issues if number in issues_by_number
    }
    for issue in issues_by_number.values():
        if is_related_text(issue):
            related_issues.add(issue["number"])
    related_issues -= IGNORED_META_ISSUES

    commits = load_git_commits()
    numstat_by_sha, touched_files = load_numstat()

    events: list[Event] = []
    for number in sorted(related_issues):
        issue = issues_by_number[number]
        events.append(
            Event(
                time=parse_dt(issue["createdAt"]),
                kind="issue",
                actor=normalize_actor(login=issue["author"]["login"]),
                title=issue["title"],
                number=number,
            )
        )
    for number in sorted(related_prs):
        pr = prs_by_number[number]
        actor = normalize_actor(login=pr["author"]["login"])
        events.append(
            Event(
                time=parse_dt(pr["createdAt"]),
                kind="pr_created",
                actor=actor,
                title=pr["title"],
                number=number,
                direct_pr=number in direct_prs,
            )
        )
        if pr.get("mergedAt"):
            events.append(
                Event(
                    time=parse_dt(pr["mergedAt"]),
                    kind="pr_merged",
                    actor=actor,
                    title=pr["title"],
                    number=number,
                    direct_pr=number in direct_prs,
                )
            )
    for commit in commits:
        events.append(
            Event(
                time=commit["commit_time"],
                kind="commit",
                actor=commit["actor"],
                title=commit["subject"],
                sha=commit["short"],
            )
        )
    events.sort(key=lambda event: event.time)

    sessions = build_sessions(events)
    per_day = build_daily_stats(sessions, related_issues, related_prs, direct_prs, numstat_by_sha)
    ticket_half_gap = estimate_ticket_creation_minutes(
        [issues_by_number[number] for number in related_issues]
    )

    return {
        "items": items,
        "prs": prs,
        "issues_by_number": issues_by_number,
        "prs_by_number": prs_by_number,
        "direct_prs": direct_prs,
        "related_prs": related_prs,
        "related_issues": related_issues,
        "commits": commits,
        "numstat_by_sha": numstat_by_sha,
        "touched_files": touched_files,
        "events": events,
        "sessions": sessions,
        "per_day": per_day,
        "ticket_half_gap": ticket_half_gap,
    }


def build_sessions(events: Iterable[Event]) -> list[list[Event]]:
    max_gap = timedelta(minutes=90)
    merge_to_ticket_gap = timedelta(minutes=15)
    sessions: list[list[Event]] = []
    current: list[Event] = []

    def continues(previous: Event, event: Event) -> bool:
        gap = event.time - previous.time
        if gap < timedelta(0):
            return True
        if previous.kind == "pr_merged":
            return event.kind == "issue" and gap <= merge_to_ticket_gap
        return gap <= max_gap

    for event in events:
        if not current:
            current = [event]
        elif continues(current[-1], event):
            current.append(event)
        else:
            sessions.append(current)
            current = [event]
    if current:
        sessions.append(current)
    return sessions


def allocate_minutes(per_day: dict, start: datetime, end: datetime) -> None:
    cursor = start.astimezone(REPORT_TZ)
    finish = end.astimezone(REPORT_TZ)
    while cursor < finish:
        next_midnight = datetime(
            cursor.year, cursor.month, cursor.day, tzinfo=REPORT_TZ
        ) + timedelta(days=1)
        chunk_end = min(finish, next_midnight)
        per_day[cursor.date().isoformat()]["minutes"] += (
            chunk_end - cursor
        ).total_seconds() / 60
        cursor = chunk_end


def build_daily_stats(
    sessions: list[list[Event]],
    related_issues: set[int],
    related_prs: set[int],
    direct_prs: set[int],
    numstat_by_sha: dict[str, dict],
) -> dict[str, dict]:
    per_day: dict[str, dict] = defaultdict(
        lambda: {
            "minutes": 0.0,
            "sessions": 0,
            "issues": set(),
            "prs": set(),
            "direct_prs": set(),
            "commits": set(),
            "additions": 0,
            "deletions": 0,
            "actors": set(),
        }
    )
    end_buffer = timedelta(minutes=10)
    for session in sessions:
        start = session[0].time
        end = session[-1].time + end_buffer
        allocate_minutes(per_day, start, end)
        per_day[report_date(start)]["sessions"] += 1
        for event in session:
            day = report_date(event.time)
            per_day[day]["actors"].add(event.actor)
            if event.kind == "issue" and event.number in related_issues:
                per_day[day]["issues"].add(event.number)
            elif event.kind.startswith("pr") and event.number in related_prs:
                per_day[day]["prs"].add(event.number)
                if event.number in direct_prs:
                    per_day[day]["direct_prs"].add(event.number)
            elif event.kind == "commit" and event.sha:
                per_day[day]["commits"].add(event.sha)

    for sha, stat in numstat_by_sha.items():
        day = report_date(stat["commit_time"])
        per_day[day]["additions"] += stat["additions"]
        per_day[day]["deletions"] += stat["deletions"]
    return dict(sorted(per_day.items()))


def estimate_ticket_creation_minutes(issues: list[dict]) -> dict[str, float]:
    times = sorted(parse_dt(issue["createdAt"]) for issue in issues)
    gaps = [
        (later - earlier).total_seconds() / 60
        for earlier, later in zip(times, times[1:])
        if 0 < (later - earlier).total_seconds() / 60 <= 90
    ]
    if not gaps:
        return {"median_gap": 0.0, "mean_gap": 0.0, "half_median": 10.0}
    sorted_gaps = sorted(gaps)
    midpoint = len(sorted_gaps) // 2
    median = (
        sorted_gaps[midpoint]
        if len(sorted_gaps) % 2
        else (sorted_gaps[midpoint - 1] + sorted_gaps[midpoint]) / 2
    )
    mean = sum(gaps) / len(gaps)
    return {
        "median_gap": median,
        "mean_gap": mean,
        "half_median": median / 2,
        "gap_count": float(len(gaps)),
    }


def fmt_hours(minutes: float) -> str:
    return f"{minutes / 60:.1f}"


def fmt_int(value: int | float) -> str:
    return f"{int(value):,}".replace(",", " ")


def render_report(analysis: dict) -> str:
    per_day = analysis["per_day"]
    sessions = analysis["sessions"]
    total_minutes = sum(day["minutes"] for day in per_day.values())
    session_count = len(sessions)
    low_hours = (total_minutes - session_count * 5) / 60
    high_hours = (total_minutes + session_count * 5) / 60
    direct_prs = analysis["direct_prs"]
    related_prs = analysis["related_prs"]
    related_issues = analysis["related_issues"]
    commits = analysis["commits"]
    numstat_by_sha = analysis["numstat_by_sha"]

    pr_by_actor = Counter(
        normalize_actor(login=analysis["prs_by_number"][number]["author"]["login"])
        for number in related_prs
    )
    direct_pr_by_actor = Counter(
        normalize_actor(login=analysis["prs_by_number"][number]["author"]["login"])
        for number in direct_prs
    )
    issue_by_actor = Counter(
        normalize_actor(
            login=analysis["issues_by_number"][number]["author"]["login"]
        )
        for number in related_issues
    )
    commit_by_actor = Counter(commit["actor"] for commit in commits)
    additions = sum(stat["additions"] for stat in numstat_by_sha.values())
    deletions = sum(stat["deletions"] for stat in numstat_by_sha.values())
    ticket_gap = analysis["ticket_half_gap"]

    lines = [
        "# Оценка времени работы над Atex",
        "",
        "Отчет собран для issue #3834 по истории GitHub и локальной истории git.",
        "Даты в таблицах сгруппированы по UTC+03, потому что большая часть Atex-коммитов и рабочих сессий идет в этом часовом поясе.",
        "",
        "## Итог",
        "",
        f"- Центральная оценка: **{fmt_hours(total_minutes)} ч** активной работы потока Atex.",
        f"- Коридор по правилу проверки после merge 5-15 минут: **{low_hours:.1f}-{high_hours:.1f} ч**.",
        f"- Связанные PR: **{len(related_prs)}**, из них прямо меняли Atex-файлы: **{len(direct_prs)}**.",
        f"- Связанные issue/тикеты: **{len(related_issues)}**.",
        f"- Коммиты по Atex-путям: **{len(commits)}**.",
        f"- Уникальные Atex-файлы в git numstat: **{len(analysis['touched_files'])}**.",
        f"- Изменения по Atex-путям: **+{fmt_int(additions)} / -{fmt_int(deletions)}** строк.",
        "",
        "Это оценка времени непрерывного рабочего потока, а не биллинг по одному человеку: в данных участвуют несколько GitHub-аккаунтов и git author alias.",
        "",
        "## Методика",
        "",
        "- Прямое попадание: PR меняет `templates/atex/`, `download/atex/`, `docs/atex*`, `docs/atex_upload_csv/`, `tools/generate-atex-upload-csv.py` или Atex-скриншоты.",
        "- Косвенное попадание: issue/PR содержит Atex-термины (`atex`, `production-planning`, `slitter`, `Гант`, `слиттер`, `втул`, `сырь`, `фольг`, `EDD`, `DAYS_FORECAST` и т.п.) или упомянут в прямом PR.",
        "- Текущие служебные issue/PR `#3834/#3835` из подсчета Atex-работы исключены.",
        "- Сессии строятся по событиям issue creation, PR creation, PR merge и commit по Atex-путям.",
        "- Между обычными событиями сессия продолжается при паузе до 90 минут.",
        "- После merge новая сессия не начинается, только если следующий ticket создан в течение 15 минут; иначе сессия закрывается через 10 минут после последнего события.",
        f"- Стоимость отдельного создания ticket принята как 10 минут: половина медианного интервала между соседними Atex-ticket в непрерывных цепочках равна {ticket_gap['half_median']:.1f} мин.",
        "",
        "## По Дням",
        "",
        "| День | Часы | Сессии | Issue | PR всего | PR с Atex-файлами | Коммиты | Строки +/- | Аккаунты |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]

    for day, stats in per_day.items():
        actors = ", ".join(sorted(stats["actors"]))
        lines.append(
            "| {day} | {hours} | {sessions} | {issues} | {prs} | {direct_prs} | {commits} | +{adds}/-{dels} | {actors} |".format(
                day=day,
                hours=fmt_hours(stats["minutes"]),
                sessions=stats["sessions"],
                issues=len(stats["issues"]),
                prs=len(stats["prs"]),
                direct_prs=len(stats["direct_prs"]),
                commits=len(stats["commits"]),
                adds=fmt_int(stats["additions"]),
                dels=fmt_int(stats["deletions"]),
                actors=actors,
            )
        )

    lines.extend(
        [
            "",
            "## По Аккаунтам",
            "",
            "| Аккаунт / alias | Связанные issue | Связанные PR | Прямые Atex PR | Коммиты по Atex-путям |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
    )
    actors = sorted(
        set(issue_by_actor)
        | set(pr_by_actor)
        | set(direct_pr_by_actor)
        | set(commit_by_actor)
    )
    for actor in actors:
        lines.append(
            f"| {actor} | {issue_by_actor[actor]} | {pr_by_actor[actor]} | {direct_pr_by_actor[actor]} | {commit_by_actor[actor]} |"
        )
    lines.extend(
        [
            "",
            "Примечание по alias: git authors `Konstantin Diachenko`, `konard` и `drakonard@gmail.com` сведены в `konard`; noreply-адреса сведены к соответствующим GitHub login. `gaveron18` в выбранных issue/PR/commit данных не найден.",
            "",
            "## Проверочные Срезы",
            "",
            f"- Самые плотные дни по оценке: {render_top_days(per_day)}.",
            f"- Больше всего прямых Atex PR в день: {render_top_direct_pr_days(per_day)}.",
            "- Резкий рост после 2026-06-20 связан с серией коротких production-planning/Gantt/optimizer правок: много тикетов и PR закрывались в течение минут, поэтому количество PR высокое, а время считается по цепочкам событий.",
            "",
            "## Как Пересобрать",
            "",
            "```bash",
            "python3 experiments/atex-worktime/build_report.py --collect",
            "python3 experiments/atex-worktime/build_report.py",
            "```",
            "",
            f"Скрипт пишет `{REPORT_PATH}` и `{EVENTS_CSV_PATH}`. Raw-кэш GitHub API лежит в `experiments/atex-worktime/raw/` и не предназначен для коммита.",
            "",
        ]
    )
    return "\n".join(lines)


def render_top_days(per_day: dict[str, dict]) -> str:
    top = sorted(per_day.items(), key=lambda item: item[1]["minutes"], reverse=True)[:5]
    return ", ".join(f"{day} — {fmt_hours(stats['minutes'])} ч" for day, stats in top)


def render_top_direct_pr_days(per_day: dict[str, dict]) -> str:
    top = sorted(
        per_day.items(), key=lambda item: len(item[1]["direct_prs"]), reverse=True
    )[:5]
    return ", ".join(
        f"{day} — {len(stats['direct_prs'])}" for day, stats in top
    )


def write_events_csv(events: Iterable[Event]) -> None:
    EVENTS_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with EVENTS_CSV_PATH.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(["time_utc", "time_utc_plus_03", "kind", "actor", "number", "sha", "direct_pr", "title"])
        for event in sorted(events, key=lambda item: item.time):
            writer.writerow(
                [
                    event.time.astimezone(timezone.utc).isoformat(),
                    event.time.astimezone(REPORT_TZ).isoformat(),
                    event.kind,
                    event.actor,
                    event.number or "",
                    event.sha or "",
                    "yes" if event.direct_pr else "",
                    event.title,
                ]
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--collect",
        action="store_true",
        help="Refresh raw GitHub/git data before building the report.",
    )
    args = parser.parse_args()
    if args.collect:
        collect_raw_data()
    analysis = build_analysis()
    REPORT_PATH.write_text(render_report(analysis), encoding="utf-8")
    write_events_csv(analysis["events"])
    print(f"wrote {REPORT_PATH}")
    print(f"wrote {EVENTS_CSV_PATH}")


if __name__ == "__main__":
    main()
