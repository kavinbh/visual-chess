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
    const userRes = await fetch(userUrl, { 
      headers: { ...HEADERS, "Accept": "application/json" } 
    });
    if (userRes.ok) {
      const userData = await userRes.json();
      userPerfs = userData.perfs || {};
    }

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

  // Safely collect recorded IDs/URLs and keep existing history
  const recordedUrls = new Set();
  let existingGames = [];
  
  if (fs.existsSync(DATA_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(existing.games)) {
        existingGames = existing.games; // Preserve existing games
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

  // Normalize current API game entries
  const allCurrentGames = [];
  
  // 1. Process Chess.com games
  for (const g of chessGames) {
    if (g.url) {
      allCurrentGames.push({ 
        id: g.url, 
        end_time: g.end_time 
      });
    }
  }
  
  // 2. Process Lichess games (Convert ms to seconds & construct full URL)
  for (const g of lichessGames) {
    if (g.id) {
      const fullUrl = `https://lichess.org/${g.id}`;
      const endTimeInSeconds = g.createdAt ? Math.floor(g.createdAt / 1000) : null;

      allCurrentGames.push({ 
        id: fullUrl, 
        end_time: endTimeInSeconds 
      });
    }
  }

  // Filter only games that haven't been tracked yet
  const newGames = allCurrentGames.filter(g => !recordedUrls.has(g.id));

  let totalMatches = existingGames.length;

  if (newGames.length > 0) {
    console.log(`Found ${newGames.length} new game(s)! Updating logs...`);
    // APPEND new games to existing history instead of overwriting
    const updatedGames = [...existingGames, ...newGames];
    fs.writeFileSync(DATA_FILE, JSON.stringify({ games: updatedGames }, null, 2));
    totalMatches = updatedGames.length; // Ensure match count grows
  } else {
    console.log("No new matches found on Chess.com or Lichess.");
  }

  // Extract ratings for Rapid, Blitz, Bullet, AND Puzzles
  const ccBullet  = chessStats?.chess_bullet?.last?.rating ?? "N/A";
  const ccBlitz   = chessStats?.chess_blitz?.last?.rating ?? "N/A";
  const ccRapid   = chessStats?.chess_rapid?.last?.rating ?? "N/A";
  const ccPuzzle  = chessStats?.tactics?.highest?.rating ?? chessStats?.tactics?.lowest?.rating ?? "N/A";

  const liBullet  = lichessPerfs?.bullet?.rating ?? "N/A";
  const liBlitz   = lichessPerfs?.blitz?.rating ?? "N/A";
  const liRapid   = lichessPerfs?.rapid?.rating ?? "N/A";
  const liPuzzle  = lichessPerfs?.puzzle?.rating ?? "N/A";

  // Build the new stats body (excluding the timestamp)
  const newStatsBody = `--- CHESS.COM RATINGS ---
• Rapid:   ${ccRapid}
• Blitz:   ${ccBlitz}
• Bullet:  ${ccBullet}
• Puzzles: ${ccPuzzle}

--- LICHESS RATINGS ---
• Rapid:   ${liRapid}
• Blitz:   ${liBlitz}
• Bullet:  ${liBullet}
• Puzzles: ${liPuzzle}

Total Matches Tracked: ${totalMatches}`;

  // Read existing stats to check if stats actually changed (prevent empty hourly commits)
  let oldStatsBody = "";
  if (fs.existsSync(TXT_FILE)) {
    const previousTxt = fs.readFileSync(TXT_FILE, 'utf8');
    const splitIndex = previousTxt.indexOf('--- CHESS.COM RATINGS ---');
    if (splitIndex !== -1) {
      oldStatsBody = previousTxt.substring(splitIndex).trim();
    }
  }

  // Always write if there are new games OR if ratings (e.g. Puzzle ELO) have updated!
  if (newGames.length > 0 || oldStatsBody !== newStatsBody) {
    // Current UTC Timestamp string format
    const utcNow = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const textContent = `CHESS ACTIVITY LOG Last Updated: ${utcNow} UTC\n\n${newStatsBody}\n`;
    
    fs.writeFileSync(TXT_FILE, textContent);
    console.log("Stats updated successfully.");
  } else {
    console.log("Ratings unchanged and no new matches. Skipping stats update.");
  }
}

updateFiles();
