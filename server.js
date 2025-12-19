const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rooms = {};

function createDeck(shoes = 6) {
  const deck = [];
  for (let i = 0; i < shoes; i++) {
    for (let suit of SUITS) for (let rank of RANKS) deck.push({ rank, suit });
  }
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

function handValue(hand) {
  let value = 0, aces = 0;
  for (let card of hand) {
    value += cardValue(card);
    if (card.rank === 'A') aces++;
  }
  while (value > 21 && aces--) value -= 10;
  return value;
}

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomName, playerName }) => {
    socket.join(roomName);
    socket.room = roomName;
    socket.playerName = playerName || 'Guest';

    if (!rooms[roomName]) {
      rooms[roomName] = {
        players: {},
        deck: createDeck(),
        dealerHand: [],
        gamePhase: 'betting',
        currentPlayerId: null,
        sharedMode: false,
        sharedHand: [],
        messages: []
      };
    }

    rooms[roomName].players[socket.id] = {
      id: socket.id,
      name: socket.playerName,
      chips: 1000,
      hands: [[]],
      bets: [0],
      insurance: 0,
      done: false
    };

    broadcastUpdate(roomName);
  });

  socket.on('toggleSharedMode', () => {
    const room = rooms[socket.room];
    if (room && room.gamePhase === 'betting') {
      room.sharedMode = !room.sharedMode;
      resetRound(socket.room);
      broadcastUpdate(socket.room);
    }
  });

  socket.on('placeBet', (amount) => {
    const room = rooms[socket.room];
    if (room && room.gamePhase === 'betting') {
      const player = room.players[socket.id];
      if (player && player.chips >= amount && amount > 0) {
        player.chips -= amount;
        player.bets[0] = amount;
        broadcastUpdate(socket.room);
      }
    }
  });

  socket.on('startGame', () => {
    const room = rooms[socket.room];
    if (!room || room.gamePhase !== 'betting') return;
    const allBetted = Object.values(room.players).every(p => p.bets[0] > 0);
    if (allBetted) startNewRound(socket.room);
  });

  function startNewRound(roomName) {
    const room = rooms[roomName];
    room.deck = createDeck();
    room.dealerHand = [room.deck.pop(), room.deck.pop()];
    room.gamePhase = 'playing';
    room.currentPlayerId = Object.keys(room.players)[0];

    if (room.sharedMode) {
      room.sharedHand = [room.deck.pop(), room.deck.pop()];
      Object.values(room.players).forEach(p => {
        p.hands = [room.sharedHand];
        p.done = false;
      });
    } else {
      Object.values(room.players).forEach(p => {
        p.hands = [[room.deck.pop(), room.deck.pop()]];
        p.done = false;
      });
    }

    if (room.dealerHand[0].rank === 'A') room.gamePhase = 'insurance';
    else if (handValue(room.dealerHand) === 21) endRound(roomName);
    broadcastUpdate(roomName);
  }

  socket.on('insurance', (accept) => {
    const room = rooms[socket.room];
    if (room.gamePhase !== 'insurance') return;
    const player = room.players[socket.id];
    if (accept && player.chips >= player.bets[0] / 2) {
      player.chips -= player.bets[0] / 2;
      player.insurance = player.bets[0] / 2;
    }
    broadcastUpdate(socket.room);
  });

  function playerAction(type) {
    const room = rooms[socket.room];
    if (!room || room.gamePhase !== 'playing' || room.currentPlayerId !== socket.id) return;
    const player = room.players[socket.id];
    const hand = room.sharedMode ? room.sharedHand : player.hands[0];

    if (type === 'hit') {
      hand.push(room.deck.pop());
      if (handValue(hand) > 21) nextPlayer(room.room);
    } else if (type === 'stand') {
      nextPlayer(socket.room);
    } else if (type === 'double') {
      if (player.chips >= player.bets[0] && hand.length === 2) {
        player.chips -= player.bets[0];
        player.bets[0] *= 2;
        hand.push(room.deck.pop());
        nextPlayer(socket.room);
      }
    } else if (type === 'split') {
      if (hand.length === 2 && cardValue(hand[0]) === cardValue(hand[1]) && player.hands.length < 4 && player.chips >= player.bets[0]) {
        player.chips -= player.bets[0];
        const card = hand.pop();
        hand.push(room.deck.pop());
        player.hands.push([card, room.deck.pop()]);
        player.bets.push(player.bets[0]);
      }
    }
    broadcastUpdate(socket.room);
  }

  socket.on('hit', () => playerAction('hit'));
  socket.on('stand', () => playerAction('stand'));
  socket.on('double', () => playerAction('double'));
  socket.on('split', () => playerAction('split'));

  function nextPlayer(roomName) {
    const room = rooms[roomName];
    const playerIds = Object.keys(room.players);
    const idx = playerIds.indexOf(room.currentPlayerId);
    room.players[room.currentPlayerId].done = true;

    const nextIdx = playerIds.findIndex((id, i) => i > idx && !room.players[id].done);
    room.currentPlayerId = nextIdx !== -1 ? playerIds[nextIdx] : null;

    if (!room.currentPlayerId) dealerTurn(roomName);
    broadcastUpdate(roomName);
  }

  function dealerTurn(roomName) {
    const room = rooms[roomName];
    room.gamePhase = 'dealer';
    while (handValue(room.dealerHand) < 17) room.dealerHand.push(room.deck.pop());
    endRound(roomName);
  }

  function endRound(roomName) {
    const room = rooms[roomName];
    room.gamePhase = 'payout';
    const dealerVal = handValue(room.dealerHand);
    const dealerBJ = dealerVal === 21 && room.dealerHand.length === 2;

    Object.values(room.players).forEach(player => {
      player.hands.forEach((hand, i) => {
        const val = handValue(hand);
        const bet = player.bets[i];
        if (val > 21) return;
        if (dealerBJ && player.insurance) player.chips += player.insurance * 3;
        else if (val === 21 && hand.length === 2 && !dealerBJ) player.chips += bet * 2.5;
        else if (val > dealerVal || dealerVal > 21) player.chips += bet * 2;
        else if (val === dealerVal) player.chips += bet;
      });
    });

    setTimeout(() => resetRound(roomName), 6000);
    broadcastUpdate(roomName);
  }

  function resetRound(roomName) {
    const room = rooms[roomName];
    room.gamePhase = 'betting';
    room.dealerHand = [];
    room.sharedHand = [];
    room.currentPlayerId = null;
    Object.values(room.players).forEach(p => {
      p.hands = [[]];
      p.bets = [0];
      p.insurance = 0;
      p.done = false;
    });
    broadcastUpdate(roomName);
  }

  function broadcastUpdate(roomName) {
    io.to(roomName).emit('update', rooms[roomName]);
  }

  socket.on('chat', (msg) => {
    if (socket.room && msg.trim()) {
      const message = { name: socket.playerName, text: msg.trim() };
      rooms[socket.room].messages.push(message);
      io.to(socket.room).emit('chat', message);
    }
  });

  socket.on('disconnect', () => {
    if (socket.room && rooms[socket.room]) {
      delete rooms[socket.room].players[socket.id];
      if (Object.keys(rooms[socket.room].players).length === 0) delete rooms[socket.room];
      else broadcastUpdate(socket.room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
