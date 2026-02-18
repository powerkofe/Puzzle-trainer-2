import { useState, useEffect, useCallback, useRef } from "react";

// ─── Minimal Chess Engine (no external deps) ───────────────────────────────
const PIECE_SYMBOLS = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚", P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔" };
const FILES = "abcdefgh";
const RANKS = "87654321";

function squareToCoord(sq) { return [8 - parseInt(sq[1]), FILES.indexOf(sq[0])]; }
function coordToSquare(r, c) { return FILES[c] + RANKS[r]; }

// ─── Simple PGN Parser ─────────────────────────────────────────────────────
function parsePGN(pgnText) {
  const games = [];
  const gameChunks = pgnText.split(/\n(?=\[Event )/);
  for (const chunk of gameChunks) {
    if (!chunk.trim()) continue;
    const headers = {};
    const headerRegex = /\[(\w+)\s+"([^"]*)"\]/g;
    let m;
    while ((m = headerRegex.exec(chunk)) !== null) {
      headers[m[1]] = m[2];
    }
    let movesText = chunk.replace(/\[.*?\]\s*/g, "").trim();
    movesText = movesText.replace(/\{[^}]*\}/g, "");
    movesText = movesText.replace(/\([^)]*\)/g, "");
    movesText = movesText.replace(/\$\d+/g, "");
    movesText = movesText.replace(/\d+\.{3}/g, "");
    movesText = movesText.replace(/\s+/g, " ").trim();
    const tokens = movesText.split(/\s+/).filter(t => t && !t.match(/^[\d.]+$/) && !["1-0","0-1","1/2-1/2","*"].includes(t));
    const moves = tokens.filter(t => t.match(/^[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?$|^O-O(?:-O)?[+#]?$/));
    if (moves.length >= 10) {
      games.push({ headers, moves });
    }
  }
  return games;
}

// ─── Chess Position Engine ──────────────────────────────────────────────────
const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function fenToBoard(fen) {
  const parts = fen.split(" ");
  const rows = parts[0].split("/");
  const board = [];
  for (const row of rows) {
    const r = [];
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") { for (let i = 0; i < parseInt(ch); i++) r.push(null); }
      else { r.push(ch); }
    }
    board.push(r);
  }
  return { board, turn: parts[1], castling: parts[2], enPassant: parts[3], halfmove: parseInt(parts[4]), fullmove: parseInt(parts[5]) };
}

function boardToFen(state) {
  let fen = "";
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      if (state.board[r][c] === null) { empty++; }
      else { if (empty > 0) { fen += empty; empty = 0; } fen += state.board[r][c]; }
    }
    if (empty > 0) fen += empty;
    if (r < 7) fen += "/";
  }
  return `${fen} ${state.turn} ${state.castling} ${state.enPassant} ${state.halfmove} ${state.fullmove}`;
}

function isWhite(piece) { return piece && piece === piece.toUpperCase(); }
function isBlack(piece) { return piece && piece === piece.toLowerCase(); }
function isOwnPiece(piece, turn) { return turn === "w" ? isWhite(piece) : isBlack(piece); }
function isEnemyPiece(piece, turn) { return piece !== null && !isOwnPiece(piece, turn); }

function getPieceMoves(state, r, c) {
  const piece = state.board[r][c];
  if (!piece) return [];
  const moves = [];
  const turn = state.turn;
  const board = state.board;
  const addMove = (tr, tc) => {
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) return false;
    if (isOwnPiece(board[tr][tc], turn)) return false;
    moves.push([tr, tc]);
    return board[tr][tc] === null;
  };
  const slideMoves = (dirs) => {
    for (const [dr, dc] of dirs) {
      for (let i = 1; i < 8; i++) {
        if (!addMove(r + dr * i, c + dc * i)) break;
      }
    }
  };
  const type = piece.toLowerCase();
  if (type === "p") {
    const dir = isWhite(piece) ? -1 : 1;
    const startRow = isWhite(piece) ? 6 : 1;
    if (r + dir >= 0 && r + dir <= 7 && board[r + dir][c] === null) {
      moves.push([r + dir, c]);
      if (r === startRow && board[r + 2 * dir][c] === null) moves.push([r + 2 * dir, c]);
    }
    for (const dc of [-1, 1]) {
      const tr = r + dir, tc = c + dc;
      if (tc >= 0 && tc <= 7 && tr >= 0 && tr <= 7) {
        if (isEnemyPiece(board[tr][tc], turn)) moves.push([tr, tc]);
        const epSq = state.enPassant;
        if (epSq !== "-" && coordToSquare(tr, tc) === epSq) moves.push([tr, tc]);
      }
    }
  } else if (type === "n") {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) addMove(r+dr, c+dc);
  } else if (type === "b") { slideMoves([[-1,-1],[-1,1],[1,-1],[1,1]]); }
  else if (type === "r") { slideMoves([[-1,0],[1,0],[0,-1],[0,1]]); }
  else if (type === "q") { slideMoves([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); }
  else if (type === "k") {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) addMove(r+dr, c+dc);
    // Castling
    const row = isWhite(piece) ? 7 : 0;
    const ks = isWhite(piece) ? "K" : "k";
    const qs = isWhite(piece) ? "Q" : "q";
    if (r === row && c === 4) {
      if (state.castling.includes(ks) && board[row][5] === null && board[row][6] === null && board[row][7] !== null) {
        moves.push([row, 6]);
      }
      if (state.castling.includes(qs) && board[row][3] === null && board[row][2] === null && board[row][1] === null && board[row][0] !== null) {
        moves.push([row, 2]);
      }
    }
  }
  return moves;
}

