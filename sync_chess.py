import os
import json
import requests
from datetime import datetime

CHESS_USERNAME = "xprtaker"

DATA_FILE = "chess_history.json"
TXT_FILE = "chess_stats.txt"

headers = {"User-Agent": "GitHub-Chess-Sync/1.0 (Contact: kavinbharathi36@gmail.com)"}

def fetch_data():
    now = datetime.utcnow()
    # Fetch current month's games
    games_url = f"https://api.chess.com/pub/player/{CHESS_USERNAME}/games/{now.year}/{now.month:02d}"
    games_res = requests.get(games_url, headers=headers)
    games = games_res.json().get("games", []) if games_res.status_code == 200 else []

    # Fetch player stats (Ratings, Puzzles, etc.)
    stats_url = f"https://api.chess.com/pub/player/{CHESS_USERNAME}/stats"
    stats_res = requests.get(stats_url, headers=headers)
    stats = stats_res.json() if stats_res.status_code == 200 else {}

    return games, stats

def update_files():
    games, stats = fetch_data()
    if not games:
        print("No games retrieved.")
        return

    # Check for previously saved game URLs
    recorded_urls = set()
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            try:
                existing_data = json.load(f)
                recorded_urls = {g["url"] for g in existing_data.get("games", [])}
            except json.JSONDecodeError:
                pass

    # Detect if any new games were played
    new_games = [g for g in games if g["url"] not in recorded_urls]

    if not new_games:
        print("No new matches found since last check.")
        return

    print(f"Found {len(new_games)} new game(s)! Updating repository...")

    # Save JSON log of game URLs
    all_data = {
        "games": [{"url": g["url"], "end_time": g.get("end_time")} for g in games]
    }
    with open(DATA_FILE, "w") as f:
        json.dump(all_data, f, indent=2)

    # Format text output
    blitz_rating = stats.get("chess_blitz", {}).get("last", {}).get("rating", "N/A")
    bullet_rating = stats.get("chess_bullet", {}).get("last", {}).get("rating", "N/A")
    rapid_rating = stats.get("chess_rapid", {}).get("last", {}).get("rating", "N/A")
    tactics_rating = stats.get("tactics", {}).get("highest", {}).get("rating", "N/A")
    puzzle_rush = stats.get("puzzle_rush", {}).get("best", {}).get("score", "N/A")

    last_game = games[-1]
    last_played_time = datetime.utcfromtimestamp(last_game["end_time"]).strftime("%Y-%m-%d %H:%M UTC")

    text_content = f"""========================================
CHESS.COM ACTIVITY LOG
Last Updated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
========================================

--- PLAYER RATINGS ---
• Rapid:   {rapid_rating}
• Blitz:   {blitz_rating}
• Bullet:  {bullet_rating}
• Tactics (Peak): {tactics_rating}
• Puzzle Rush (Best): {puzzle_rush}

--- LATEST MATCH ---
• End Time: {last_played_time}
• URL: {last_game.get('url')}
• Mode: {last_game.get('time_class')}
• Rules: {last_game.get('rules')}

Total Matches Tracked This Month: {len(games)}
"""

    with open(TXT_FILE, "w") as f:
        f.write(text_content)

if __name__ == "__main__":
    update_files()
