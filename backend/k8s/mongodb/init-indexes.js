// MongoDB initialization script to create indexes
// This script ensures indexes are created on MongoDB startup
// Run this script via init container or as part of MongoDB startup

// Connect to MongoDB
const db = db.getSiblingDB('codeclashers');

// Create TTL index on sessions collection for automatic cleanup
// This will automatically delete expired sessions
try {
  db.sessions.createIndex(
    { expires: 1 },
    { expireAfterSeconds: 0, name: 'expires_ttl' }
  );
  print('✅ Created TTL index on sessions.expires');
} catch (e) {
  if (e.code === 85) {
    // Index already exists
    print('ℹ️  TTL index on sessions.expires already exists');
  } else {
    print('❌ Error creating TTL index:', e.message);
  }
}

// Create other useful indexes
try {
  db.users.createIndex({ email: 1 }, { unique: true, name: 'email_unique' });
  print('✅ Created unique index on users.email');
} catch (e) {
  if (e.code === 85) {
    print('ℹ️  Unique index on users.email already exists');
  } else {
    print('❌ Error creating users.email index:', e.message);
  }
}

try {
  db.users.createIndex({ username: 1 }, { unique: true, name: 'username_unique' });
  print('✅ Created unique index on users.username');
} catch (e) {
  if (e.code === 85) {
    print('ℹ️  Unique index on users.username already exists');
  } else {
    print('❌ Error creating users.username index:', e.message);
  }
}

print('✅ MongoDB indexes initialization complete');