function makeMove(state, fromR, fromC, toR, toC, promotion) {
  const newBoard = state.board.map(row => [...row]);
  const piece = newBoard[fromR][fromC];
  const captured = newBoard[toR][toC];
  const type = piece.toLowerCase();
  let newCastling = state.castling;
  let newEnPassant = "-";
  let newHalfmove = state.halfmove + 1;

  // En passant capture
  if (type === "p" && toC !== fromC && captured === null) {
    newBoard[fromR][toC] = null;
  }

  // Pawn double push
  if (type === "p" && Math.abs(toR - fromR) === 2) {
    newEnPassant = coordToSquare((fromR + toR) / 2, fromC);
  }

  // Promotion
  if (type === "p" && (toR === 0 || toR === 7)) {
    const prom = promotion || "q";
    newBoard[toR][toC] = isWhite(piece) ? prom.toUpperCase() : prom.toLowerCase();
  } else {
    newBoard[toR][toC] = piece;
  }
  newBoard[fromR][fromC] = null;

  // Castling move
  if (type === "k" && Math.abs(toC - fromC) === 2) {
    if (toC === 6) { newBoard[fromR][5] = newBoard[fromR][7]; newBoard[fromR][7] = null; }
    if (toC === 2) { newBoard[fromR][3] = newBoard[fromR][0]; newBoard[fromR][0] = null; }
  }

  // Update castling rights
  if (type === "k") { newCastling = newCastling.replace(isWhite(piece) ? /[KQ]/g : /[kq]/g, ""); }
  if (fromR === 7 && fromC === 7) newCastling = newCastling.replace("K", "");
  if (fromR === 7 && fromC === 0) newCastling = newCastling.replace("Q", "");
  if (fromR === 0 && fromC === 7) newCastling = newCastling.replace("k", "");
  if (fromR === 0 && fromC === 0) newCastling = newCastling.replace("q", "");
  if (toR === 7 && toC === 7) newCastling = newCastling.replace("K", "");
  if (toR === 7 && toC === 0) newCastling = newCastling.replace("Q", "");
  if (toR === 0 && toC === 7) newCastling = newCastling.replace("k", "");
  if (toR === 0 && toC === 0) newCastling = newCastling.replace("q", "");
  if (!newCastling) newCastling = "-";

  if (type === "p" || captured !== null) newHalfmove = 0;

  return {
    board: newBoard,
    turn: state.turn === "w" ? "b" : "w",
    castling: newCastling,
    enPassant: newEnPassant,
    halfmove: newHalfmove,
    fullmove: state.turn === "b" ? state.fullmove + 1 : state.fullmove
  };
}

function parseAlgebraic(state, moveStr) {
  let move = moveStr.replace(/[+#!?]/g, "");
  const turn = state.turn;
  const board = state.board;

  // Castling
  if (move === "O-O" || move === "O-O-O") {
    const row = turn === "w" ? 7 : 0;
    const toC = move === "O-O" ? 6 : 2;
    return { fromR: row, fromC: 4, toR: row, toC };
  }

  let promotion = null;
  if (move.includes("=")) {
    promotion = move.split("=")[1].toLowerCase();
    move = move.split("=")[0];
  }

  let pieceType = "p";
  if (move[0] >= "A" && move[0] <= "Z") {
    pieceType = move[0].toLowerCase();
    move = move.substring(1);
  }

  move = move.replace("x", "");
  const toFile = move[move.length - 2];
  const toRank = move[move.length - 1];
  const toR = 8 - parseInt(toRank);
  const toC = FILES.indexOf(toFile);

  let disambigFile = null, disambigRank = null;
  if (move.length > 2) {
    const rest = move.substring(0, move.length - 2);
    for (const ch of rest) {
      if (ch >= "a" && ch <= "h") disambigFile = FILES.indexOf(ch);
      else if (ch >= "1" && ch <= "8") disambigRank = 8 - parseInt(ch);
    }
  }

  const targetPiece = turn === "w" ? pieceType.toUpperCase() : pieceType.toLowerCase();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] !== targetPiece) continue;
      if (disambigFile !== null && c !== disambigFile) continue;
      if (disambigRank !== null && r !== disambigRank) continue;
      const legalMoves = getPieceMoves(state, r, c);
      if (legalMoves.some(([mr, mc]) => mr === toR && mc === toC)) {
        return { fromR: r, fromC: c, toR, toC, promotion };
      }
    }
  }
  return null;
}

function applyMoves(moves) {
  const positions = [];
  let state = fenToBoard(INITIAL_FEN);
  positions.push({ ...state, fen: boardToFen(state) });
  for (const moveStr of moves) {
    const parsed = parseAlgebraic(state, moveStr);
    if (!parsed) break;
    state = makeMove(state, parsed.fromR, parsed.fromC, parsed.toR, parsed.toC, parsed.promotion);
    positions.push({ ...state, fen: boardToFen(state), lastMove: moveStr });
  }
  return positions;
}

