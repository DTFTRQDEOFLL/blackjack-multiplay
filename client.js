const socket = io();
const urlParams = new URLSearchParams(window.location.search);
let roomName = urlParams.get('room') || 'lobby';
let sharedMode = false;

document.getElementById('shareLink').textContent = window.location.href;

function joinGame() {
  const name = document.getElementById('playerName').value.trim() || 'Guest';
  sharedMode = document.getElementById('sharedMode').checked;
  socket.emit('joinRoom', { roomName, playerName: name, isSharedMode: sharedMode });
  document.getElementById('login').style.display = 'none';
  document.getElementById('game').style.display = 'block';
}

socket.on('roomUpdate', (room) => {
  renderTable(room);
});

socket.on('chat', (msg) => {
  const div = document.createElement('div');
  div.textContent = `${msg.name}: ${msg.msg}`;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView();
});

document.getElementById('chatInput').addEventListener('keypress', e => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', e.target.value.trim());
    e.target.value = '';
  }
});

function renderTable(room) {
  document.getElementById('dealerScore').textContent = room.gamePhase === 'playing' || room.gamePhase === 'dealer' || room.gamePhase === 'payout' ? 
    `(${handValue(room.dealerHand)})` : '';

  renderCards('dealerHand', room.dealerHand, room.gamePhase === 'betting' || room.gamePhase === 'insurance');

  document.getElementById('playersArea').innerHTML = '';
  Object.values(room.players).forEach(p => {
    const div = document.createElement('div');
    div.className = 'player';
    div.innerHTML = `<strong>${p.name}</strong> ($${p.chips})<br>`;
    p.hands.forEach((hand, i) => {
      div.innerHTML += `Hand ${i+1} (Bet: $${p.bets[i]}): `;
      renderCardsInline(div, hand);
      div.innerHTML += ` <strong>(${handValue(hand)})</strong><br>`;
    });
    document.getElementById('playersArea').appendChild(div);
  });

  // Controls
  const player = room.players[socket.id];
  document.getElementById('betControls').style.display = room.gamePhase === 'betting' ? 'block' : 'none';
  document.getElementById('actionControls').style.display = room.gamePhase === 'playing' && player && !player.done ? 'block' : 'none';
  document.getElementById('insuranceControls').style.display = room.gamePhase === 'insurance' ? 'block' : 'none';

  if (player && room.gamePhase === 'playing') {
    const hand = sharedMode ? room.sharedHand : player.hands[0];
    document.getElementById('doubleBtn').disabled = player.chips < player.bets[0] || hand.length !== 2;
    document.getElementById('splitBtn').disabled = hand.length !== 2 || cardValue(hand[0]) !== cardValue(hand[1]) || player.hands.length >= 4 || player.chips < player.bets[0];
  }
}

function renderCards(containerId, cards, hideSecond = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  cards.forEach((card, i) => {
    const div = document.createElement('div');
    div.className = 'card dealing';
    if (i === 1 && hideSecond) {
      div.className += ' back';
    } else {
      const suitSym = { H: '♥', D: '♦', C: '♣', S: '♠' }[card.suit];
      div.textContent = `${card.rank}${suitSym}`;
      if (['H', 'D'].includes(card.suit)) div.className += ' red';
    }
    container.appendChild(div);
    setTimeout(() => div.classList.remove('dealing'), 100);
  });
}

function renderCardsInline(parent, cards) {
  cards.forEach(card => {
    const span = document.createElement('span');
    span.className = 'card';
    const suitSym = { H: '♥', D: '♦', C: '♣', S: '♠' }[card.suit];
    span.textContent = `${card.rank}${suitSym}`;
    if (['H', 'D'].includes(card.suit)) span.className += ' red';
    parent.appendChild(span);
  });
}

function placeBet() {
  const amount = parseInt(document.getElementById('betAmount').value);
  if (amount > 0) socket.emit('placeBet', amount);
}

function handValue(hand) {
  let value = 0, aces = 0;
  hand.forEach(c => {
    value += cardValue(c);
    if (c.rank === 'A') aces++;
  });
  while (value > 21 && aces--) value -= 10;
  return value;
}

function cardValue(card) {
  if (['J','Q','K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

// Auto-join
window.onload = () => {
  document.getElementById('shareLink').textContent = window.location.href;
  if (confirm(`Join room "${roomName}"?`)) joinGame();
};