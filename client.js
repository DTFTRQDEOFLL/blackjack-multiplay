const socket = io();
const params = new URLSearchParams(location.search);
const roomName = params.get('room') || 'lobby';
document.getElementById('url').textContent = location.href;

let myId;

function join() {
  const name = document.getElementById('playerName').value.trim() || 'Guest';
  socket.emit('joinRoom', { roomName, playerName: name });
  document.getElementById('login').style.display = 'none';
  document.getElementById('game').style.display = 'block';
}

socket.on('update', (room) => {
  myId = socket.id;
  document.getElementById('modeStatus').textContent = `Party Mode: ${room.sharedMode ? 'ON' : 'OFF'}`;

  // Dealer
  const dealerHandDiv = document.getElementById('dealerHand');
  dealerHandDiv.innerHTML = '';
  room.dealerHand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'card deal';
    if (i === 1 && (room.gamePhase === 'playing' || room.gamePhase === 'insurance')) {
      el.className += ' back';
    } else {
      const suit = {H:'♥',D:'♦',C:'♣',S:'♠'}[card.suit];
      el.textContent = card.rank + suit;
      if ('HD'.includes(card.suit)) el.classList.add('red');
    }
    dealerHandDiv.appendChild(el);
  });
  document.getElementById('dealerScore').textContent = room.gamePhase !== 'betting' && room.gamePhase !== 'insurance' ? ` (${handValue(room.dealerHand)})` : '';

  // Players
  const playersDiv = document.getElementById('players');
  playersDiv.innerHTML = '';
  Object.values(room.players).forEach(p => {
    const div = document.createElement('div');
    div.className = 'player';
    div.innerHTML = `<strong>${p.name}</strong> ($${p.chips})`;
    p.hands.forEach((hand, hi) => {
      div.innerHTML += `<br>Hand ${hi+1} Bet: $${p.bets[hi] || 0} - ${handValue(hand)}`;
      hand.forEach(card => {
        const span = document.createElement('span');
        span.className = 'card';
        const suit = {H:'♥',D:'♦',C:'♣',S:'♠'}[card.suit];
        span.textContent = card.rank + suit;
        if ('HD'.includes(card.suit)) span.classList.add('red');
        div.appendChild(span);
      });
    });
    playersDiv.appendChild(div);
  });

  // Controls
  document.getElementById('betting').style.display = room.gamePhase === 'betting' ? 'block' : 'none';
  document.getElementById('insurance').style.display = room.gamePhase === 'insurance' ? 'block' : 'none';
  const actions = document.getElementById('actions');
  const isMyTurn = room.currentPlayerId === myId && room.gamePhase === 'playing';
  actions.style.display = isMyTurn ? 'block' : 'none';

  if (isMyTurn) {
    const player = room.players[myId];
    const hand = room.sharedMode ? room.sharedHand : player.hands[0];
    document.getElementById('double').disabled = hand.length !== 2 || player.chips < player.bets[0];
    document.getElementById('split').disabled = hand.length !== 2 || cardValue(hand[0]) !== cardValue(hand[1]) || player.hands.length >= 4 || player.chips < player.bets[0];
  }
});

socket.on('chat', msg => {
  const div = document.createElement('div');
  div.textContent = `${msg.name}: ${msg.text}`;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView();
});

document.getElementById('msgInput').addEventListener('keypress', e => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', e.target.value.trim());
    e.target.value = '';
  }
});

document.getElementById('toggleMode').onclick = () => socket.emit('toggleSharedMode');

function handValue(hand) {
  let v = 0, a = 0;
  hand.forEach(c => { v += cardValue(c); if (c.rank==='A') a++; });
  while (v > 21 && a--) v -= 10;
  return v;
}

function cardValue(c) {
  return ['J','Q','K'].includes(c.rank) ? 10 : c.rank === 'A' ? 11 : parseInt(c.rank);
}

// Auto join
window.onload = () => setTimeout(() => join(), 500);
