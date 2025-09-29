import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ref, onValue, get, update, query, orderByChild, limitToLast } from 'firebase/database';
import { database } from '../lib/firebase';
import { updateUserStatus } from '../lib/auth';
import CustomAlert from '../components/CustomAlert';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    phoneNumber: '',
    bio: '',
    status: 'online'
  });
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [myStories, setMyStories] = useState([]); // For user's stories
  const [alert, setAlert] = useState({ type: '', message: '' });
  const [confirmData, setConfirmData] = useState(null);
  const notificationsEndRef = useRef(null);

  const showAlert = (type, message) => {
    setAlert({ type, message });
  };

  const showConfirm = (message, onConfirm) => {
    setConfirmData({ message, onConfirm });
  };

  // Check if user is logged in
  useEffect(() => {
    setIsClient(true);
    
    const savedUser = localStorage.getItem('chatUser');
    if (savedUser) {
      const userData = JSON.parse(savedUser);
      setUser(userData);
      setFormData({
        username: userData.username,
        phoneNumber: userData.phoneNumber,
        bio: userData.bio || '',
        status: userData.status || 'online'
      });
    } else {
      // Redirect to login page
      router.push('/login');
    }
  }, [router]);

  // Update user status to online
  useEffect(() => {
    if (!user || !isClient) return;
    
    updateUserStatus(user.username, 'online');
    
    // Set status to offline when page is closed
    const handleBeforeUnload = () => {
      updateUserStatus(user.username, 'offline');
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      updateUserStatus(user.username, 'offline');
    };
  }, [user, isClient]);

  // Check connection status
  useEffect(() => {
    if (!isClient) return;

    const connectedRef = ref(database, '.info/connected');
    const unsubscribeConnected = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val();
      setConnectionStatus(connected ? 'connected' : 'disconnected');
    });

    return () => unsubscribeConnected();
  }, [isClient, database]);

  // Fetch user data
  useEffect(() => {
    if (!user || !isClient) return;

    const fetchUserData = async () => {
      try {
        setIsLoading(true);
        const userRef = ref(database, `users/${user.username}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
          const userData = snapshot.val();
          setFormData({
            username: userData.username,
            phoneNumber: userData.phoneNumber,
            bio: userData.bio || '',
            status: userData.status || 'online'
          });
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        showAlert('error', `Error fetching user data: ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [user, isClient, database]);

  // Get user's stories
  useEffect(() => {
    if (!isClient || !user) return;
    
    const userStoriesRef = ref(database, `stories/${user.username}`);
    const unsubscribeUserStories = onValue(userStoriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const storiesData = snapshot.val();
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        
        const validUserStories = Object.keys(storiesData)
          .map(storyId => ({
            id: storyId,
            username: user.username,
            ...storiesData[storyId]
          }))
          .filter(story => (now - story.timestamp) < twentyFourHours)
          .sort((a, b) => b.timestamp - a.timestamp);
        
        setMyStories(validUserStories);
      } else {
        setMyStories([]);
      }
    });
    
    return () => unsubscribeUserStories();
  }, [isClient, user, database]);

  // Set up real-time notifications for new messages
  useEffect(() => {
    if (!user || !isClient) return;

    // Listen for new messages
    const chatsRef = ref(database, 'users');
    const unsubscribeChats = onValue(chatsRef, (snapshot) => {
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        let unreadCount = 0;
        const newNotifications = [];
        
        // Check each user's chat history
        Object.keys(usersData).forEach(username => {
          if (username !== user.username) {
            const userChats = usersData[username].chatHistory;
            if (userChats) {
              Object.keys(userChats).forEach(chatId => {
                const chat = userChats[chatId];
                if (chat.phoneNumber === user.phoneNumber) {
                  // Check if this is a new message (last message time is after last login)
                  const lastMessageTime = chat.lastMessageTime;
                  const lastLoginTime = user.lastLogin || Date.now();
                  
                  if (lastMessageTime > lastLoginTime) {
                    unreadCount++;
                    newNotifications.push({
                      id: `${username}-${chatId}`,
                      username: username,
                      message: chat.lastMessage,
                      timestamp: lastMessageTime,
                      read: false
                    });
                  }
                }
              });
            }
          }
        });
        
        setUnreadMessages(unreadCount);
        
        // Add new notifications to the list
        if (newNotifications.length > 0) {
          setNotifications(prev => {
            // Combine with existing notifications and remove duplicates
            const existingIds = new Set(prev.map(n => n.id));
            const uniqueNew = newNotifications.filter(n => !existingIds.has(n.id));
            return [...uniqueNew, ...prev].sort((a, b) => b.timestamp - a.timestamp);
          });
        }
      }
    });

    return () => unsubscribeChats();
  }, [user, isClient, database]);

  // Scroll to bottom of notifications
  const scrollToNotificationsBottom = () => {
    notificationsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToNotificationsBottom();
  }, [notifications]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSaveProfile = async () => {
    try {
      setIsLoading(true);
      const userRef = ref(database, `users/${user.username}`);
      
      await update(userRef, {
        username: formData.username,
        phoneNumber: formData.phoneNumber,
        bio: formData.bio,
        status: formData.status,
        lastLogin: Date.now() // Update last login time
      });

      // Update localStorage
      const updatedUser = {
        ...user,
        username: formData.username,
        phoneNumber: formData.phoneNumber,
        bio: formData.bio,
        status: formData.status,
        lastLogin: Date.now()
      };
      
      localStorage.setItem('chatUser', JSON.stringify(updatedUser));
      setUser(updatedUser);
      
      setIsEditing(false);
      showAlert('success', 'Profile updated successfully');
    } catch (error) {
      console.error("Error updating profile:", error);
      showAlert('error', `Error updating profile: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelEdit = () => {
    // Reset form data to original values
    setFormData({
      username: user.username,
      phoneNumber: user.phoneNumber,
      bio: user.bio || '',
      status: user.status || 'online'
    });
    setIsEditing(false);
  };

  const markNotificationAsRead = (notificationId) => {
    setNotifications(prev => 
      prev.map(notification => 
        notification.id === notificationId 
          ? { ...notification, read: true } 
          : notification
      )
    );
  };

  const clearAllNotifications = () => {
    setNotifications([]);
    setUnreadMessages(0);
  };

  const logout = () => {
    showConfirm('Are you sure you want to logout?', () => {
      if (user) {
        updateUserStatus(user.username, 'offline');
      }
      localStorage.removeItem('chatUser');
      setUser(null);
      router.push('/login');
      setConfirmData(null);
    });
  };

  const ConfirmModal = () => {
    if (!confirmData) return null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full shadow-lg">
          <p className="mb-4 text-gray-900 dark:text-gray-100">{confirmData.message}</p>
          <div className="flex justify-end space-x-4">
            <button
              onClick={() => setConfirmData(null)}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-700 rounded hover:bg-gray-400 dark:hover:bg-gray-600 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmData.onConfirm()}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 font-sans">
      {/* Alert Component */}
      <CustomAlert
        type={alert.type}
        message={alert.message}
        onClose={() => setAlert({ type: '', message: '' })}
      />

      {/* Confirmation Modal */}
      <ConfirmModal />

      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => router.push('/')}
                className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="bg-white/20 p-2 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="flex items-center">
                <h1 className="text-2xl font-bold">My Profile</h1>
                {unreadMessages > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center">
                    {unreadMessages}
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-2 bg-white/20 px-3 py-1 rounded-full">
              <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
              <span className="text-sm font-medium capitalize">{connectionStatus}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Profile */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
              {/* Profile Header */}
              <div className="bg-gradient-to-r from-indigo-500 to-purple-500 p-6 text-white text-center">
                <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-4xl font-bold mx-auto mb-4">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <h2 className="text-2xl font-bold">{user.username}</h2>
                <p className="text-indigo-200">{user.phoneNumber}</p>
                <div className="mt-2 flex items-center justify-center">
                  <div className={`w-2 h-2 rounded-full mr-1 ${user.status === 'online' ? 'bg-green-400' : 'bg-gray-400'}`}></div>
                  <span className="text-sm capitalize">{user.status}</span>
                </div>
              </div>

              {/* Profile Form */}
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-white">Profile Information</h3>
                  {!isEditing ? (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      <span>Edit</span>
                    </button>
                  ) : (
                    <div className="flex space-x-2">
                      <button
                        onClick={handleCancelEdit}
                        className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveProfile}
                        disabled={isLoading}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
                      >
                        {isLoading ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {/* Username */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Username
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="username"
                        value={formData.username}
                        onChange={handleInputChange}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                      />
                    ) : (
                      <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white">
                        {user.username}
                      </div>
                    )}
                  </div>

                  {/* Phone Number */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone Number
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        name="phoneNumber"
                        value={formData.phoneNumber}
                        onChange={handleInputChange}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                      />
                    ) : (
                      <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white">
                        {user.phoneNumber}
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Status
                    </label>
                    {isEditing ? (
                      <select
                        name="status"
                        value={formData.status}
                        onChange={handleInputChange}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                      >
                        <option value="online">Online</option>
                        <option value="offline">Offline</option>
                        <option value="away">Away</option>
                        <option value="busy">Busy</option>
                      </select>
                    ) : (
                      <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white flex items-center">
                        <div className={`w-2 h-2 rounded-full mr-2 ${user.status === 'online' ? 'bg-green-500' : user.status === 'away' ? 'bg-yellow-500' : user.status === 'busy' ? 'bg-red-500' : 'bg-gray-500'}`}></div>
                        <span className="capitalize">{user.status}</span>
                      </div>
                    )}
                  </div>

                  {/* Bio */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Bio
                    </label>
                    {isEditing ? (
                      <textarea
                        name="bio"
                        value={formData.bio}
                        onChange={handleInputChange}
                        rows={3}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                        placeholder="Tell something about yourself..."
                      />
                    ) : (
                      <div className="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white min-h-[60px]">
                        {user.bio || 'No bio set'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Account Actions */}
                <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Account Actions</h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={() => showAlert('info', 'Password change feature coming soon!')}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 11-8 0v4h8z" />
                      </svg>
                      <span>Change Password</span>
                    </button>
                    <button
                      onClick={() => showAlert('info', 'Account deletion feature coming soon!')}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center justify-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Delete Account</span>
                    </button>
                    <button
                      onClick={logout}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition flex items-center justify-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      <span>Logout</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Notifications & Stories */}
          <div className="lg:col-span-1">
            {/* Stories Section */}
            <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Your Stories</h3>
              
              {myStories.length === 0 ? (
                <p className="text-gray-600 dark:text-gray-400">You don't have any active stories</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {myStories.map((story) => (
                    <div key={story.id} className="relative">
                      {story.mediaType === 'image' ? (
                        <img 
                          src={story.mediaUrl} 
                          alt="Your story"
                          className="w-full h-24 object-cover rounded-lg"
                        />
                      ) : (
                        <video 
                          src={story.mediaUrl}
                          className="w-full h-24 object-cover rounded-lg"
                        />
                      )}
                      <div className="absolute bottom-1 right-1 bg-black bg-opacity-50 text-white text-xs px-1 rounded">
                        {new Date(story.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <button
                onClick={() => router.push('/stories')}
                className="mt-4 w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                Manage Stories
              </button>
            </div>

            {/* Notifications */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                  Notifications
                </h2>
                {notifications.length > 0 && (
                  <button
                    onClick={clearAllNotifications}
                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
                  >
                    Clear All
                  </button>
                )}
              </div>
              
              <div className="overflow-y-auto max-h-96">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538.214 1.055.595 1.436L4 17h5m6 0v1m6-0h5m-6 0H9" />
                    </svg>
                    <p className="text-center">No notifications</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {notifications.map((notification) => (
                      <div 
                        key={notification.id} 
                        className={`p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition cursor-pointer ${!notification.read ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        onClick={() => markNotificationAsRead(notification.id)}
                      >
                        <div className="flex justify-between">
                          <div className="flex items-start space-x-3">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-800 dark:text-indigo-200 font-bold">
                              {notification.username.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <h3 className="font-medium text-gray-900 dark:text-white">{notification.username}</h3>
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {notification.message}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {new Date(notification.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          {!notification.read && (
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={notificationsEndRef} />
                  </div>
                )}
              </div>
            </div>

            {/* App Info */}
            <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">App Information</h3>
              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>App Version:</span>
                  <span>1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span>Last Login:</span>
                  <span>{new Date().toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex justify-around">
            <button
              onClick={() => router.push('/')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-xs mt-1">Chats</span>
            </button>
            
            <button
              onClick={() => router.push('/stories')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/stories'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs mt-1">Stories</span>
            </button>
            
            <button
              onClick={() => router.push('/')}
              className={`flex flex-col items-center justify-center py-3 px-6 ${
                router.pathname === '/'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="text-xs mt-1">Contacts</span>
            </button>
            
            <button
              onClick={() => router.push('/profile')}
              className={`flex flex-col items-center justify-center py-3 px-6 relative ${
                router.pathname === '/profile'
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-xs mt-1">Profile</span>
              {unreadMessages > 0 && (
                <span className="absolute top-1 right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {unreadMessages}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
}
