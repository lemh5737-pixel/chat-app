import { getDatabase, ref, set, get, child, update } from 'firebase/database';

// Generate random phone number
export const generateRandomPhone = () => {
  const prefix = '08';
  const randomDigits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  return prefix + randomDigits;
};

// Register new user
export const registerUser = async (username, password) => {
  const database = getDatabase();
  const usersRef = ref(database, 'users');
  const phoneNumber = generateRandomPhone();
  
  try {
    // Check if username already exists
    const snapshot = await get(child(usersRef, username));
    if (snapshot.exists()) {
      return { success: false, message: 'Username already exists' };
    }
    
    // Create new user
    await set(child(usersRef, username), {
      username,
      password, // In production, use hashed password
      phoneNumber,
      createdAt: Date.now(),
      status: 'online'
    });
    
    return { 
      success: true, 
      message: 'Registration successful',
      user: { username, phoneNumber }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Login user
export const loginUser = async (username, password) => {
  const database = getDatabase();
  const userRef = ref(database, `users/${username}`);
  
  try {
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      return { success: false, message: 'User not found' };
    }
    
    const user = snapshot.val();
    if (user.password !== password) { // In production, compare hashed passwords
      return { success: false, message: 'Invalid password' };
    }
    
    // Update user status to online
    await update(userRef, { status: 'online', lastLogin: Date.now() });
    
    return { 
      success: true, 
      message: 'Login successful',
      user: { 
        username: user.username, 
        phoneNumber: user.phoneNumber 
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Get user by phone number
export const getUserByPhone = async (phoneNumber) => {
  const database = getDatabase();
  const usersRef = ref(database, 'users');
  
  try {
    const snapshot = await get(usersRef);
    if (!snapshot.exists()) {
      return null;
    }
    
    const users = snapshot.val();
    for (const username in users) {
      if (users[username].phoneNumber === phoneNumber) {
        return { username, ...users[username] };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting user by phone:', error);
    return null;
  }
};

// Update user status
export const updateUserStatus = async (username, status) => {
  const database = getDatabase();
  const userRef = ref(database, `users/${username}`);
  
  try {
    await update(userRef, { status });
    return { success: true };
  } catch (error) {
    console.error('Error updating user status:', error);
    return { success: false, message: error.message };
  }
};

// Get all users
export const getAllUsers = async () => {
  const database = getDatabase();
  const usersRef = ref(database, 'users');
  
  try {
    const snapshot = await get(usersRef);
    if (!snapshot.exists()) {
      return [];
    }
    
    const users = snapshot.val();
    return Object.keys(users).map(username => ({
      username,
      ...users[username]
    }));
  } catch (error) {
    console.error('Error getting all users:', error);
    return [];
  }
};
