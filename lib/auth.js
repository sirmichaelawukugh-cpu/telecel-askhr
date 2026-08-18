const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'telecel-askhr-secret-' + Date.now();
const JWT_EXPIRES = '7d';
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

let users = [];
if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { users = []; }
}

function saveUsers() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const result = crypto.scryptSync(password, salt, 64).toString('hex');
  return result === hash;
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const payload = verifyToken(authHeader.split(' ')[1]);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function seedDefaultUsers() {
  if (users.length) return;
  const admin = hashPassword('admin123');
  users.push({
    id: 1,
    username: 'admin',
    password: admin.hash,
    salt: admin.salt,
    name: 'HR Administrator',
    role: 'admin',
    email: 'admin@telecelgh.com',
    createdAt: new Date().toISOString()
  });
  const user = hashPassword('user123');
  users.push({
    id: 2,
    username: 'user',
    password: user.hash,
    salt: user.salt,
    name: 'Regular User',
    role: 'user',
    email: 'user@telecelgh.com',
    createdAt: new Date().toISOString()
  });
  saveUsers();
  console.log('[auth] Seeded default users: admin/admin123, user/user123');
}

function findUser(username) {
  return users.find(u => u.username === username);
}

function findUserById(id) {
  return users.find(u => u.id === id);
}

function createUser({ username, password, name, email, role }) {
  if (findUser(username)) return null;
  const { salt, hash } = hashPassword(password);
  const newUser = {
    id: users.reduce((max, u) => Math.max(max, u.id), 0) + 1,
    username,
    password: hash,
    salt,
    name,
    email: email || '',
    role: role || 'user',
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  saveUsers();
  return newUser;
}

function getAllUsers() {
  return users.map(({ password, salt, ...u }) => u);
}

module.exports = {
  hashPassword, verifyPassword, generateToken, verifyToken,
  authenticate, requireAdmin, seedDefaultUsers,
  findUser, findUserById, createUser, getAllUsers
};