// ─── Puzzle Generator ───────────────────────────────────────────────────────
function isKingInCheck(state, color) {
  const kingPiece = color === "w" ? "K" : "k";
  let kingR = -1, kingC = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (state.board[r][c] === kingPiece) { kingR = r; kingC = c; }
  }
  if (kingR === -1) return false;
  const oppTurn = color === "w" ? "b" : "w";
  const tempState = { ...state, turn: oppTurn };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (isOwnPiece(state.board[r][c], oppTurn)) {
      const moves = getPieceMoves(tempState, r, c);
      if (moves.some(([mr, mc]) => mr === kingR && mc === kingC)) return true;
    }
  }
  return false;
}

function evaluatePosition(state) {
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = state.board[r][c];
    if (p) {
      const val = values[p.toLowerCase()];
      score += isWhite(p) ? val : -val;
    }
  }
  return score;
}

function detectTactics(preState, postState, moveStr, solutionMoves) {
  const tags = [];
  const move = moveStr;
  
  // Check
  const turnAfter = postState.turn === "w" ? "w" : "b";
  if (isKingInCheck(postState, turnAfter)) tags.push("check");
  
  // Capture
  if (move.includes("x") || moveStr.includes("x")) tags.push("capture");
  
  // Promotion
  if (move.includes("=")) tags.push("promotion");
  
  // Fork detection - simplified
  const movingColor = preState.turn;
  const parsed = parseAlgebraic(preState, moveStr);
  if (parsed) {
    const tempState = { ...postState, turn: movingColor };
    const attacks = getPieceMoves(tempState, parsed.toR, parsed.toC);
    let highValueTargets = 0;
    for (const [ar, ac] of attacks) {
      const target = postState.board[ar][ac];
      if (target && isEnemyPiece(target, movingColor)) {
        const t = target.toLowerCase();
        if (t === "q" || t === "r" || t === "k") highValueTargets++;
      }
    }
    if (highValueTargets >= 2) tags.push("fork");
  }

  // Pin detection - simplified
  if (solutionMoves && solutionMoves.length > 1) tags.push("combination");

  if (tags.length === 0) tags.push("tactic");
  return tags;
}

function generatePuzzles(games) {
  const puzzles = [];
  
  for (const game of games) {
    try {
      const positions = applyMoves(game.moves);
      if (positions.length < 12) continue;
      
      // Look for interesting positions (material swings, checks, captures)
      for (let i = 8; i < positions.length - 3; i++) {
        const scoreBefore = evaluatePosition(positions[i]);
        const scoreAfter = evaluatePosition(positions[i + 2]);
        const diff = Math.abs(scoreAfter - scoreBefore);
        
        const nextMove = game.moves[i];
        if (!nextMove) continue;
        
        const isCapture = nextMove.includes("x");
        const isCheck = nextMove.includes("+") || nextMove.includes("#");
        const isPromotion = nextMove.includes("=");
        
        if (diff >= 2 || isCheck || isCapture || isPromotion) {
          const pos = positions[i];
          const solutionMoves = game.moves.slice(i, Math.min(i + 3, game.moves.length));
          
          if (solutionMoves.length === 0) continue;
          
          const tags = detectTactics(pos, positions[i + 1] || pos, solutionMoves[0], solutionMoves);
          
          // Difficulty rating based on material diff and move complexity
          let rating = 800 + diff * 80 + (isCheck ? 100 : 0) + (solutionMoves.length > 1 ? 200 : 0);
          rating = Math.min(2000, Math.max(600, Math.round(rating / 50) * 50));
          
          puzzles.push({
            id: puzzles.length,
            fen: boardToFen(pos),
            turn: pos.turn,
            solution: solutionMoves,
            white: game.headers.White || "?",
            black: game.headers.Black || "?",
            date: game.headers.Date || "?",
            event: game.headers.Event || "?",
            moveNumber: Math.floor(i / 2) + 1,
            rating,
            tags,
            positionState: pos
          });
          
          // Skip ahead to avoid overlapping puzzles from same game
          i += 5;
        }
      }
    } catch (e) { continue; }
  }
  
  return puzzles.sort(() => Math.random() - 0.5);
}

