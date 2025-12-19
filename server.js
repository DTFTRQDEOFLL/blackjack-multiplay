const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const SUITS = ['H', 'D', 'C', 'S'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const rooms = {};

function createDeck(shoes = 6) {
  let deck = [];
  for (let s = 0; s < shoes; s++) {
    for (let suit of SUITS) {
      for (let rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
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
  while (value > 21 && aces) {
    value -= 10;
    aces--;
  }
  return value;
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('joinRoom', ({ roomName, playerName, isSharedMode }) => {
    socket.join(roomName);
    socket.room = roomName;
    socket.playerName = playerName || 'Guest';

    if (!rooms[roomName]) {
      rooms[roomName] = {
        players: {},
        deck: createDeck(),
        dealerHand: [],
        currentPlayerIndex: 0,
        gamePhase: 'betting', // betting, playing, dealer, payout
        bets: {},
        insuranceBets: {},
        sharedMode: isSharedMode || false,
        sharedHand: [],
        messages: []
      };
    }

    rooms[roomName].players[socket.id] = {
      id: socket.id,
      name: socket.playerName,
      chips: 1000,
      hands: [[]], // array of hands (for splits)
      bets: [0],
      insurance: 0,
      done: false
    };

    broadcastRoomUpdate(roomName);
  });

  socket.on('setSharedMode', (enabled) => {
    if (rooms[socket.room]) {
      rooms[socket.room].sharedMode = enabled;
      rooms[socket.room].gamePhase = 'betting';
      resetRound(socket.room);
      broadcastRoomUpdate(socket.room);
    }
  });

  socket.on('placeBet', (amount) => {
    const room = rooms[socket.room];
    if (!room || room.gamePhase !== 'betting') return;
    const player = room.players[socket.id];
    if (player.chips >= amount && amount > 0) {
      player.bets[0] = amount;
      player.chips -= amount;
      room.bets[socket.id] = amount;
      broadcastRoomUpdate(socket.room);
    }
  });

  socket.on('startGame', () => {
    const room = rooms[socket.room];
    if (!room || room.gamePhase !== 'betting') return;

    const allBetted = Object.values(room.players).every(p => p.bets[0] > 0);
    if (allBetted) {
      startRound(socket.room);
    }
  });

  function startRound(roomName) {
    const room = rooms[roomName];
    room.deck = createDeck();
    room.dealerHand = [room.deck.pop(), room.deck.pop()];
    room.currentPlayerIndex = 0;
    room.gamePhase = 'playing';

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

    // Check for dealer blackjack
    if (handValue(room.dealerHand) === 21) {
      room.gamePhase = 'payout';
      payoutRound(roomName);
    } else if (room.dealerHand[0].rank === 'A') {
      room.gamePhase = 'insurance';
    }

    broadcastRoomUpdate(roomName);
  }

  socket.on('insurance', (take) => {
    const room = rooms[socket.room];
    if (room.gamePhase !== 'insurance') return;
    const player = room.players[socket.id];
    if (take && player.chips >= player.bets[0] / 2) {
      player.chips -= player.bets[0] / 2;
      player.insurance = player.bets[0] / 2;
    }
    broadcastRoomUpdate(socket.room);
  });

  socket.on('hit', () => action('hit', socket));
  socket.on('stand', () => action('stand', socket));
  socket.on('double', () => action('double', socket));
  socket.on('split', () => action('split', socket));

  function action(type, socket) {
    const room = rooms[socket.room];
    if (!room || room.gamePhase !== 'playing') return;
    const playerIds = Object.keys(room.players);
    const currentId = playerIds[room.currentPlayerIndex];
    if (currentId !== socket.id) return;

    const player = room.players[socket.id];
    const hand = room.sharedMode ? room.sharedHand : player.hands[0];

    if (type === 'hit') {
      hand.push(room.deck.pop());
      if (handValue(hand) > 21) {
        player.done = true;
        nextTurn(roomName);
      }
    } else if (type === 'double') {
      if (player.chips >= player.bets[0]) {
        player.chips -= player.bets[0];
        player.bets[0] *= 2;
        hand.push(room.deck.pop());
        player.done = true;
        nextTurn(roomName);
      }
    } else if (type === 'split') {
      if (hand.length === 2 && cardValue(hand[0]) === cardValue(hand[1]) && player.hands.length < 4 && player.chips >= player.bets[0]) {
        player.chips -= player.bets[0];
        player.hands.push([hand.pop(), room.deck.pop()]);
        player.bets.push(player.bets[0]);
      }
    } else if (type === 'stand') {
      player.done = true;
      nextTurn(roomName);
    }

    broadcastRoomUpdate(socket.room);
  }

  function nextTurn(roomName) {
    const room = rooms[roomName];
    room.currentPlayerIndex++;
    if (room.currentPlayerIndex >= Object.keys(room.players).length || Object.values(room.players).every(p => p.done)) {
      dealerPlay(roomName);
    }
  }

  function dealerPlay(roomName) {
    const room = rooms[roomName];
    room.gamePhase = 'dealer';
    while (handValue(room.dealerHand) < 17) {
      room.dealerHand.push(room.deck.pop());
    }
    room.gamePhase = 'payout';
    payoutRound(roomName);
  }

  function payoutRound(roomName) {
    const room = rooms[roomName];
    const dealerVal = handValue(room.dealerHand);
    const isDealerBJ = dealerVal === 21 && room.dealerHand.length === 2;

    Object.values(room.players).forEach(player => {
      player.hands.forEach((hand, i) => {
        const val = handValue(hand);
        const bet = player.bets[i];
        if (val > 21) {
          // bust
        } else if (isDealerBJ && player.insurance > 0) {
          player.chips += player.insurance * 3; // 2:1 insurance
        } else if (val === 21 && hand.length === 2 && !isDealerBJ) {
          player.chips += bet * 2.5; // blackjack
        } else if (val > dealerVal || dealerVal > 21) {
          player.chips += bet * 2;
        } else if (val === dealerVal) {
          player.chips += bet; // push
        }
      });
    });

    setTimeout(() => {
      resetRound(roomName);
    }, 5000);
  }

  function resetRound(roomName) {
    const room = rooms[roomName];
    room.gamePhase = 'betting';
    room.dealerHand = [];
    room.sharedHand = [];
    room.currentPlayerIndex = 0;
    Object.values(room.players).forEach(p => {
      p.hands = [[]];
      p.bets = [0];
      p.insurance = 0;
      p.done = false;
    });
    broadcastRoomUpdate(roomName);
  }

  function broadcastRoomUpdate(roomName) {
    io.to(roomName).emit('roomUpdate', rooms[roomName]);
  }

  socket.on('chat', (msg) => {
    if (socket.room && msg.trim()) {
      const message = { name: socket.playerName, msg: msg.trim() };
      rooms[socket.room].messages.push(message);
      io.to(socket.room).emit('chat', message);
    }
  });

  socket.on('disconnect', () => {
    if (socket.room && rooms[socket.room]) {
      delete rooms[socket.room].players[socket.id];
      if (Object.keys(rooms[socket.room].players).length === 0) {
        delete rooms[socket.room];
      } else {
        broadcastRoomUpdate(socket.room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));