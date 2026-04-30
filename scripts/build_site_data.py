import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fund_catalog import FUND_CATALOG

LEGACY_STATE_PATTERN = "last_holdings_{fund_id}.json"
RAW_ROOT = ROOT_DIR / "data" / "raw"
SITE_DATA_ROOT = ROOT_DIR / "site" / "data"


def taipei_now():
    return datetime.now(timezone(timedelta(hours=8)))


def ensure_parent(path):
    path.parent.mkdir(parents=True, exist_ok=True)


def load_json(file_path):
    with file_path.open("r", encoding="utf-8") as file_handle:
        return json.load(file_handle)


def write_json(file_path, payload):
    ensure_parent(file_path)
    with file_path.open("w", encoding="utf-8") as file_handle:
        json.dump(payload, file_handle, ensure_ascii=False, indent=2)


def parse_weight(weight_value):
    try:
        return float(str(weight_value).replace("%", ""))
    except (TypeError, ValueError):
        return 0.0


def parse_shares(shares_value):
    try:
        return float(shares_value)
    except (TypeError, ValueError):
        return 0.0


def normalize_holding(holding, rank=None):
    return {
        "code": str(holding.get("code", "")).strip(),
        "name": str(holding.get("name", "")).strip(),
        "shares": parse_shares(holding.get("shares", 0)),
        "weight": f"{parse_weight(holding.get('weight', 0)):.3f}%",
        "weight_value": parse_weight(holding.get("weight", 0)),
        "rank": rank,
    }


def bootstrap_legacy_states():
    today = taipei_now().strftime("%Y-%m-%d")
    month_key = today[:7]

    for fund in FUND_CATALOG:
        fund_dir = RAW_ROOT / month_key / fund["id"]
        has_snapshots = fund_dir.exists() and any(fund_dir.glob("*.json"))
        if has_snapshots:
            continue

        legacy_path = ROOT_DIR / LEGACY_STATE_PATTERN.format(fund_id=fund["id"])
        if not legacy_path.exists():
            continue

        holdings = load_json(legacy_path)
        payload = {
            "fund_id": fund["id"],
            "fund_name": fund["name"],
            "source": fund.get("source"),
            "source_url": fund["url"],
            "snapshot_date": today,
            "holdings": holdings,
            "bootstrapped_from": legacy_path.name,
        }
        snapshot_path = fund_dir / f"{today}.json"
        write_json(snapshot_path, payload)


def read_snapshot(snapshot_path):
    payload = load_json(snapshot_path)
    snapshot_date = payload.get("snapshot_date", snapshot_path.stem)
    holdings = payload.get("holdings", payload if isinstance(payload, list) else [])
    ranked_holdings = [
        normalize_holding(holding, rank=index)
        for index, holding in enumerate(
            sorted(holdings, key=lambda item: parse_weight(item.get("weight", 0)), reverse=True),
            start=1,
        )
    ]
    return {
        "snapshot_date": snapshot_date,
        "holdings": ranked_holdings,
    }


def list_snapshots(fund_id):
    snapshots = []
    for snapshot_path in sorted(RAW_ROOT.glob(f"*/{fund_id}/*.json")):
        snapshots.append(read_snapshot(snapshot_path))
    snapshots.sort(key=lambda item: item["snapshot_date"])
    return snapshots


def build_change_summary(previous_holdings, current_holdings, fund_id):
    if not previous_holdings:
        return {
            "counts": {
                "added": 0,
                "removed": 0,
                "increased": 0,
                "decreased": 0,
            },
            "added": [],
            "removed": [],
            "increased": [],
            "decreased": [],
            "top_movers": [],
        }

    previous_map = {item["code"]: item for item in previous_holdings}
    current_map = {item["code"]: item for item in current_holdings}

    added = []
    removed = []
    increased = []
    decreased = []

    for code in sorted(current_map.keys() - previous_map.keys()):
        item = current_map[code]
        added.append({
            "fund_id": fund_id,
            "stock_code": code,
            "stock_name": item["name"],
            "weight": item["weight"],
            "shares": item["shares"],
            "change_type": "added",
            "shares_diff": item["shares"],
            "diff_lots": int(item["shares"] / 1000),
        })

    for code in sorted(previous_map.keys() - current_map.keys()):
        item = previous_map[code]
        removed.append({
            "fund_id": fund_id,
            "stock_code": code,
            "stock_name": item["name"],
            "weight": item["weight"],
            "shares": item["shares"],
            "change_type": "removed",
            "shares_diff": -item["shares"],
            "diff_lots": -int(item["shares"] / 1000),
        })

    for code in sorted(current_map.keys() & previous_map.keys()):
        current_item = current_map[code]
        previous_item = previous_map[code]
        current_shares = current_item["shares"]
        previous_shares = previous_item["shares"]

        if previous_shares <= 0 or current_shares == previous_shares:
            continue

        shares_diff = current_shares - previous_shares
        change_item = {
            "fund_id": fund_id,
            "stock_code": code,
            "stock_name": current_item["name"],
            "weight": current_item["weight"],
            "shares": current_shares,
            "shares_diff": shares_diff,
            "diff_lots": int(shares_diff / 1000),
            "change_rate": round((shares_diff / previous_shares) * 100, 2),
        }

        if shares_diff > 0:
            change_item["change_type"] = "increased"
            increased.append(change_item)
        else:
            change_item["change_type"] = "decreased"
            decreased.append(change_item)

    increased.sort(key=lambda item: abs(item["shares_diff"]), reverse=True)
    decreased.sort(key=lambda item: abs(item["shares_diff"]), reverse=True)

    all_movers = sorted(
        added + removed + increased + decreased,
        key=lambda item: abs(item["shares_diff"]),
        reverse=True,
    )

    return {
        "counts": {
            "added": len(added),
            "removed": len(removed),
            "increased": len(increased),
            "decreased": len(decreased),
        },
        "added": added,
        "removed": removed,
        "increased": increased,
        "decreased": decreased,
        "top_movers": all_movers[:10],
    }