// ─── Sample PGN Data (embedded from game1.pgn — real games) ─────────────────
const SAMPLE_PGN = `[Event "CZE-chT 1617"]
[Site "Czech Republic"]
[Date "2016.12.10"]
[Round "3.1"]
[White "Rausis, Igors"]
[Black "Kanovsky, David"]
[Result "1-0"]

1. Nf3 c5 2. c4 g6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 Nc6 6. e4 Nxd4 7. Qxd4 d6 8. Be2 Bg7 9. Be3 O-O 10. Qd2 a5 11. O-O a4 12. Rad1 Qa5 13. Bd4 Be6 14. f4 Qb4 15. a3 Qa5 16. Qe3 Rac8 17. Bb6 Qa8 18. c5 Nd7 19. cxd6 Nxb6 20. dxe7 Rfe8 21. Qxb6 Bxc3 22. bxc3 Rxe7 23. Rd6 Bb3 24. e5 Qb8 25. Bg4 Rce8 26. Bd7 Rf8 27. g3 Qa8 28. Rc1 Bc4 29. Rcd1 Bb3 30. R1d4 Qb8 31. c4 Kg7 32. Kf2 Kg8 33. R6d5 Qa8 34. Qb4 Rxd7 35. Rxd7 b5 36. cxb5 Qh1 37. Qe1 Qxh2+ 38. Ke3 Qb2 39. Rd8 Qxa3 40. Qc3 Qe7 41. Qc8 1-0

[Event "Asia-chT 15th"]
[Site "Vishakapatnam"]
[Date "2008.01.04"]
[White "Zhou, Jianchao"]
[Black "Habibulla, Fidoii"]
[Result "1-0"]

1. d4 e6 2. c4 Nf6 3. Nc3 b6 4. e4 Bb4 5. e5 Ne4 6. Qg4 Nxc3 7. a3 Bf8 8. bxc3 h6 9. Qe4 c6 10. Nf3 Bb7 11. Bd3 d5 12. exd6 Bxd6 13. Qg4 Bf8 14. O-O Nd7 15. Re1 Qf6 16. a4 Bd6 17. a5 O-O-O 18. axb6 axb6 19. Nd2 Qe7 20. Ne4 Bc7 21. Qf3 f5 22. Ng3 Qf7 23. c5 bxc5 24. Ba6 Nb8 25. Bxb7+ Kxb7 26. Bf4 cxd4 27. Reb1+ Bb6 28. c4 Qe7 29. Rxb6+ 1-0

[Event "IND-ch 39th"]
[Site "Nagpur"]
[Date "2002.02.01"]
[White "Harikrishna, Pentala"]
[Black "Gokhale, Chandrashekhar"]
[Result "1-0"]

1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. f3 O-O 5. a3 Bxc3+ 6. bxc3 d6 7. e4 b6 8. Bd3 c5 9. Ne2 Nc6 10. O-O h6 11. f4 Ba6 12. e5 Ne8 13. f5 exf5 14. Ng3 cxd4 15. Nxf5 Nxe5 16. cxd4 Nxd3 17. Qxd3 d5 18. Bxh6 f6 19. Rae1 Rf7 20. Qg3 Qc7 21. Bf4 Qxc4 22. Nh6+ Kf8 23. Bd6+ 1-0

[Event "Barcelona Sants op 19th"]
[Site "Barcelona"]
[Date "2017.08.20"]
[White "Dhulipalla, Bala Chandra Prasad"]
[Black "Liu, Manli"]
[Result "1-0"]

1. d4 Nf6 2. Bf4 d5 3. e3 e6 4. Nd2 Bd6 5. Bg3 c5 6. c3 Nc6 7. Ngf3 O-O 8. Bb5 Bxg3 9. hxg3 Qb6 10. a4 a6 11. Bxc6 bxc6 12. Qb3 Qxb3 13. Nxb3 c4 14. Nc5 Rb8 15. b3 cxb3 16. Ne5 Ne4 17. Nxe4 dxe4 18. Nxc6 Rb6 19. Ne7+ Kh8 20. Kd2 h6 21. Nxc8 Rxc8 22. Rab1 e5 23. Rb2 f6 24. Rf1 exd4 25. exd4 1-0

[Event "Reykjavik op"]
[Site "Reykjavik"]
[Date "2017.04.20"]
[White "Giri, Anish"]
[Black "Stefansson, Vignir Vatnar"]
[Result "1-0"]

1. Nf3 e6 2. c4 f5 3. g3 Nf6 4. Bg2 Be7 5. O-O O-O 6. d4 d6 7. b3 a5 8. Bb2 Ne4 9. Nbd2 Nxd2 10. Qxd2 Nd7 11. a4 d5 12. e3 c6 13. Rfc1 Bd6 14. cxd5 exd5 15. Ba3 Bxa3 16. Rxa3 Qf6 17. b4 axb4 18. Qxb4 Qd8 19. a5 Rf6 20. Ne1 Qf8 21. Nd3 Qxb4 22. Nxb4 Kf8 23. a6 bxa6 24. Nxc6 Rd6 25. Rb3 Nf6 26. Na5 Bd7 27. Bf1 Ke7 28. Bd3 g6 29. Rb7 Ke8 30. Kg2 Rc8 31. Rc5 Ra8 32. h3 Kd8 33. Rb1 Ke7 34. Rb7 Ke8 35. Be2 Kd8 36. Bf3 Ke8 37. Rb1 Bb5 38. g4 Ra7 39. Rc8+ Rd8 40. Rxd8+ Kxd8 41. Rxb5 axb5 42. Nc6+ Kc7 43. Nxa7 Kb6 44. g5 Ne8 1-0

[Event "FIDE World Championship 2023"]
[Site "Astana, Kazakhstan"]
[Date "2023.04.18"]
[White "Nepomniachtchi, Ian"]
[Black "Liren, Ding"]
[Result "1-0"]

1. e4 e6 2. d4 d5 3. Nd2 c5 4. Ngf3 cxd4 5. Nxd4 Nf6 6. exd5 Nxd5 7. N2f3 Be7 8. Bc4 Nc6 9. Nxc6 bxc6 10. O-O O-O 11. Qe2 Bb7 12. Bd3 Qc7 13. Qe4 Nf6 14. Qh4 c5 15. Bf4 Qb6 16. Ne5 Rad8 17. Rae1 g6 18. Bg5 Rd4 19. Qh3 Qc7 20. b3 Nh5 21. f4 Bd6 22. c3 Nxf4 23. Bxf4 Rxf4 24. Rxf4 Bxe5 25. Rh4 Rd8 26. Be4 Bxe4 27. Rhxe4 Rd5 28. Rh4 Qd6 29. Qe3 h5 30. g3 Bf6 31. Rc4 h4 32. gxh4 Rd2 33. Re2 Rd3 34. Qxc5 Rd1+ 35. Kg2 Qd3 36. Rf2 Kg7 37. Rcf4 Qxc3 1-0

[Event "FIDE World Championship 2023"]
[Site "Astana, Kazakhstan"]
[Date "2023.04.21"]
[White "Liren, Ding"]
[Black "Nepomniachtchi, Ian"]
[Result "1-0"]

1. d4 Nf6 2. Nf3 d5 3. e3 c5 4. Nbd2 cxd4 5. exd4 Qc7 6. c3 Bd7 7. Bd3 Nc6 8. O-O Bg4 9. Re1 e6 10. Nf1 Bd6 11. Bg5 O-O 12. Bxf6 gxf6 13. Ng3 f5 14. h3 Bxf3 15. Qxf3 Ne7 16. Nh5 Kh8 17. g4 Rg8 18. Kh1 Ng6 19. Bc2 Nh4 20. Qe3 Rg6 21. Rg1 f4 22. Qd3 Qe7 23. Rae1 Qg5 24. c4 dxc4 25. Qc3 b5 26. a4 b4 27. Qxc4 Rag8 28. Qc6 Bb8 29. Qb7 Rh6 30. Be4 Rf8 31. Qxb4 Qd8 32. Qc3 Ng6 33. Bg2 Qh4 34. Re2 f5 35. Rxe6 Rxh5 36. gxh5 Qxh5 37. d5+ Kg8 38. d6 1-0

[Event "Live Chess"]
[Site "Chess.com"]
[Date "2023.07.01"]
[White "MagnusCarlsen"]
[Black "Opponent"]
[Result "0-1"]

1. e4 b6 2. d4 e6 3. Nf3 Bb7 4. Bd3 Nf6 5. Qe2 d5 6. e5 Nfd7 7. c3 c5 8. h4 Nc6 9. a3 Qc7 10. O-O Be7 11. b4 a6 12. Bf4 cxd4 13. cxd4 b5 14. Nbd2 Nb6 15. Nb3 Nc4 16. Nc5 a5 17. h5 h6 18. Be3 axb4 19. axb4 Nxb4 20. Rxa8+ Bxa8 21. Rb1 Bxc5 22. dxc5 Nxd3 23. Qxd3 Bc6 24. Bf4 Qe7 25. Qd4 O-O 26. Nh2 Rb8 27. Ng4 Qh4 28. f3 Qxh5 29. Bxh6 b4 30. Qf4 Qf5 31. Qc1 b3 32. Ne3 Qg6 33. Nxc4 dxc4 34. Be3 c3 0-1`;

