/* ============================================================
   Chess Vision Overlay — content script
   ============================================================ */

(() => {
  "use strict";
  if (window.__chessVisionOverlayLoaded) return;
  window.__chessVisionOverlayLoaded = true;

  /* ----------------------------------------------------------
     CHESS STATE ENGINE (Rule validation, Castling, and En Passant)
     ---------------------------------------------------------- */
  let castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
  let activeEnPassant = null; // { file, color, rank }

  const KNIGHT = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  const KING   = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const BISHOP = [[1,1],[1,-1],[-1,1],[-1,-1]];
  const ROOK   = [[1,0],[-1,0],[0,1],[0,-1]];
  const QUEEN  = ROOK.concat(BISHOP);

  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const idx = (f, r) => r * 8 + f;

  function isSquareAttacked(targetF, targetR, attackerColor, occ) {
    for (let i = 0; i < 64; i++) {
      const p = occ[i];
      if (!p || p.color !== attackerColor) continue;
      const { file: f, rank: r, type: t } = p;

      if (t === "k") {
        if (Math.abs(f - targetF) <= 1 && Math.abs(r - targetR) <= 1) return true;
      } else if (t === "n") {
        const df = Math.abs(f - targetF);
        const dr = Math.abs(r - targetR);
        if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) return true;
      } else if (t === "p") {
        const d = attackerColor === "w" ? 1 : -1;
        if (targetR === r + d && (targetF === f - 1 || targetF === f + 1)) return true;
      } else if (t === "r" || t === "b" || t === "q") {
        const isRookMove = (f === targetF || r === targetR);
        const isBishopMove = (Math.abs(f - targetF) === Math.abs(r - targetR));
        if ((t === "r" && !isRookMove) || (t === "b" && !isBishopMove) || (t === "q" && !isRookMove && !isBishopMove)) {
          continue;
        }
        // Trace line of sight to make sure it is unblocked
        const df = Math.sign(targetF - f);
        const dr = Math.sign(targetR - r);
        let nf = f + df, nr = r + dr;
        let blocked = false;
        while (nf !== targetF || nr !== targetR) {
          if (occ[idx(nf, nr)]) {
            blocked = true;
            break;
          }
          nf += df; nr += dr;
        }
        if (!blocked) return true;
      }
    }
    return false;
  }

  function isKingInCheck(color, occ) {
    let kingIdx = -1;
    for (let i = 0; i < 64; i++) {
      if (occ[i] && occ[i].type === "k" && occ[i].color === color) {
        kingIdx = i;
        break;
      }
    }
    if (kingIdx === -1) return false;
    const king = occ[kingIdx];
    const opponentColor = color === "w" ? "b" : "w";
    return isSquareAttacked(king.file, king.rank, opponentColor, occ);
  }

  function isPiecePinned(p, occ) {
    if (p.type === "k") return false;
    const originalIdx = idx(p.file, p.rank);
    const currentlyInCheck = isKingInCheck(p.color, occ);
    occ[originalIdx] = null;
    const checkAfterRemoval = isKingInCheck(p.color, occ);
    occ[originalIdx] = p;
    return !currentlyInCheck && checkAfterRemoval;
  }

  function computeVisionPaths(pieces) {
    const occ = new Array(64).fill(null);
    for (const p of pieces) occ[idx(p.file, p.rank)] = p;

    const paths = [];
    const addPath = (type, color, fromF, fromR, toF, toR) => {
      paths.push({ type, color, from: { f: fromF, r: fromR }, to: { f: toF, r: toR } });
    };

    for (const p of pieces) {
      const { file: f, rank: r, color: c, type: t } = p;
      switch (t) {
        case "p": {
          const d = c === "w" ? 1 : -1;
          if (onBoard(f - 1, r + d)) addPath("pawn", c, f, r, f - 1, r + d);
          if (onBoard(f + 1, r + d)) addPath("pawn", c, f, r, f + 1, r + d);
          break;
        }
        case "n": {
          for (const [df, dr] of KNIGHT) {
            if (onBoard(f + df, r + dr)) {
              addPath("knight", c, f, r, f + df, r + dr);
            }
          }
          break;
        }
        case "k": {
          for (const [df, dr] of KING) {
            if (onBoard(f + df, r + dr)) {
              addPath("king", c, f, r, f + df, r + dr);
            }
          }
          break;
        }
        case "b":
        case "r":
        case "q": {
          const dirs = t === "b" ? BISHOP : t === "r" ? ROOK : QUEEN;
          for (const [df, dr] of dirs) {
            let nf = f + df, nr = r + dr;
            let lastF = f, lastR = r;
            let hasSteps = false;
            while (onBoard(nf, nr)) {
              lastF = nf;
              lastR = nr;
              hasSteps = true;
              if (occ[idx(nf, nr)]) break;
              nf += df; nr += dr;
            }
            if (hasSteps) {
              addPath(t === "b" ? "bishop" : t === "r" ? "rook" : "queen", c, f, r, lastF, lastR);
            }
          }
          break;
        }
      }
    }
    return paths;
  }

  function getPseudoLegalMoves(p, occ) {
    const destinations = [];
    const { file: f, rank: r, color: c, type: t } = p;

    const addDest = (nf, nr) => {
      if (onBoard(nf, nr)) {
        const target = occ[idx(nf, nr)];
        if (!target || target.color !== c) {
          destinations.push({ f: nf, r: nr });
        }
        return !target;
      }
      return false;
    };

    switch (t) {
      case "p": {
        const d = c === "w" ? 1 : -1;
        if (onBoard(f, r + d) && !occ[idx(f, r + d)]) {
          destinations.push({ f: f, r: r + d });
          const startRank = c === "w" ? 1 : 6;
          if (r === startRank && !occ[idx(f, r + 2 * d)] && !occ[idx(f, r + d)]) {
            destinations.push({ f: f, r: r + 2 * d });
          }
        }
        for (const df of [-1, 1]) {
          if (onBoard(f + df, r + d)) {
            const target = occ[idx(f + df, r + d)];
            if (target && target.color !== c) {
              destinations.push({ f: f + df, r: r + d });
            }
          }
        }
        // En Passant evaluation
        if (c === "w" && r === 4 && activeEnPassant && activeEnPassant.color === "b" && activeEnPassant.rank === 5) {
          if (Math.abs(activeEnPassant.file - f) === 1) {
            destinations.push({ f: activeEnPassant.file, r: 5 });
          }
        }
        if (c === "b" && r === 3 && activeEnPassant && activeEnPassant.color === "w" && activeEnPassant.rank === 2) {
          if (Math.abs(activeEnPassant.file - f) === 1) {
            destinations.push({ f: activeEnPassant.file, r: 2 });
          }
        }
        break;
      }
      case "n": {
        for (const [df, dr] of KNIGHT) addDest(f + df, r + dr);
        break;
      }
      case "k": {
        for (const [df, dr] of KING) addDest(f + df, r + dr);

        // Castling Kingside
        if (c === "w" && r === 0 && f === 4 && castlingRights.wK) {
          if (!occ[idx(5, 0)] && !occ[idx(6, 0)]) {
            const opponentColor = "b";
            if (!isSquareAttacked(4, 0, opponentColor, occ) &&
                !isSquareAttacked(5, 0, opponentColor, occ) &&
                !isSquareAttacked(6, 0, opponentColor, occ)) {
              destinations.push({ f: 6, r: 0 });
            }
          }
        }
        if (c === "b" && r === 7 && f === 4 && castlingRights.bK) {
          if (!occ[idx(5, 7)] && !occ[idx(6, 7)]) {
            const opponentColor = "w";
            if (!isSquareAttacked(4, 7, opponentColor, occ) &&
                !isSquareAttacked(5, 7, opponentColor, occ) &&
                !isSquareAttacked(6, 7, opponentColor, occ)) {
              destinations.push({ f: 6, r: 7 });
            }
          }
        }
        // Castling Queenside
        if (c === "w" && r === 0 && f === 4 && castlingRights.wQ) {
          if (!occ[idx(3, 0)] && !occ[idx(2, 0)] && !occ[idx(1, 0)]) {
            const opponentColor = "b";
            if (!isSquareAttacked(4, 0, opponentColor, occ) &&
                !isSquareAttacked(3, 0, opponentColor, occ) &&
                !isSquareAttacked(2, 0, opponentColor, occ)) {
              destinations.push({ f: 2, r: 0 });
            }
          }
        }
        if (c === "b" && r === 7 && f === 4 && castlingRights.bQ) {
          if (!occ[idx(3, 7)] && !occ[idx(2, 7)] && !occ[idx(1, 7)]) {
            const opponentColor = "w";
            if (!isSquareAttacked(4, 7, opponentColor, occ) &&
                !isSquareAttacked(3, 7, opponentColor, occ) &&
                !isSquareAttacked(2, 7, opponentColor, occ)) {
              destinations.push({ f: 2, r: 7 });
            }
          }
        }
        break;
      }
      case "b":
      case "r":
      case "q": {
        const dirs = t === "b" ? BISHOP : t === "r" ? ROOK : QUEEN;
        for (const [df, dr] of dirs) {
          let nf = f + df, nr = r + dr;
          while (onBoard(nf, nr)) {
            const keepGoing = addDest(nf, nr);
            if (!keepGoing) break;
            nf += df; nr += dr;
          }
        }
        break;
      }
    }
    return destinations;
  }

  function getPotentialMoves(p, occ) {
    const rawMoves = getPseudoLegalMoves(p, occ);
    const legalMoves = [];

    for (const dest of rawMoves) {
      const originalSrcIdx = idx(p.file, p.rank);
      const originalDestIdx = idx(dest.f, dest.r);
      const originalDestPiece = occ[originalDestIdx];

      // En passant check simulation
      const isEnPassant = (p.type === "p" && dest.f !== p.file && !originalDestPiece);
      const epPawnIdx = isEnPassant ? idx(dest.f, p.rank) : -1;
      const originalEpPiece = isEnPassant ? occ[epPawnIdx] : null;

      // Simulate move on board state array
      occ[originalDestIdx] = { ...p, file: dest.f, rank: dest.r };
      occ[originalSrcIdx] = null;
      if (isEnPassant) occ[epPawnIdx] = null;

      const inCheck = isKingInCheck(p.color, occ);

      // Revert board state simulation
      occ[originalSrcIdx] = p;
      occ[originalDestIdx] = originalDestPiece;
      if (isEnPassant) occ[epPawnIdx] = originalEpPiece;

      if (!inCheck) {
        legalMoves.push(dest);
      }
    }
    return legalMoves;
  }

  function updateEnPassantAndCastling(currentPieces) {
    const currMap = new Array(64).fill(null);
    for (const p of currentPieces) currMap[idx(p.file, p.rank)] = p;

    // Reset rights if start position detected
    if (currentPieces.length === 32) {
      const isInitial = currentPieces.every(p => {
        if (p.type === "k") return (p.color === "w" ? (p.file === 4 && p.rank === 0) : (p.file === 4 && p.rank === 7));
        return true;
      });
      if (isInitial) {
        castlingRights = { wK: true, wQ: true, bK: true, bQ: true };
      }
    }

    // Invalidate castling eligibility
    if (!currMap[idx(4, 0)] || currMap[idx(4, 0)].type !== "k" || currMap[idx(4, 0)].color !== "w") {
      castlingRights.wK = false; castlingRights.wQ = false;
    }
    if (!currMap[idx(4, 7)] || currMap[idx(4, 7)].type !== "k" || currMap[idx(4, 7)].color !== "b") {
      castlingRights.bK = false; castlingRights.bQ = false;
    }
    if (!currMap[idx(7, 0)] || currMap[idx(7, 0)].type !== "r" || currMap[idx(7, 0)].color !== "w") castlingRights.wK = false;
    if (!currMap[idx(0, 0)] || currMap[idx(0, 0)].type !== "r" || currMap[idx(0, 0)].color !== "w") castlingRights.wQ = false;
    if (!currMap[idx(7, 7)] || currMap[idx(7, 7)].type !== "r" || currMap[idx(7, 7)].color !== "b") castlingRights.bK = false;
    if (!currMap[idx(0, 7)] || currMap[idx(0, 7)].type !== "r" || currMap[idx(0, 7)].color !== "b") castlingRights.bQ = false;

    // Detect double-pawn advance for en passant
    if (lastRead && lastRead.pieces) {
      const prevMap = new Array(64).fill(null);
      for (const p of lastRead.pieces) prevMap[idx(p.file, p.rank)] = p;

      activeEnPassant = null;
      for (let f = 0; f < 8; f++) {
        // White double step: rank 1 to 3
        if (prevMap[idx(f, 1)]?.type === "p" && prevMap[idx(f, 1)]?.color === "w" &&
            currMap[idx(f, 3)]?.type === "p" && currMap[idx(f, 3)]?.color === "w" &&
            !prevMap[idx(f, 3)]) {
          activeEnPassant = { file: f, color: "w", rank: 2 };
        }
        // Black double step: rank 6 to 4
        if (prevMap[idx(f, 6)]?.type === "p" && prevMap[idx(f, 6)]?.color === "b" &&
            currMap[idx(f, 4)]?.type === "p" && currMap[idx(f, 4)]?.color === "b" &&
            !prevMap[idx(f, 4)]) {
          activeEnPassant = { file: f, color: "b", rank: 5 };
        }
      }
    }
  }

  /* ----------------------------------------------------------
     1. SITE ADAPTERS
     ---------------------------------------------------------- */
  function parseTranslate(transform) {
    if (!transform) return null;
    const m = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
    if (!m) return null;
    return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  }

  const LICHESS = {
    name: "lichess",
    match: () => /(^|\.)lichess\.org$/.test(location.hostname),
    getBoardElement: () => document.querySelector("cg-board") || document.querySelector(".cg-wrap cg-board"),
    read(boardEl) {
      const rect = boardEl.getBoundingClientRect();
      if (!rect.width) return null;
      const sq = rect.width / 8;

      const wrap = boardEl.closest(".cg-wrap") ||
                   document.querySelector(".cg-wrap, .orientation-white, .orientation-black");
      const whiteBottom = !(wrap && wrap.classList.contains("orientation-black"));

      const pieces = [];
      boardEl.querySelectorAll("piece").forEach(el => {
        const cls = el.classList;
        if (cls.contains("ghost") || cls.contains("fading")) return;
        const t =
          cls.contains("pawn")   ? "p" :
          cls.contains("knight") ? "n" :
          cls.contains("bishop") ? "b" :
          cls.contains("rook")   ? "r" :
          cls.contains("queen")  ? "q" :
          cls.contains("king")   ? "k" : null;
        if (!t) return;
        const color = cls.contains("white") ? "w" : cls.contains("black") ? "b" : null;
        if (!color) return;
        const tr = parseTranslate(el.style.transform);
        if (!tr) return;
        const col = Math.round(tr.x / sq);
        const row = Math.round(tr.y / sq);
        const file = whiteBottom ? col : 7 - col;
        const rank = whiteBottom ? 7 - row : row;
        if (!onBoard(file, rank)) return;
        pieces.push({ file, rank, color, type: t });
      });
      if (!pieces.length) return null;
      return { pieces, whiteBottom };
    }
  };

  const CHESSCOM = {
    name: "chess.com",
    match: () => /(^|\.)chess\.com$/.test(location.hostname),
    getBoardElement: () =>
      document.querySelector("wc-chess-board") ||
      document.querySelector("chess-board") ||
      document.querySelector("[id^='board-']") ||
      document.querySelector(".board"),
    read(boardEl) {
      const rect = boardEl.getBoundingClientRect();
      if (!rect.width) return null;

      const whiteBottom = !boardEl.classList.contains("flipped") && !boardEl.closest(".flipped");
      const pieces = [];
      boardEl.querySelectorAll(".piece").forEach(el => {
        let color = null, type = null, file = null, rank = null;
        for (const tok of el.classList) {
          let m;
          if (/^[wb][pnbrqk]$/.test(tok)) { color = tok[0]; type = tok[1]; }
          else if ((m = tok.match(/^square-([1-8])([1-8])$/))) {
            const x = +m[1];
            const y = +m[2];
            file = x - 1;
            rank = y - 1;
          }
        }
        if (color && type && file !== null && rank !== null) {
          pieces.push({ file, rank, color, type });
        }
      });
      if (!pieces.length) return null;
      return { pieces, whiteBottom };
    }
  };

  const ADAPTERS = [LICHESS, CHESSCOM];
  function activeAdapter() {
    for (const a of ADAPTERS) if (a.match()) return a;
    return null;
  }

  /* ----------------------------------------------------------
     SETTINGS (persisted via storage)
     ---------------------------------------------------------- */
  const DEFAULTS = {
    enabled: true,
    showMine: true,
    showOpp: true,
    colorblind: false,
    opacity: 30,
    hoverMode: false,
    viewMode: "both",
    theme: "classic",
    mineColor: "#22c55e",
    oppColor: "#ef4444",
    hotkeyEnabled: true
  };
  let settings = { ...DEFAULTS };

  function loadSettings() {
    return new Promise(res => {
      try {
        chrome.storage.local.get("cvoSettings", data => {
          if (data && data.cvoSettings) settings = { ...DEFAULTS, ...data.cvoSettings };
          res();
        });
      } catch { res(); }
    });
  }

  function hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 34, g: 197, b: 94 };
  }

  /* ----------------------------------------------------------
     3. RENDERER
     ---------------------------------------------------------- */
  let lastRead = null;
  let lastVisionPaths = null;
  let lastBoardEl = null;
  let activePiece = null;
  let hoveredPieceCoord = null; // { f, r }

  const svgNS = "http://www.w3.org/2000/svg";

  function ensureOverlay(boardEl) {
    let o = boardEl.querySelector(".cvo-overlay");
    if (!o) {
      o = document.createElement("div");
      o.className = "cvo-overlay";
      boardEl.appendChild(o);
    }
    return o;
  }

  function clearOverlay(boardEl) {
    if (boardEl) {
      const o = boardEl.querySelector(".cvo-overlay");
      if (o) o.innerHTML = "";
    }
  }

  function getSquareCenter(f, r, whiteBottom) {
    const screenCol = whiteBottom ? f : 7 - f;
    const screenRow = whiteBottom ? 7 - r : r;
    return {
      x: (screenCol + 0.5) * 12.5,
      y: (screenRow + 0.5) * 12.5
    };
  }

  function render(boardEl) {
    const o = ensureOverlay(boardEl);
    o.innerHTML = "";
    if (!settings.enabled || !lastVisionPaths || !lastRead) return;

    // Apply custom styling attributes to container element
    o.style.setProperty("--cvo-line-opacity", (settings.opacity / 100).toString());
    
    let activeMineColor = settings.mineColor || "#22c55e";
    let activeOppColor = settings.oppColor || "#ef4444";
    
    // Support preset themes override
    if (settings.theme === "colorblind") {
      activeMineColor = "#3b82f6";
      activeOppColor = "#f97316";
    } else if (settings.theme === "cyberpunk") {
      activeMineColor = "#06b6d4";
      activeOppColor = "#ec4899";
    } else if (settings.theme === "classic") {
      activeMineColor = "#22c55e";
      activeOppColor = "#ef4444";
    }
    
    o.style.setProperty("--cvo-mine-hex", activeMineColor);
    o.style.setProperty("--cvo-opp-hex", activeOppColor);
    
    let activeWarnColor = "#eab308";
    let activeDangerColor = activeOppColor;
    let activeDefendedMineColor = "#f97316";
    
    if (settings.theme === "colorblind") {
      activeWarnColor = "#a855f7";
      activeDangerColor = "#f97316";
      activeDefendedMineColor = "#a855f7";
    } else if (settings.theme === "cyberpunk") {
      activeWarnColor = "#f59e0b";
      activeDangerColor = "#ec4899";
      activeDefendedMineColor = "#d946ef";
    } else if (settings.theme === "classic") {
      activeWarnColor = "#eab308";
      activeDangerColor = "#ef4444";
      activeDefendedMineColor = "#f97316";
    }
    
    o.style.setProperty("--cvo-warn-hex", activeWarnColor);
    o.style.setProperty("--cvo-danger-hex", activeDangerColor);
    o.style.setProperty("--cvo-defended-mine-hex", activeDefendedMineColor);
    
    const mineRgb = hexToRgb(activeMineColor);
    const oppRgb = hexToRgb(activeOppColor);
    o.style.setProperty("--cvo-mine-rgb", `${mineRgb.r}, ${mineRgb.g}, ${mineRgb.b}`);
    o.style.setProperty("--cvo-opp-rgb", `${oppRgb.r}, ${oppRgb.g}, ${oppRgb.b}`);

    const { whiteBottom } = lastRead;
    const myColor = whiteBottom ? "w" : "b";
    const opponentColor = myColor === "w" ? "b" : "w";

    const occupiedMap = new Array(64).fill(null);
    for (const p of lastRead.pieces) {
      occupiedMap[idx(p.file, p.rank)] = p;
    }

    const fullSquareControls = Array.from({ length: 64 }, () => ({ w: [], b: [] }));
    for (const p of lastVisionPaths) {
      const targetIdx = idx(p.to.f, p.to.r);
      fullSquareControls[targetIdx][p.color].push(p);
    }

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "cvo-svg-canvas");

    // Dynamic Filter for Hover Focus Mode
    let pathsToDraw = lastVisionPaths;
    if (settings.hoverMode) {
      if (hoveredPieceCoord) {
        pathsToDraw = lastVisionPaths.filter(p => p.from.f === hoveredPieceCoord.f && p.from.r === hoveredPieceCoord.r);
      } else {
        pathsToDraw = [];
      }
    }

    // Visible controls for rendering square highlights and lines
    const visibleSquareControls = Array.from({ length: 64 }, () => ({ w: [], b: [] }));
    for (const p of pathsToDraw) {
      const targetIdx = idx(p.to.f, p.to.r);
      visibleSquareControls[targetIdx][p.color].push(p);
    }

    // 0. Draw square control highlights (Heatmap)
    if (settings.viewMode === "squares" || settings.viewMode === "both") {
      const opacityScale = 0.5; // subtle background color
      const fillOpacity = (settings.opacity / 100) * opacityScale;
      
      for (let sIdx = 0; sIdx < 64; sIdx++) {
        const file = sIdx % 8;
        const rank = Math.floor(sIdx / 8);
        
        const mineAttacks = visibleSquareControls[sIdx][myColor].length;
        const oppAttacks = visibleSquareControls[sIdx][opponentColor].length;
        
        const showMine = mineAttacks > 0 && settings.showMine;
        const showOpp = oppAttacks > 0 && settings.showOpp;
        
        if (!showMine && !showOpp) continue;
        
        const screenCol = whiteBottom ? file : 7 - file;
        const screenRow = whiteBottom ? 7 - rank : rank;
        const x = screenCol * 12.5;
        const y = screenRow * 12.5;
        
        if (showMine && !showOpp) {
          const rect = document.createElementNS(svgNS, "rect");
          rect.setAttribute("x", x);
          rect.setAttribute("y", y);
          rect.setAttribute("width", 12.5);
          rect.setAttribute("height", 12.5);
          rect.setAttribute("fill", activeMineColor);
          rect.setAttribute("fill-opacity", fillOpacity);
          svg.appendChild(rect);
        } else if (showOpp && !showMine) {
          const rect = document.createElementNS(svgNS, "rect");
          rect.setAttribute("x", x);
          rect.setAttribute("y", y);
          rect.setAttribute("width", 12.5);
          rect.setAttribute("height", 12.5);
          rect.setAttribute("fill", activeOppColor);
          rect.setAttribute("fill-opacity", fillOpacity);
          svg.appendChild(rect);
        } else if (showMine && showOpp) {
          // Contested - diagonal split
          const t1 = document.createElementNS(svgNS, "polygon");
          t1.setAttribute("points", `${x},${y} ${x + 12.5},${y} ${x},${y + 12.5}`);
          t1.setAttribute("fill", activeMineColor);
          t1.setAttribute("fill-opacity", fillOpacity);
          svg.appendChild(t1);
          
          const t2 = document.createElementNS(svgNS, "polygon");
          t2.setAttribute("points", `${x + 12.5},${y} ${x + 12.5},${y + 12.5} ${x},${y + 12.5}`);
          t2.setAttribute("fill", activeOppColor);
          t2.setAttribute("fill-opacity", fillOpacity);
          svg.appendChild(t2);
        }
      }
    }

    // 1. Draw threat lines/sight lines
    if (settings.viewMode === "lines" || settings.viewMode === "both") {
      for (const p of pathsToDraw) {
        const sideClass = (p.color === myColor) ? "mine" : "opp";
        
        const show = (sideClass === "mine" && settings.showMine) || 
                     (sideClass === "opp" && settings.showOpp);
        if (!show) continue;

        const pStart = getSquareCenter(p.from.f, p.from.r, whiteBottom);
        const pEnd = getSquareCenter(p.to.f, p.to.r, whiteBottom);

        if (p.type === "knight") {
          const mx = (pStart.x + pEnd.x) / 2;
          const my = (pStart.y + pEnd.y) / 2;
          const dx = pEnd.x - pStart.x;
          const dy = pEnd.y - pStart.y;
          const cx = mx - dy * 0.15;
          const cy = my + dx * 0.15;

          const path = document.createElementNS(svgNS, "path");
          path.setAttribute("d", `M ${pStart.x} ${pStart.y} Q ${cx} ${cy} ${pEnd.x} ${pEnd.y}`);
          path.setAttribute("class", `cvo-line cvo-line-knight cvo-side-${sideClass}`);
          svg.appendChild(path);
        } else {
          const line = document.createElementNS(svgNS, "line");
          line.setAttribute("x1", pStart.x);
          line.setAttribute("y1", pStart.y);
          line.setAttribute("x2", pEnd.x);
          line.setAttribute("y2", pEnd.y);
          line.setAttribute("class", `cvo-line cvo-line-${p.type} cvo-side-${sideClass}`);
          svg.appendChild(line);
        }
      }
    }

    // 2. Draw active piece legal move projections with recapturing support
    if (activePiece && activePiece.color === myColor) {
      const destinations = getPotentialMoves(activePiece, occupiedMap);

      for (const d of destinations) {
        const dIdx = idx(d.f, d.r);
        const oppAttacks = fullSquareControls[dIdx][opponentColor].length;
        
        // Filter out the active piece itself from defending its landing coordinate
        const friendlyAttacks = fullSquareControls[dIdx][myColor].filter(p => 
          p.from.f !== activePiece.file || p.from.r !== activePiece.rank
        ).length;

        const center = getSquareCenter(d.f, d.r, whiteBottom);

        if (oppAttacks > 0) {
          const size = 11.2;
          const half = size / 2;
          const rect = document.createElementNS(svgNS, "rect");
          rect.setAttribute("x", center.x - half);
          rect.setAttribute("y", center.y - half);
          rect.setAttribute("width", size);
          rect.setAttribute("height", size);
          rect.setAttribute("rx", "1.6");

          if (friendlyAttacks > 0) {
            // Recapturable trade options -> Yellow Frame
            rect.setAttribute("class", "cvo-dest-warn");
          } else {
            // Loose blunder -> Red Frame
            rect.setAttribute("class", "cvo-dest-danger");
          }
          svg.appendChild(rect);
        } else {
          // Pure safe squares -> Green dots
          const circle = document.createElementNS(svgNS, "circle");
          circle.setAttribute("cx", center.x);
          circle.setAttribute("cy", center.y);
          circle.setAttribute("r", "1.1");
          circle.setAttribute("class", "cvo-dest-safe");
          svg.appendChild(circle);
        }
      }
    }

    // 3. Draw tactical frame markers on occupied squares
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const sIdx = idx(f, r);
        const piece = occupiedMap[sIdx];
        if (!piece) continue;

        const whiteAttacks = fullSquareControls[sIdx].w.length;
        const blackAttacks = fullSquareControls[sIdx].b.length;

        const myAttacks = myColor === "w" ? whiteAttacks : blackAttacks;
        const oppAttacks = myColor === "w" ? blackAttacks : whiteAttacks;

        let reticleClass = null;

        if (piece.color === myColor) {
          if (oppAttacks > 0 && settings.showOpp) {
            reticleClass = (myAttacks > 0) ? "defended-mine" : "hanging-mine";
          }
        } else {
          if (myAttacks > 0 && settings.showMine) {
            reticleClass = (oppAttacks > 0) ? "defended-opp" : "hanging-opp";
          }
        }

        if (reticleClass) {
          const center = getSquareCenter(f, r, whiteBottom);
          const size = 11.2;
          const half = size / 2;

          const rect = document.createElementNS(svgNS, "rect");
          rect.setAttribute("x", center.x - half);
          rect.setAttribute("y", center.y - half);
          rect.setAttribute("width", size);
          rect.setAttribute("height", size);
          rect.setAttribute("rx", "1.6");
          rect.setAttribute("class", `cvo-reticle cvo-reticle-${reticleClass}`);
          svg.appendChild(rect);
        }

        // Draw Pin Indicator
        const isPinned = isPiecePinned(piece, occupiedMap);
        if (isPinned) {
          const center = getSquareCenter(f, r, whiteBottom);
          const circle = document.createElementNS(svgNS, "circle");
          circle.setAttribute("cx", center.x);
          circle.setAttribute("cy", center.y);
          circle.setAttribute("r", "5.2");
          circle.setAttribute("class", "cvo-reticle-pinned");
          svg.appendChild(circle);
        }

        // Draw Multiple Attacker Badge
        if (piece.color === myColor && oppAttacks > 1 && settings.showOpp) {
          const screenCol = whiteBottom ? f : 7 - f;
          const screenRow = whiteBottom ? 7 - r : r;
          const x = screenCol * 12.5;
          const y = screenRow * 12.5;

          const badgeGroup = document.createElementNS(svgNS, "g");
          badgeGroup.setAttribute("class", "cvo-attacker-badge");

          const badgeCircle = document.createElementNS(svgNS, "circle");
          badgeCircle.setAttribute("cx", x + 10.5);
          badgeCircle.setAttribute("cy", y + 2.0);
          badgeCircle.setAttribute("r", "1.3");
          badgeCircle.setAttribute("fill", activeOppColor);
          badgeCircle.setAttribute("stroke", "#ffffff");
          badgeCircle.setAttribute("stroke-width", "0.2");
          badgeGroup.appendChild(badgeCircle);

          const badgeText = document.createElementNS(svgNS, "text");
          badgeText.setAttribute("x", x + 10.5);
          badgeText.setAttribute("y", y + 2.0);
          badgeText.setAttribute("fill", "#ffffff");
          badgeText.setAttribute("font-size", "1.5px");
          badgeText.setAttribute("font-weight", "bold");
          badgeText.setAttribute("text-anchor", "middle");
          badgeText.setAttribute("dominant-baseline", "central");
          badgeText.textContent = oppAttacks.toString();
          badgeGroup.appendChild(badgeText);

          svg.appendChild(badgeGroup);
        }
      }
    }

    o.appendChild(svg);
  }

  /* ----------------------------------------------------------
     4. CONTROLLER & DRAG HANDLERS
     ---------------------------------------------------------- */
  let observer = null;
  let rafPending = false;

  function scheduleUpdate() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; update(); });
  }

  function update() {
    const adapter = activeAdapter();
    const boardEl = adapter && adapter.getBoardElement();
    if (!boardEl) return;
    try {
      const data = adapter.read(boardEl);
      if (!data) { clearOverlay(boardEl); return; }
      
      updateEnPassantAndCastling(data.pieces);
      lastRead = data;

      if (activePiece) {
        const matches = data.pieces.some(p => 
          p.file === activePiece.file && 
          p.rank === activePiece.rank && 
          p.color === activePiece.color && 
          p.type === activePiece.type
        );
        if (!matches) activePiece = null;
      }

      lastVisionPaths = computeVisionPaths(data.pieces);
      render(boardEl);
    } catch (e) {
      clearOverlay(boardEl);
      console.warn("[Chess Vision Overlay]", e);
    }
  }

  function handleBoardPointerDown(e) {
    const pieceEl = e.target.closest("piece, .piece");
    if (!pieceEl) {
      if (activePiece) {
        activePiece = null;
        scheduleUpdate();
      }
      return;
    }

    const adapter = activeAdapter();
    const boardEl = adapter && adapter.getBoardElement();
    if (!boardEl) return;

    const data = adapter.read(boardEl);
    if (!data) return;

    const rect = boardEl.getBoundingClientRect();
    const sq = rect.width / 8;
    const pieceRect = pieceEl.getBoundingClientRect();
    const col = Math.round((pieceRect.left - rect.left) / sq);
    const row = Math.round((pieceRect.top - rect.top) / sq);
    const file = data.whiteBottom ? col : 7 - col;
    const rank = data.whiteBottom ? 7 - row : row;

    const found = data.pieces.find(p => p.file === file && p.rank === rank);
    if (found) {
      activePiece = found;
      scheduleUpdate();
    }
  }

  function handleBoardPointerOver(e) {
    if (!settings.hoverMode) return;
    const pieceEl = e.target.closest("piece, .piece");
    if (!pieceEl) {
      if (hoveredPieceCoord) {
        hoveredPieceCoord = null;
        scheduleUpdate();
      }
      return;
    }
    const adapter = activeAdapter();
    const boardEl = adapter && adapter.getBoardElement();
    if (!boardEl || !lastRead) return;

    const rect = boardEl.getBoundingClientRect();
    const sq = rect.width / 8;
    const pieceRect = pieceEl.getBoundingClientRect();
    const col = Math.round((pieceRect.left - rect.left) / sq);
    const row = Math.round((pieceRect.top - rect.top) / sq);
    const file = lastRead.whiteBottom ? col : 7 - col;
    const rank = lastRead.whiteBottom ? 7 - row : row;

    if (!hoveredPieceCoord || hoveredPieceCoord.f !== file || hoveredPieceCoord.r !== rank) {
      hoveredPieceCoord = { f: file, r: rank };
      scheduleUpdate();
    }
  }

  function attachObserver(boardEl) {
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(boardEl, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["style", "class", "transform"]
    });
  }

  function detectLoop() {
    const adapter = activeAdapter();
    const boardEl = adapter && adapter.getBoardElement();
    if (boardEl && boardEl !== lastBoardEl) {
      lastBoardEl = boardEl;
      attachObserver(boardEl);
      scheduleUpdate();
    } else if (!boardEl && lastBoardEl) {
      clearOverlay(lastBoardEl);
      lastBoardEl = null;
    }
  }

  /* ----------------------------------------------------------
     BOOT & LISTENERS
     ---------------------------------------------------------- */
  async function init() {
    await loadSettings();
    detectLoop();
    setInterval(detectLoop, 1000);

    window.addEventListener("mousedown", handleBoardPointerDown, { passive: true });
    window.addEventListener("touchstart", handleBoardPointerDown, { passive: true });
    window.addEventListener("mouseover", handleBoardPointerOver, { passive: true });

    // Ensures rapid clean up of active piece markers right when drag/drop completes
    window.addEventListener("mouseup", () => setTimeout(scheduleUpdate, 30), { passive: true });
    window.addEventListener("touchend", () => setTimeout(scheduleUpdate, 30), { passive: true });

    // Global Keydown Hotkey Listener
    window.addEventListener("keydown", (e) => {
      if (!settings.hotkeyEnabled) return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key.toLowerCase() === "v") {
        settings.enabled = !settings.enabled;
        chrome.storage.local.set({ cvoSettings: settings });
      }
    });

    // Handle messages (e.g. from popup for board detection PING)
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "PING") {
          const adapter = activeAdapter();
          const boardEl = adapter && adapter.getBoardElement();
          sendResponse({
            boardDetected: !!boardEl,
            site: adapter ? adapter.name : null
          });
        }
        return true;
      });
    } catch (e) {
      console.warn("[Chess Vision Overlay] Error attaching message listener", e);
    }

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.cvoSettings) {
          settings = { ...DEFAULTS, ...changes.cvoSettings.newValue };
          if (lastBoardEl) {
            update();
          }
        }
      });
    } catch (e) {
      console.warn("[Chess Vision Overlay] Error attaching storage listener", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();