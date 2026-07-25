const fs = require('fs');

const CHESS_COM_USERNAME = "xprtaker";
const LICHESS_USERNAME = "xprtaker";
const DATA_FILE = "chess_history.json";
const TXT_FILE = "chess_stats.txt";
const HEADERS = { "User-Agent": "GitHub-Chess-Sync/1.0 (Contact: user@example.com)" };

async function fetchChessCom() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  const gamesUrl = `https://api.chess.com/pub/player/${CHESS_COM_USERNAME}/games/${year}/${month}`;
  const statsUrl = `https://api.chess.com/pub/player/${CHESS_COM_USERNAME}/stats`;

  let games = [];
  let stats = {};

  try {
    const gamesRes = await fetch(gamesUrl, { headers: HEADERS });
    if (gamesRes.ok) {
      const data = await gamesRes.json();
      games = data.games || [];
    }

    const statsRes = await fetch(statsUrl, { headers: HEADERS });
    if (statsRes.ok) {
      stats = await statsRes.json();
    }
  } catch (error) {
    console.error("Error fetching Chess.com data:", error);
  }

  return { games, stats };
}

async function fetchLichess() {
  const userUrl = `https://lichess.org/api/user/${LICHESS_USERNAME}`;
  const gamesUrl = `https://lichess.org/api/games/user/${LICHESS_USERNAME}?max=20&pgnInBody=false&pgnInJson=true`;

  let userPerfs = {};
  let lichessGames = [];

  try {
    // 1. Fetch User Stats
    const userRes = await fetch(userUrl, { 
      headers: { ...HEADERS, "Accept": "application/json" } 
    });
    if (userRes.ok) {
      const userData = await userRes.json();
      userPerfs = userData.perfs || {};
    }

    // 2. Fetch Recent Games (NDJSON format)
    const gamesRes = await fetch(gamesUrl, { 
      headers: { ...HEADERS, "Accept": "application/x-ndjson" } 
    });

    if (gamesRes.ok) {
      const text = await gamesRes.text();
      lichessGames = text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch (error) {
    console.error("Error fetching Lichess data:", error);
  }

  return { lichessGames, userPerfs };
}

async function updateFiles() {
  const { games: chessGames, stats: chessStats } = await fetchChessCom();
  const { lichessGames, userPerfs: lichessPerfs } = await fetchLichess();

  // Safely collect recorded IDs
  const recordedUrls = new Set();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(existing.games)) {
        existing.games.forEach(g => {
          if (g && typeof g === 'object') {
            const id = g.id || g.url;
            if (id) recordedUrls.add(id);
          }
        });
      }
    } catch {
      // JSON parse fallback
    }
  }

  // Normalize game entries
  const allCurrentGames = [];
  for (const g of chessGames) {
    allCurrentGames.push({ id: g.url, platform: "Chess.com", end_time: g.end_time });
  }
  for (const g of lichessGames) {
    allCurrentGames.push({ id: g.id, platform: "Lichess", end_time: g.createdAt });
  }

  const newGames = allCurrentGames.filter(g => !recordedUrls.has(g.id));

  if (newGames.length === 0) {
    console.log("No new matches found on Chess.com or Lichess.");
    return;
  }

  console.log(`Found ${newGames.length} new game(s)! Updating logs...`);

  // Save raw JSON data
  fs.writeFileSync(DATA_FILE, JSON.stringify({ games: allCurrentGames }, null, 2));

  // Format output for text file
  const ccBlitz = chessStats?.chess_blitz?.last?.rating ?? "N/A";
  const ccRapid = chessStats?.chess_rapid?.last?.rating ?? "N/A";

  const liBlitz = lichessPerfs?.blitz?.rating ?? "N/A";
  const liRapid = lichessPerfs?.rapid?.rating ?? "N/A";

  const utcNow = new Date().toISOString().replace('T', ' ').substring(0, 16);

  const textContent = `========================================
CHESS ACTIVITY LOG (Chess.com & Lichess)
Last Updated: ${utcNow} UTC
========================================

--- CHESS.COM RATINGS ---
• Rapid: ${ccRapid}
• Blitz: ${ccBlitz}

--- LICHESS RATINGS ---
• Rapid: ${liRapid}
• Blitz: ${liBlitz}

Total Matches Tracked: ${allCurrentGames.length}
`;

  fs.writeFileSync(TXT_FILE, textContent);
}

updateFiles();