// ─── Chess Board Component ──────────────────────────────────────────────────
const PIECE_UNICODES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
};

function ChessBoard({ fen, flipped, selectedSquare, legalMoves, onSquareClick, lastMoveFrom, lastMoveTo, highlightCorrect, highlightWrong }) {
  const state = fenToBoard(fen);
  const rows = flipped ? [0,1,2,3,4,5,6,7] : [0,1,2,3,4,5,6,7];
  const cols = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const displayRows = flipped ? [...rows].reverse() : rows;

  return (
    <div style={{ display: "inline-block", border: "3px solid #2c1810", borderRadius: "4px", overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
      {displayRows.map(r => (
        <div key={r} style={{ display: "flex" }}>
          {cols.map(c => {
            const sq = coordToSquare(r, c);
            const piece = state.board[r][c];
            const isLight = (r + c) % 2 === 0;
            const isSelected = selectedSquare === sq;
            const isLegal = legalMoves.includes(sq);
            const isLastMove = sq === lastMoveFrom || sq === lastMoveTo;
            const isCorrect = highlightCorrect === sq;
            const isWrong = highlightWrong === sq;

            let bg = isLight ? "#ebd7b2" : "#ae8a68";
            if (isLastMove) bg = isLight ? "#f6f680" : "#baca44";
            if (isSelected) bg = isLight ? "#f7ec5e" : "#dbc934";
            if (isCorrect) bg = "#7fc97f";
            if (isWrong) bg = "#e06666";

            return (
              <div
                key={sq}
                onClick={() => onSquareClick(sq, r, c)}
                style={{
                  width: 64, height: 64,
                  backgroundColor: bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative",
                  cursor: "pointer",
                  transition: "background-color 0.15s ease",
                  userSelect: "none"
                }}
              >
                {/* Coordinate labels */}
                {c === (flipped ? 7 : 0) && (
                  <span style={{ position: "absolute", top: 2, left: 3, fontSize: 10, fontWeight: 700, color: isLight ? "#ae8a68" : "#ebd7b2", fontFamily: "'DM Sans', sans-serif" }}>
                    {8 - r}
                  </span>
                )}
                {r === (flipped ? 0 : 7) && (
                  <span style={{ position: "absolute", bottom: 1, right: 3, fontSize: 10, fontWeight: 700, color: isLight ? "#ae8a68" : "#ebd7b2", fontFamily: "'DM Sans', sans-serif" }}>
                    {FILES[c]}
                  </span>
                )}
                {/* Legal move dots */}
                {isLegal && !piece && (
                  <div style={{ width: 16, height: 16, borderRadius: "50%", backgroundColor: "rgba(0,0,0,0.18)" }} />
                )}
                {isLegal && piece && (
                  <div style={{
                    position: "absolute", inset: 0,
                    borderRadius: "50%",
                    border: "4px solid rgba(0,0,0,0.18)"
                  }} />
                )}
                {/* Piece */}
                {piece && (
                  <span style={{
                    fontSize: 46, lineHeight: 1,
                    filter: isWhite(piece) ? "drop-shadow(1px 1px 1px rgba(0,0,0,0.3))" : "drop-shadow(1px 1px 1px rgba(0,0,0,0.2))",
                    color: isWhite(piece) ? "#fff" : "#1a1a1a",
                    WebkitTextStroke: isWhite(piece) ? "0.5px #666" : "none",
                    zIndex: 1
                  }}>
                    {PIECE_UNICODES[piece]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Tag Colors ─────────────────────────────────────────────────────────────
const TAG_COLORS = {
  capture: { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" },
  check: { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" },
  combination: { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd" },
  fork: { bg: "#f3e8ff", text: "#6b21a8", border: "#c4b5fd" },
  promotion: { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7" },
  tactic: { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" },
  pin: { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4" }
};

// ─── Main App ───────────────────────────────────────────────────────────────
export default function PuzzleTrainer() {
  const [allPuzzles, setAllPuzzles] = useState([]);
  const [filteredPuzzles, setFilteredPuzzles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [difficulty, setDifficulty] = useState("all");
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalMoves, setLegalMoves] = useState([]);
  const [currentFen, setCurrentFen] = useState(INITIAL_FEN);
  const [solutionStep, setSolutionStep] = useState(0);
  const [status, setStatus] = useState("playing"); // playing, correct, wrong, complete
  const [highlightCorrect, setHighlightCorrect] = useState(null);
  const [highlightWrong, setHighlightWrong] = useState(null);
  const [lastMoveFrom, setLastMoveFrom] = useState(null);
  const [lastMoveTo, setLastMoveTo] = useState(null);
  const [score, setScore] = useState({ correct: 0, wrong: 0 });
  const [loaded, setLoaded] = useState(false);

  // Initialize puzzles
  useEffect(() => {
    const games = parsePGN(SAMPLE_PGN);
    const puzzles = generatePuzzles(games);
    setAllPuzzles(puzzles);
    setFilteredPuzzles(puzzles);
    setLoaded(true);
    if (puzzles.length > 0) {
      setCurrentFen(puzzles[0].fen);
    }
  }, []);

  // Filter puzzles
  useEffect(() => {
    let filtered = allPuzzles;
    if (difficulty === "easy") filtered = allPuzzles.filter(p => p.rating < 1100);
    else if (difficulty === "medium") filtered = allPuzzles.filter(p => p.rating >= 1100 && p.rating < 1400);
    else if (difficulty === "hard") filtered = allPuzzles.filter(p => p.rating >= 1400);
    
    setFilteredPuzzles(filtered);
    setCurrentIndex(0);
    if (filtered.length > 0) {
      resetPuzzle(filtered[0]);
    }
  }, [difficulty, allPuzzles]);

  const currentPuzzle = filteredPuzzles[currentIndex];

  function resetPuzzle(puzzle) {
    if (!puzzle) return;
    setCurrentFen(puzzle.fen);
    setSolutionStep(0);
    setStatus("playing");
    setSelectedSquare(null);
    setLegalMoves([]);
    setHighlightCorrect(null);
    setHighlightWrong(null);
    setLastMoveFrom(null);
    setLastMoveTo(null);
  }

  function goToNext() {
    const next = Math.min(currentIndex + 1, filteredPuzzles.length - 1);
    setCurrentIndex(next);
    resetPuzzle(filteredPuzzles[next]);
  }

  function goToPrev() {
    const prev = Math.max(currentIndex - 1, 0);
    setCurrentIndex(prev);
    resetPuzzle(filteredPuzzles[prev]);
  }

  function retry() {
    if (currentPuzzle) resetPuzzle(currentPuzzle);
  }

  function onSquareClick(sq, r, c) {
    if (status === "complete" || !currentPuzzle) return;

    const state = fenToBoard(currentFen);

    // If we already selected a piece and click a legal move
    if (selectedSquare && legalMoves.includes(sq)) {
      const [fromR, fromC] = squareToCoord(selectedSquare);
      
      // Determine promotion
      let promotion = null;
      const piece = state.board[fromR][fromC];
      if (piece && piece.toLowerCase() === "p" && (r === 0 || r === 7)) {
        promotion = "q"; // Auto-promote to queen
      }
      
      const newState = makeMove(state, fromR, fromC, r, c, promotion);
      const playerMove = buildMoveNotation(state, fromR, fromC, r, c, promotion);
      
      // Check if move matches solution
      const expectedMove = currentPuzzle.solution[solutionStep];
      if (movesMatch(playerMove, expectedMove, state, fromR, fromC, r, c)) {
        // Correct move
        const newFen = boardToFen(newState);
        setCurrentFen(newFen);
        setLastMoveFrom(selectedSquare);
        setLastMoveTo(sq);
        setHighlightCorrect(sq);
        setHighlightWrong(null);
        setSelectedSquare(null);
        setLegalMoves([]);
        
        const nextStep = solutionStep + 1;
        
        if (nextStep >= currentPuzzle.solution.length) {
          setStatus("complete");
          setScore(prev => ({ ...prev, correct: prev.correct + 1 }));
        } else {
          // Play opponent's response after a short delay
          setSolutionStep(nextStep);
          setTimeout(() => {
            const oppState = fenToBoard(newFen);
            const oppMove = currentPuzzle.solution[nextStep];
            const parsed = parseAlgebraic(oppState, oppMove);
            if (parsed) {
              const afterOpp = makeMove(oppState, parsed.fromR, parsed.fromC, parsed.toR, parsed.toC, parsed.promotion);
              const afterOppFen = boardToFen(afterOpp);
              setCurrentFen(afterOppFen);
              setLastMoveFrom(coordToSquare(parsed.fromR, parsed.fromC));
              setLastMoveTo(coordToSquare(parsed.toR, parsed.toC));
              setHighlightCorrect(null);
              setSolutionStep(nextStep + 1);
              
              if (nextStep + 1 >= currentPuzzle.solution.length) {
                setStatus("complete");
                setScore(prev => ({ ...prev, correct: prev.correct + 1 }));
              }
            }
          }, 500);
        }
      } else {
        // Wrong move
        setHighlightWrong(sq);
        setHighlightCorrect(null);
        setStatus("wrong");
        setScore(prev => ({ ...prev, wrong: prev.wrong + 1 }));
        setSelectedSquare(null);
        setLegalMoves([]);
        
        setTimeout(() => {
          setHighlightWrong(null);
          setStatus("playing");
        }, 1200);
      }
      return;
    }

    // Select a piece
    const piece = state.board[r][c];
    if (piece && isOwnPiece(piece, state.turn)) {
      setSelectedSquare(sq);
      const moves = getPieceMoves(state, r, c);
      setLegalMoves(moves.map(([mr, mc]) => coordToSquare(mr, mc)));
    } else {
      setSelectedSquare(null);
      setLegalMoves([]);
    }
  }

  function buildMoveNotation(state, fromR, fromC, toR, toC, promotion) {
    const piece = state.board[fromR][fromC];
    const type = piece.toLowerCase();
    const captured = state.board[toR][toC] !== null || (type === "p" && fromC !== toC);
    const toSq = coordToSquare(toR, toC);
    
    if (type === "k" && Math.abs(toC - fromC) === 2) {
      return toC === 6 ? "O-O" : "O-O-O";
    }
    
    let notation = "";
    if (type !== "p") notation += type.toUpperCase();
    if (type === "p" && captured) notation += FILES[fromC];
    if (captured) notation += "x";
    notation += toSq;
    if (promotion) notation += "=" + promotion.toUpperCase();
    
    return notation;
  }

  function movesMatch(playerMove, expectedMove, state, fromR, fromC, toR, toC) {
    if (!expectedMove) return false;
    const clean = (m) => m.replace(/[+#!?]/g, "").replace(/\s/g, "");
    if (clean(playerMove) === clean(expectedMove)) return true;
    
    // Also try matching by parsing the expected move
    const parsed = parseAlgebraic(state, expectedMove);
    if (parsed && parsed.fromR === fromR && parsed.fromC === fromC && parsed.toR === toR && parsed.toC === toC) return true;
    
    return false;
  }

  const flipped = currentPuzzle && currentPuzzle.turn === "b";

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(145deg, #1a1512 0%, #2d2520 50%, #1a1512 100%)",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      color: "#e8e0d6",
      padding: "0 16px"
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet" />
      
      {/* Header */}
      <div style={{ textAlign: "center", paddingTop: 32, paddingBottom: 8 }}>
        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 36,
          fontWeight: 800,
          color: "#f5e6d0",
          margin: 0,
          letterSpacing: "-0.5px",
          textShadow: "0 2px 8px rgba(0,0,0,0.3)"
        }}>
          ♔ Custom Puzzle Trainer
        </h1>
        <p style={{ color: "#a0907e", fontSize: 14, margin: "6px 0 0", letterSpacing: "0.5px" }}>
          Tactical puzzles generated from your games
        </p>
      </div>

      {/* Difficulty Filters */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 20, marginTop: 12, flexWrap: "wrap" }}>
        {[
          { key: "all", label: "All" },
          { key: "easy", label: "Easy", sub: "< 1100" },
          { key: "medium", label: "Medium", sub: "1100-1400" },
          { key: "hard", label: "Hard", sub: "1400+" }
        ].map(d => (
          <button
            key={d.key}
            onClick={() => setDifficulty(d.key)}
            style={{
              padding: "8px 18px",
              borderRadius: 20,
              border: difficulty === d.key ? "2px solid #c9a96e" : "2px solid #4a3f35",
              background: difficulty === d.key ? "linear-gradient(135deg, #c9a96e, #a8863a)" : "rgba(255,255,255,0.04)",
              color: difficulty === d.key ? "#1a1512" : "#b0a090",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.2s",
              fontFamily: "'DM Sans', sans-serif"
            }}
          >
            {d.label} {d.sub && <span style={{ opacity: 0.7, fontSize: 11, marginLeft: 3 }}>{d.sub}</span>}
          </button>
        ))}
      </div>

      {/* Score */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 16 }}>
        <span style={{ fontSize: 13, color: "#7fc97f" }}>✓ {score.correct}</span>
        <span style={{ fontSize: 13, color: "#e06666" }}>✗ {score.wrong}</span>
      </div>

      {!loaded || filteredPuzzles.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#8a7a6a" }}>
          {!loaded ? "Generating puzzles..." : "No puzzles match this difficulty filter. Try a different one."}
        </div>
      ) : currentPuzzle ? (
        <div style={{ display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* Board */}
          <div>
            <ChessBoard
              fen={currentFen}
              flipped={flipped}
              selectedSquare={selectedSquare}
              legalMoves={legalMoves}
              onSquareClick={onSquareClick}
              lastMoveFrom={lastMoveFrom}
              lastMoveTo={lastMoveTo}
              highlightCorrect={highlightCorrect}
              highlightWrong={highlightWrong}
            />
            {/* Prompt */}
            <div style={{
              textAlign: "center",
              marginTop: 12,
              padding: "10px 16px",
              background: "rgba(255,255,255,0.05)",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              color: status === "complete" ? "#7fc97f" : status === "wrong" ? "#e06666" : "#d4c4a8"
            }}>
              {status === "complete" ? "✓ Puzzle solved!" :
               status === "wrong" ? "✗ Not quite — try again!" :
               `${currentPuzzle.turn === "w" ? "⚪ White" : "⚫ Black"} to move — find the best move!`}
            </div>
          </div>

          {/* Info Panel */}
          <div style={{
            width: 300,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            padding: 24,
            boxShadow: "0 4px 24px rgba(0,0,0,0.2)"
          }}>
            {/* Rating */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <span style={{
                fontSize: 22,
                fontWeight: 700,
                color: currentPuzzle.rating < 1100 ? "#7fc97f" : currentPuzzle.rating < 1400 ? "#f0c040" : "#e06666",
                fontFamily: "'Playfair Display', serif"
              }}>
                Rating: {currentPuzzle.rating}
              </span>
              <span style={{ fontSize: 12, color: "#8a7a6a" }}>
                Puzzle {currentIndex + 1} of {filteredPuzzles.length}
              </span>
            </div>

            {/* Game Info */}
            <div style={{ fontSize: 13, color: "#b0a090", marginBottom: 6, lineHeight: 1.5 }}>
              {currentPuzzle.white} vs {currentPuzzle.black}
            </div>
            <div style={{ fontSize: 12, color: "#7a6a5a", marginBottom: 16 }}>
              Move {currentPuzzle.moveNumber} · {currentPuzzle.date}
            </div>

            {/* Tactical Tags */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
              {currentPuzzle.tags.map(tag => {
                const colors = TAG_COLORS[tag] || TAG_COLORS.tactic;
                return (
                  <span key={tag} style={{
                    padding: "4px 10px",
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    background: colors.bg,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    textTransform: "lowercase"
                  }}>
                    {tag}
                  </span>
                );
              })}
            </div>

            {/* Solution (shown after complete) */}
            {status === "complete" && (
              <div style={{
                background: "rgba(127,201,127,0.1)",
                border: "1px solid rgba(127,201,127,0.2)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 20
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#7fc97f", marginBottom: 6 }}>SOLUTION</div>
                <div style={{ fontSize: 14, color: "#c8d8c0", fontFamily: "monospace" }}>
                  {currentPuzzle.solution.join(" ")}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={goToPrev} disabled={currentIndex === 0} style={{
                flex: 1, padding: "10px 0", borderRadius: 8,
                border: "1px solid #4a3f35",
                background: currentIndex === 0 ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
                color: currentIndex === 0 ? "#5a4a3a" : "#b0a090",
                fontWeight: 600, fontSize: 13, cursor: currentIndex === 0 ? "default" : "pointer",
                fontFamily: "'DM Sans', sans-serif"
              }}>← Prev</button>
              
              <button onClick={retry} style={{
                flex: 1, padding: "10px 0", borderRadius: 8,
                border: "1px solid #4a3f35",
                background: "rgba(255,255,255,0.06)",
                color: "#b0a090",
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif"
              }}>Retry</button>
              
              <button onClick={goToNext} disabled={currentIndex >= filteredPuzzles.length - 1} style={{
                flex: 1, padding: "10px 0", borderRadius: 8,
                border: "none",
                background: currentIndex >= filteredPuzzles.length - 1 ? "#4a3f35" : "linear-gradient(135deg, #c9a96e, #a8863a)",
                color: currentIndex >= filteredPuzzles.length - 1 ? "#6a5a4a" : "#1a1512",
                fontWeight: 700, fontSize: 13,
                cursor: currentIndex >= filteredPuzzles.length - 1 ? "default" : "pointer",
                fontFamily: "'DM Sans', sans-serif"
              }}>Next →</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "32px 0 20px", fontSize: 11, color: "#5a4a3a" }}>
        Puzzles auto-generated from PGN games · {allPuzzles.length} puzzles available
      </div>
    </div>
  );
}
