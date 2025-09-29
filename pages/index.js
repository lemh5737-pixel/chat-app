import { useState, useEffect, useRef } from 'react';
import { database } from '../lib/firebase';
import { ref, push, onValue, serverTimestamp, set, remove, get, child, update } from 'firebase/database';
import { getUserByPhone, getAllUsers, updateUserStatus } from '../lib/auth';
import CustomAlert from '../components/CustomAlert';

export default function Home() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [systemNotifications, setSystemNotifications] = useState([]);
  const [databaseInfo, setDatabaseInfo] = useState(null);
  const [users, setUsers] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'contacts'
  const messagesEndRef = useRef(null);

  const [alert, setAlert] = useState({ type: '', message: '' });
  const [confirmData, setConfirmData] = useState(null);

  const MAX_MESSAGE_LENGTH = 70;
  const VIRTEX_LENGTH = 3500;
  const COOLDOWN_SECONDS = 7;

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
      setUser(JSON.parse(savedUser));
    } else {
      // Redirect to login page
      window.location.href = '/login';
    }
  }, []);

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

  // Get all users
  useEffect(() => {
    if (!isClient) return;
    
    const fetchUsers = async () => {
      const allUsers = await getAllUsers();
      setUsers(allUsers.filter(u => u.username !== user?.username));
    };
    
    fetchUsers();
    
    // Set up listener for users status changes
    const usersRef = ref(database, 'users');
    const unsubscribeUsers = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        const usersList = Object.keys(usersData)
          .map(username => ({ username, ...usersData[username] }))
          .filter(u => u.username !== user?.username);
        setUsers(usersList);
      }
    });
    
    return () => unsubscribeUsers();
  }, [isClient, user, database]);

  // Test database connection
  useEffect(() => {
    if (!isClient) return;

    const testRef = ref(database, '.info/serverTimeOffset');

    get(testRef).then((snapshot) => {
      if (snapshot.exists()) {
        setDatabaseInfo({
          status: "connected",
          serverTimeOffset: snapshot.val()
        });
      } else {
        setDatabaseInfo({
          status: "error",
          message: "No data returned from database"
        });
      }
    }).catch((error) => {
      setDatabaseInfo({
        status: "error",
        message: error.message
      });
    });
  }, [isClient, database]);

  // Update cooldown timer
  useEffect(() => {
    if (cooldownTime > 0) {
      const timer = setTimeout(() => {
        setCooldownTime(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownTime]);

  // Auto-dismiss system notifications
  useEffect(() => {
    if (systemNotifications.length > 0) {
      const timer = setTimeout(() => {
        setSystemNotifications(prev => prev.slice(1));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [systemNotifications]);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, systemNotifications]);

  // Set up Firebase listeners
  useEffect(() => {
    if (!isClient || !user || !recipient) return;

    // Check connection status
    const connectedRef = ref(database, '.info/connected');
    const unsubscribeConnected = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val();
      setConnectionStatus(connected ? 'connected' : 'disconnected');
    });

    // Create chat room ID (sorted usernames to ensure same ID for both users)
    const chatId = [user.username, recipient.username].sort().join('_');
    const messagesRef = ref(database, `chats/${chatId}/messages`);
    
    const unsubscribeMessages = onValue(messagesRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        
        const messageList = Object.entries(data).map(([key, value]) => ({
          id: key,
          ...value
        })).sort((a, b) => {
          const timeA = a.timestamp || 0;
          const timeB = b.timestamp || 0;
          return timeA - timeB;
        });
        
        setMessages(messageList);
      } else {
        setMessages([]);
      }
    }, (error) => {
      console.error("Error fetching messages:", error);
      showAlert('error', `Error fetching messages: ${error.message}`);
    });

    return () => {
      unsubscribeConnected();
      unsubscribeMessages();
    };
  }, [isClient, user, recipient, database]);

  // Find recipient by phone number
  const findRecipient = async () => {
    if (!recipientPhone.trim()) {
      showAlert('warning', 'Please enter a phone number');
      return;
    }
    
    const foundUser = await getUserByPhone(recipientPhone);
    if (foundUser) {
      setRecipient(foundUser);
      showAlert('success', `Connected to ${foundUser.username}`);
    } else {
      showAlert('error', 'User not found with this phone number');
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();

    if (newMessage.trim() === '' || !user || !recipient) {
      showAlert('warning', "Cannot send empty message or no recipient selected");
      return;
    }

    if (newMessage.length > MAX_MESSAGE_LENGTH) {
      showAlert('error', `Message is too long! Maximum ${MAX_MESSAGE_LENGTH} characters allowed.`);
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = (now - lastMessageTime) / 1000;

    if (timeSinceLastMessage < COOLDOWN_SECONDS) {
      showAlert('warning', `Please wait ${Math.ceil(COOLDOWN_SECONDS - timeSinceLastMessage)} seconds before sending another message.`);
      return;
    }

    if (newMessage.length > VIRTEX_LENGTH) {
      showAlert('error', `Message too long! Maximum ${VIRTEX_LENGTH} characters allowed to prevent spam.`);
      return;
    }

    // Create chat room ID (sorted usernames to ensure same ID for both users)
    const chatId = [user.username, recipient.username].sort().join('_');
    const messagesRef = ref(database, `chats/${chatId}/messages`);
    const newMessageRef = push(messagesRef);

    set(newMessageRef, {
      sender: user.username,
      text: newMessage,
      timestamp: serverTimestamp()
    }).then(() => {
      setNewMessage('');
      setLastMessageTime(now);
      setCooldownTime(COOLDOWN_SECONDS);
      setError(null);
    }).catch(error => {
      console.error("Error sending message:", error);
      showAlert('error', `Error sending message: ${error.message}`);
    });
  };

  const handleMessageChange = (e) => {
    const text = e.target.value;
    if (text.length <= MAX_MESSAGE_LENGTH) {
      setNewMessage(text);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const clearMessages = () => {
    if (!user || !recipient) return;
    
    showConfirm('Are you sure you want to clear all messages?', () => {
      const chatId = [user.username, recipient.username].sort().join('_');
      const messagesRef = ref(database, `chats/${chatId}/messages`);
      set(messagesRef, null)
        .then(() => {
          showAlert('success', "Messages cleared successfully");
        })
        .catch(error => {
          showAlert('error', `Error clearing messages: ${error.message}`);
        });
      setConfirmData(null);
    });
  };

  const deleteMessage = (messageId) => {
    showConfirm('Are you sure you want to delete this message?', () => {
      const chatId = [user.username, recipient.username].sort().join('_');
      const messageRef = ref(database, `chats/${chatId}/messages/${messageId}`);
      remove(messageRef)
        .then(() => {
          showAlert('success', "Message deleted successfully");
        })
        .catch(error => {
          showAlert('error', `Error deleting message: ${error.message}`);
        });
      setConfirmData(null);
    });
  };

  const logout = () => {
    showConfirm('Are you sure you want to logout?', () => {
      if (user) {
        updateUserStatus(user.username, 'offline');
      }
      localStorage.removeItem('chatUser');
      setUser(null);
      setRecipient(null);
      setMessages([]);
      window.location.href = '/login';
      setConfirmData(null);
    });
  };

  const testConnection = () => {
    setConnectionStatus('connecting');

    const testRef = ref(database, '.info/serverTimeOffset');

    get(testRef).then((snapshot) => {
      if (snapshot.exists()) {
        setConnectionStatus('connected');
        setDatabaseInfo({
          status: "connected",
          serverTimeOffset: snapshot.val(),
          lastTest: new Date().toLocaleTimeString()
        });
        showAlert('success', 'Connection test successful');
      } else {
        setConnectionStatus('disconnected');
        setDatabaseInfo({
          status: "error",
          message: "No data returned from database",
          lastTest: new Date().toLocaleTimeString()
        });
        showAlert('error', 'Connection test failed: No data returned');
      }
    }).catch((error) => {
      setConnectionStatus('disconnected');
      setDatabaseInfo({
        status: "error",
        message: error.message,
        lastTest: new Date().toLocaleTimeString()
      });
      showAlert('error', `Connection test failed: ${error.message}`);
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
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading...</p>
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
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="flex items-center space-x-3">
              <div className="bg-white/20 p-2 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold">Chat App</h1>
            </div>
            
            <div className="flex flex-wrap gap-2 justify-center">
              <div className="flex items-center space-x-2 bg-white/20 px-3 py-1 rounded-full">
                <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
                <span className="text-sm font-medium capitalize">{connectionStatus}</span>
              </div>
              
              <button
                onClick={testConnection}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-sm transition flex items-center space-x-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Test</span>
              </button>
              
              <button
                onClick={logout}
                className="bg-red-500/80 hover:bg-red-500 px-3 py-1 rounded-full text-sm transition flex items-center space-x-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* User Info */}
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Your Profile</h2>
              <div className="flex items-center space-x-4 mt-2">
                <div className="bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 px-3 py-1 rounded-lg font-medium">
                  {user.username}
                </div>
                <div className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-lg font-medium">
                  {user.phoneNumber}
                </div>
              </div>
            </div>
            
            <div className="mt-4 md:mt-0">
              <div className="flex space-x-2">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    activeTab === 'chat'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab('contacts')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    activeTab === 'contacts'
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  Contacts
                </button>
              </div>
            </div>
          </div>
        </div>

        {activeTab === 'chat' ? (
          <>
            {/* Recipient Input */}
            <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
              <label className="block mb-2 text-gray-700 dark:text-gray-300 font-semibold">Chat with:</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  placeholder="Enter phone number (08xx)"
                />
                <button
                  onClick={findRecipient}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  Connect
                </button>
              </div>
              
              {recipient && (
                <div className="mt-3 flex items-center space-x-2">
                  <span className="text-gray-700 dark:text-gray-300">Connected to:</span>
                  <div className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-lg font-medium">
                    {recipient.username} ({recipient.phoneNumber})
                  </div>
                  <div className={`flex items-center ${recipient.status === 'online' ? 'text-green-500' : 'text-gray-500'}`}>
                    <div className={`w-2 h-2 rounded-full mr-1 ${recipient.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                    <span className="text-xs capitalize">{recipient.status}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Container */}
            {recipient ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden mb-6">
                {/* Messages Header */}
                <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                    Chat with {recipient.username}
                  </h2>
                  <div className="flex space-x-2">
                    {cooldownTime > 0 && (
                      <div className="text-sm bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-3 py-1 rounded-full font-medium">
                        Cooldown: {cooldownTime}s
                      </div>
                    )}
                    <button
                      onClick={clearMessages}
                      className="text-sm bg-red-500/80 hover:bg-red-500 px-3 py-1 rounded-full text-white transition flex items-center space-x-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      <span>Clear</span>
                    </button>
                  </div>
                </div>

                {/* Messages Area */}
                <div className="h-80 md:h-96 overflow-y-auto p-4 bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                      <p className="text-center">No messages yet. Start a conversation!</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.sender === user.username ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-xs md:max-w-md px-4 py-3 rounded-2xl shadow-sm ${
                              message.sender === user.username
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-br-none'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white rounded-bl-none'
                            } relative`}
                          >
                            <div className="whitespace-pre-wrap break-words">{message.text}</div>
                            <div
                              className={`text-xs mt-1 ${
                                message.sender === user.username
                                  ? 'text-indigo-200'
                                  : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              {formatTime(message.timestamp)}
                            </div>
                            
                            {/* Message Actions */}
                            <div className="absolute -bottom-5 right-0 flex space-x-2 opacity-0 hover:opacity-100 transition-opacity">
                              {message.sender === user.username && (
                                <button
                                  onClick={() => deleteMessage(message.id)}
                                  className="text-xs bg-gray-500 text-white px-2 py-1 rounded-full hover:bg-gray-600 transition"
                                  title="Delete message"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Message Input */}
                <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                  <form onSubmit={handleSendMessage}>
                    <div className="mb-2 flex justify-between text-sm text-gray-500 dark:text-gray-400">
                      <div>
                        {newMessage.length}/{MAX_MESSAGE_LENGTH} characters
                      </div>
                      <div className={newMessage.length > MAX_MESSAGE_LENGTH * 0.8 ? 'text-orange-500' : ''}>
                        {Math.round((newMessage.length / MAX_MESSAGE_LENGTH) * 100)}%
                      </div>
                    </div>
                    
                    <div className="flex space-x-2">
                      <div className="flex-1 relative">
                        <textarea
                          value={newMessage}
                          onChange={handleMessageChange}
                          placeholder="Type your message here..."
                          rows={2}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none transition pr-20"
                        />
                        <div className="absolute right-2 bottom-2">
                          <button
                            type="submit"
                            disabled={cooldownTime > 0 || newMessage.trim() === ''}
                            className={`px-4 py-2 rounded-lg font-medium ${
                              cooldownTime > 0 || newMessage.trim() === ''
                                ? 'bg-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition shadow-md'
                            } text-white flex items-center space-x-1`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            <span>Send</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden mb-6 p-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">No Recipient Selected</h3>
                <p className="text-gray-500 dark:text-gray-400 mb-4">Enter a phone number to start chatting</p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Contacts List */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden mb-6">
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
                <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                  Contacts ({users.length})
                </h2>
              </div>
              
              <div className="overflow-y-auto max-h-96">
                {users.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 py-8">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <p className="text-center">No contacts found</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {users.map((contact) => (
                      <div key={contact.username} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-750 transition">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="relative">
                              <div className="w-12 h-12 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-800 dark:text-indigo-200 font-bold">
                                {contact.username.charAt(0).toUpperCase()}
                              </div>
                              <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${contact.status === 'online' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                            </div>
                            <div>
                              <h3 className="font-medium text-gray-900 dark:text-white">{contact.username}</h3>
                              <p className="text-sm text-gray-500 dark:text-gray-400">{contact.phoneNumber}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setRecipient(contact);
                              setRecipientPhone(contact.phoneNumber);
                              setActiveTab('chat');
                            }}
                            className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition"
                          >
                            Chat
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Info Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Database Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
            <h3 className="font-bold text-lg mb-3 text-gray-700 dark:text-gray-300 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              Database Status
            </h3>
            {databaseInfo ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className={databaseInfo.status === 'connected' ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
                    {databaseInfo.status}
                  </span>
                </div>
                {databaseInfo.serverTimeOffset !== undefined && (
                  <div className="flex justify-between">
                    <span>Time Offset:</span>
                    <span>{databaseInfo.serverTimeOffset} ms</span>
                  </div>
                )}
                {databaseInfo.message && (
                  <div className="flex justify-between">
                    <span>Error:</span>
                    <span className="text-red-500 text-xs">{databaseInfo.message}</span>
                  </div>
                )}
                {databaseInfo.lastTest && (
                  <div className="flex justify-between">
                    <span>Last Test:</span>
                    <span>{databaseInfo.lastTest}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">Loading database info...</p>
            )}
          </div>

          {/* Connection Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4">
            <h3 className="font-bold text-lg mb-3 text-gray-700 dark:text-gray-300 flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Connection Info
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Connection:</span>
                <span className="capitalize">{connectionStatus}</span>
              </div>
              <div className="flex justify-between">
                <span>Messages:</span>
                <span>{messages.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Username:</span>
                <span className="truncate max-w-[120px]">{user.username}</span>
              </div>
              <div className="flex justify-between">
                <span>Phone:</span>
                <span className="truncate max-w-[120px]">{user.phoneNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Last Message:</span>
                <span>{lastMessageTime ? new Date(lastMessageTime).toLocaleTimeString() : 'Never'}</span>
              </div>
              {error && (
                <div className="flex justify-between">
                  <span>Error:</span>
                  <span className="text-red-500 truncate max-w-[150px]">{error}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-8 py-4 text-center text-gray-500 dark:text-gray-400 text-sm">
        <p>Realtime Chat App • Built with React & Firebase</p>
      </footer>
    </div>
  );
}
