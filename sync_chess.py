import os
import json
import requests
from datetime import datetime

CHESS_COM_USERNAME = "xprtaker"
LICHESS_USERNAME = "xprtaker"

DATA_FILE = "chess_history.json"
TXT_FILE = "chess_stats.txt"

HEADERS = {"User-Agent": "GitHub-Chess-Sync/1.0 (Contact: kavinbharathi36@gmail.com)"}

def fetch_chess_com():
    now = datetime.utcnow()
    games_url = f"https://api.chess.com/pub/player/{CHESS_COM_USERNAME}/games/{now.year}/{now.month:02d}"
    stats_url = f"https://api.chess.com/pub/player/{CHESS_COM_USERNAME}/stats"
    
    games_res = requests.get(games_url, headers=HEADERS)
    stats_res = requests.get(stats_url, headers=HEADERS)
    
    games = games_res.json().get("games", []) if games_res.status_code == 200 else []
    stats = stats_res.json() if stats_res.status_code == 200 else {}
    return games, stats

def fetch_lichess():
    # Lichess public API endpoint for user profile & recent games
    user_url = f"https://lichess.org/api/user/{LICHESS_USERNAME}"
    user_res = requests.get(user_url, headers={"Accept": "application/json"})
    user_data = user_res.json() if user_res.status_code == 200 else {}

    # Fetch recent games (NDJSON format, max 20)
    games_url = f"https://lichess.org/api/games/user/{LICHESS_USERNAME}?max=20&pgnInBody=false"
    games_res = requests.get(games_url, headers={"Accept": "application/x-ndjson"})
    
    lichess_games = []
    if games_res.status_code == 200 and games_res.text.strip():
        for line in games_res.text.strip().split("\n"):
            try:
                lichess_games.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    return lichess_games, user_data.get("perfs", {})

def update_files():
    chess_games, chess_stats = fetch_chess_com()
    lichess_games, lichess_perfs = fetch_lichess()

    # Collect unique game IDs
    recorded_urls = set()
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r") as f:
            try:
                existing = json.load(f)
                recorded_urls = {g["id"] for g in existing.get("games", [])}
            except json.JSONDecodeError:
                pass

    # Normalize game entries
    all_current_games = []
    for g in chess_games:
        all_current_games.append({"id": g["url"], "platform": "Chess.com", "end_time": g.get("end_time")})
    for g in lichess_games:
        all_current_games.append({"id": g.get("id"), "platform": "Lichess", "end_time": g.get("createdAt")})

    new_games = [g for g in all_current_games if g["id"] not in recorded_urls]

    if not new_games:
        print("No new matches found on Chess.com or Lichess.")
        return

    print(f"Found {len(new_games)} new game(s)! Updating logs...")

    # Save raw JSON data
    with open(DATA_FILE, "w") as f:
        json.dump({"games": all_current_games}, f, indent=2)

    # Format output for text file
    cc_blitz = chess_stats.get("chess_blitz", {}).get("last", {}).get("rating", "N/A")
    cc_rapid = chess_stats.get("chess_rapid", {}).get("last", {}).get("rating", "N/A")
    
    li_blitz = lichess_perfs.get("blitz", {}).get("rating", "N/A")
    li_rapid = lichess_perfs.get("rapid", {}).get("rating", "N/A")

    text_content = f"""========================================
CHESS ACTIVITY LOG (Chess.com & Lichess)
Last Updated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
========================================

--- CHESS.COM RATINGS ---
• Rapid: {cc_rapid}
• Blitz: {cc_blitz}

--- LICHESS RATINGS ---
• Rapid: {li_rapid}
• Blitz: {li_blitz}

Total Matches Tracked: {len(all_current_games)}
"""
    with open(TXT_FILE, "w") as f:
        f.write(text_content)

if __name__ == "__main__":
    update_files()
