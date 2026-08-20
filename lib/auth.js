const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { users } = require('./store');

const JWT_SECRET = process.env.JWT_SECRET || 'telecel-askhr-secret-' + Date.now();
const JWT_EXPIRES = '7d';

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
    { id: user._id, username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

async function authenticate(req, res, next) {
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

async function seedDefaultUsers() {
  const count = users.countDocuments();
  if (count > 0) return;
  const admin = hashPassword('admin123');
  users.create({
    username: 'admin',
    password: admin.hash,
    salt: admin.salt,
    name: 'HR Administrator',
    role: 'admin',
    email: 'admin@telecelgh.com'
  });
  const u = hashPassword('user123');
  users.create({
    username: 'user',
    password: u.hash,
    salt: u.salt,
    name: 'Regular User',
    role: 'user',
    email: 'user@telecelgh.com'
  });
  console.log('[auth] Seeded default users: admin/admin123, user/user123');
}

function findUser(username) {
  return users.findOne({ username });
}

function findUserById(id) {
  return users.findById(id);
}

function createUser({ username, password, name, email, role }) {
  const exists = users.findOne({ username });
  if (exists) return null;
  const { salt, hash } = hashPassword(password);
  return users.create({
    username,
    password: hash,
    salt,
    name,
    email: email || '',
    role: role || 'user'
  });
}

function getAllUsers() {
  return users.excludeFields(users.find(), ['password', 'salt']);
}

module.exports = {
  hashPassword, verifyPassword, generateToken, verifyToken,
  authenticate, requireAdmin, seedDefaultUsers,
  findUser, findUserById, createUser, getAllUsers
};