def build_history_rows(fund, snapshots):
    history_rows = []
    previous_holdings = []
    for snapshot in snapshots:
        summary = build_change_summary(previous_holdings, snapshot["holdings"], fund["id"])
        per_code_change = {}
        for change_group in ("added", "removed", "increased", "decreased"):
            for item in summary[change_group]:
                per_code_change[item["stock_code"]] = item

        for holding in snapshot["holdings"]:
            change_item = per_code_change.get(holding["code"], {})
            history_rows.append({
                "snapshot_date": snapshot["snapshot_date"],
                "fund_id": fund["id"],
                "fund_name": fund["name"],
                "source": fund.get("source"),
                "stock_code": holding["code"],
                "stock_name": holding["name"],
                "shares": holding["shares"],
                "weight": holding["weight"],
                "weight_value": holding["weight_value"],
                "rank": holding["rank"],
                "change_type": change_item.get("change_type", "snapshot"),
                "shares_diff": change_item.get("shares_diff", 0),
                "diff_lots": change_item.get("diff_lots", 0),
                "change_rate": change_item.get("change_rate", 0),
            })

        previous_holdings = snapshot["holdings"]

    history_rows.sort(key=lambda item: (item["snapshot_date"], item["fund_id"], item["rank"]))
    return history_rows


def build_fund_payload(fund, snapshots, history_rows):
    latest_snapshot = snapshots[-1]
    previous_holdings = snapshots[-2]["holdings"] if len(snapshots) > 1 else []
    latest_changes = build_change_summary(previous_holdings, latest_snapshot["holdings"], fund["id"])

    monthly_snapshots = defaultdict(list)
    for snapshot in snapshots:
        month_key = snapshot["snapshot_date"][:7]
        monthly_snapshots[month_key].append(snapshot)

    return {
        "fund": fund,
        "snapshot_date": latest_snapshot["snapshot_date"],
        "holdings_count": len(latest_snapshot["holdings"]),
        "summary": latest_changes["counts"],
        "top_holdings": latest_snapshot["holdings"][:10],
        "top_movers": latest_changes["top_movers"][:6],
        "available_months": sorted(monthly_snapshots.keys(), reverse=True),
        "history_rows": history_rows,
        "monthly_snapshots": {
            month_key: [
                {
                    "snapshot_date": snapshot["snapshot_date"],
                    "holdings_count": len(snapshot["holdings"]),
                    "top_holdings": snapshot["holdings"][:10],
                }
                for snapshot in snapshot_list
            ]
            for month_key, snapshot_list in monthly_snapshots.items()
        },
    }


def build_site_data():
    bootstrap_legacy_states()

    generated_at = taipei_now().isoformat()
    fund_cards = []
    search_index = []
    global_top_movers = []
    latest_snapshot_date = None

    for fund in FUND_CATALOG:
        snapshots = list_snapshots(fund["id"])
        if not snapshots:
            continue

        latest_snapshot_date = max(latest_snapshot_date or snapshots[-1]["snapshot_date"], snapshots[-1]["snapshot_date"])
        history_rows = build_history_rows(fund, snapshots)
        fund_payload = build_fund_payload(fund, snapshots, history_rows)
        fund_cards.append({
            "fund": fund_payload["fund"],
            "snapshot_date": fund_payload["snapshot_date"],
            "holdings_count": fund_payload["holdings_count"],
            "summary": fund_payload["summary"],
            "top_holdings": fund_payload["top_holdings"][:3],
            "top_movers": fund_payload["top_movers"][:3],
        })
        search_index.extend(history_rows)
        global_top_movers.extend(
            {
                **mover,
                "fund_name": fund["name"],
                "snapshot_date": fund_payload["snapshot_date"],
            }
            for mover in fund_payload["top_movers"]
        )

        latest_output_path = SITE_DATA_ROOT / "latest" / f"{fund['id']}.json"
        write_json(latest_output_path, fund_payload)

        history_index_path = SITE_DATA_ROOT / "history" / fund["id"] / "index.json"
        write_json(
            history_index_path,
            {
                "fund": fund,
                "available_months": fund_payload["available_months"],
                "latest_snapshot_date": fund_payload["snapshot_date"],
            },
        )

        for month_key, snapshot_list in fund_payload["monthly_snapshots"].items():
            write_json(
                SITE_DATA_ROOT / "history" / fund["id"] / f"{month_key}.json",
                {
                    "fund": fund,
                    "month": month_key,
                    "snapshots": snapshot_list,
                },
            )

    global_top_movers.sort(key=lambda item: abs(item.get("shares_diff", 0)), reverse=True)
    search_index.sort(key=lambda item: (item["snapshot_date"], item["fund_id"], item["rank"]), reverse=True)

    summary_payload = {
        "generated_at": generated_at,
        "latest_snapshot_date": latest_snapshot_date,
        "fund_count": len(fund_cards),
        "alert_count": sum(
            1
            for card in fund_cards
            if any(card["summary"].get(key, 0) for key in ("added", "removed", "increased", "decreased"))
        ),
        "cards": fund_cards,
        "top_movers": global_top_movers[:10],
    }

    write_json(SITE_DATA_ROOT / "summary.json", summary_payload)
    write_json(SITE_DATA_ROOT / "etfs.json", fund_cards)
    write_json(SITE_DATA_ROOT / "history" / "search-index.json", search_index)


if __name__ == "__main__":
    build_site_data()
    print("✅ 已產出 site/data 靜態資料")