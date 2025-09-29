import { ref, set, get, child, update } from 'firebase/database';
import { database } from '../lib/firebase';

// Generate random phone number
export const generateRandomPhone = () => {
  const prefix = '08';
  const randomDigits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  return prefix + randomDigits;
};

// Register new user
export const registerUser = async (username, password) => {
  console.log("Starting registration for username:", username);
  
  const phoneNumber = generateRandomPhone();
  
  try {
    console.log("Checking if username exists...");
    // Check if username already exists
    const usersRef = ref(database, 'users');
    const snapshot = await get(child(usersRef, username));
    if (snapshot.exists()) {
      console.log("Username already exists");
      return { success: false, message: 'Username already exists' };
    }
    
    console.log("Creating new user with phone:", phoneNumber);
    // Create new user
    await set(child(usersRef, username), {
      username,
      password, // In production, use hashed password
      phoneNumber,
      createdAt: Date.now(),
      status: 'online'
    });
    
    console.log("User created successfully");
    return { 
      success: true, 
      message: 'Registration successful',
      user: { username, phoneNumber }
    };
  } catch (error) {
    console.error("Registration error:", error);
    return { success: false, message: error.message };
  }
};

// Login user
export const loginUser = async (username, password) => {
  console.log("Starting login for username:", username);
  
  try {
    console.log("Fetching user data...");
    const userRef = ref(database, `users/${username}`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      console.log("User not found");
      return { success: false, message: 'User not found' };
    }
    
    const user = snapshot.val();
    console.log("User found, checking password...");
    if (user.password !== password) { // In production, compare hashed passwords
      console.log("Invalid password");
      return { success: false, message: 'Invalid password' };
    }
    
    console.log("Password correct, updating status...");
    // Update user status to online
    await update(userRef, { status: 'online', lastLogin: Date.now() });
    
    console.log("Login successful");
    return { 
      success: true, 
      message: 'Login successful',
      user: { 
        username: user.username, 
        phoneNumber: user.phoneNumber 
      }
    };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: error.message };
  }
};

// Get user by phone number
export const getUserByPhone = async (phoneNumber) => {
  console.log("Looking for user with phone:", phoneNumber);
  
  try {
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);
    if (!snapshot.exists()) {
      console.log("No users found");
      return null;
    }
    
    const users = snapshot.val();
    console.log("Users data:", users);
    
    for (const username in users) {
      if (users[username].phoneNumber === phoneNumber) {
        console.log("User found:", username);
        return { username, ...users[username] };
      }
    }
    
    console.log("User not found with this phone number");
    return null;
  } catch (error) {
    console.error('Error getting user by phone:', error);
    return null;
  }
};

// Update user status
export const updateUserStatus = async (username, status) => {
  console.log("Updating status for user:", username, "to:", status);
  
  try {
    const userRef = ref(database, `users/${username}`);
    await update(userRef, { status });
    console.log("Status updated successfully");
    return { success: true };
  } catch (error) {
    console.error('Error updating user status:', error);
    return { success: false, message: error.message };
  }
};

// Get all users
export const getAllUsers = async () => {
  console.log("Getting all users...");
  
  try {
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);
    if (!snapshot.exists()) {
      console.log("No users found");
      return [];
    }
    
    const users = snapshot.val();
    console.log("Users data:", users);
    
    const usersList = Object.keys(users).map(username => ({
      username,
      ...users[username]
    }));
    
    console.log("Users list:", usersList);
    return usersList;
  } catch (error) {
    console.error('Error getting all users:', error);
    return [];
  }
};
