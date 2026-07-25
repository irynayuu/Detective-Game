const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { VICTIM, getRolesForCount } = require('./data/scenario');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'detective2026';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Стан гри в пам'яті ----
// game.status: 'idle' | 'active'
// game.roles: масив ролей, доступних у поточній грі (обраний зсув з ORDER)
// game.availableRoleIds: ролі, які ще нікому не видані
// game.players: Map(playerId -> { id, name, roleId, joinedAt })
let game = {
  status: 'idle',
  totalSlots: 0,
  roles: [],
  availableRoleIds: [],
  players: new Map()
};

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-password'] || req.body?.password;
  if (auth !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Невірний пароль' });
  }
  next();
}

// ---- Admin: старт гри ----
app.post('/api/admin/start-game', requireAdmin, (req, res) => {
  const count = parseInt(req.body.count, 10);
  if (!Number.isInteger(count) || count < 3 || count > 10) {
    return res.status(400).json({ error: 'Кількість гравців має бути від 3 до 10' });
  }
  const roles = getRolesForCount(count);
  game = {
    status: 'active',
    totalSlots: count,
    roles,
    availableRoleIds: shuffle(roles.map((r) => r.id)),
    players: new Map()
  };
  res.json({ ok: true, totalSlots: count });
});

// ---- Admin: скинути гру ----
app.post('/api/admin/reset', requireAdmin, (req, res) => {
  game = {
    status: 'idle',
    totalSlots: 0,
    roles: [],
    availableRoleIds: [],
    players: new Map()
  };
  res.json({ ok: true });
});

// ---- Admin: перевірка пароля / статус ----
app.post('/api/admin/status', requireAdmin, (req, res) => {
  res.json({
    status: game.status,
    totalSlots: game.totalSlots,
    takenCount: game.players.size,
    remaining: game.availableRoleIds.length
  });
});

// ---- Admin: список гравців з картками ----
app.get('/api/admin/players', requireAdmin, (req, res) => {
  const players = Array.from(game.players.values()).map((p) => {
    const role = game.roles.find((r) => r.id === p.roleId);
    return {
      name: p.name,
      joinedAt: p.joinedAt,
      role
    };
  });
  res.json({
    status: game.status,
    totalSlots: game.totalSlots,
    remaining: game.availableRoleIds.length,
    victim: VICTIM,
    players
  });
});

// ---- Player: приєднатися й отримати роль ----
app.post('/api/join', (req, res) => {
  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Гру ще не розпочато. Зачекайте на ведучу.' });
  }

  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Введіть ім’я' });
  }

  // Якщо у гравця вже є cookie з активною роллю в цій грі — повертаємо її ж
  const existingId = req.cookies.playerId;
  if (existingId && game.players.has(existingId)) {
    const p = game.players.get(existingId);
    const role = game.roles.find((r) => r.id === p.roleId);
    return res.json({ name: p.name, role, victim: VICTIM });
  }

  if (game.availableRoleIds.length === 0) {
    return res.status(400).json({ error: 'Усі ролі вже розібрані' });
  }

  const roleId = game.availableRoleIds.shift();
  const playerId = newId();
  game.players.set(playerId, { id: playerId, name, roleId, joinedAt: Date.now() });

  res.cookie('playerId', playerId, {
    maxAge: 1000 * 60 * 60 * 12,
    httpOnly: true,
    sameSite: 'lax'
  });

  const role = game.roles.find((r) => r.id === roleId);
  res.json({ name, role, victim: VICTIM });
});

// ---- Player: отримати свою картку, якщо вже приєднався ----
app.get('/api/my-card', (req, res) => {
  const existingId = req.cookies.playerId;
  if (!existingId || !game.players.has(existingId)) {
    return res.json({ joined: false, gameActive: game.status === 'active' });
  }
  const p = game.players.get(existingId);
  const role = game.roles.find((r) => r.id === p.roleId);
  res.json({ joined: true, name: p.name, role, victim: VICTIM });
});

app.listen(PORT, () => {
  console.log(`Сервер запущено на порту ${PORT}`);
});
