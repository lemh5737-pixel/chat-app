import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ref, onValue, serverTimestamp, set, remove, update, get } from 'firebase/database';
import { database } from '../lib/firebase';
import { getUserByPhone, updateUserStatus } from '../lib/auth';
import CustomAlert from '../components/CustomAlert';

export default function ChatPage() {
  const router = useRouter();
  const { recipientPhone } = router.query;
  
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [isClient, setIsClient] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [databaseInfo, setDatabaseInfo] = useState(null);
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

  // Find recipient by phone number
  useEffect(() => {
    if (!isClient || !user || !recipientPhone) return;
    
    const findRecipient = async () => {
      try {
        const foundUser = await getUserByPhone(recipientPhone);
        if (foundUser) {
          setRecipient(foundUser);
        } else {
          showAlert('error', 'User not found with this phone number');
          router.push('/');
        }
      } catch (error) {
        console.error("Error finding recipient:", error);
        showAlert('error', `Error: ${error.message}`);
        router.push('/');
      }
    };
    
    findRecipient();
  }, [isClient, user, recipientPhone, router]);

  // Test database connection
  useEffect(() => {
    if (!isClient) return;

    const testRef = ref(database, '.info/serverTimeOffset');

    const testConnection = async () => {
      try {
        const snapshot = await get(testRef);
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
      } catch (error) {
        setDatabaseInfo({
          status: "error",
          message: error.message
        });
      }
    };
    
    testConnection();
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

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  // Update or add chat history
  const updateChatHistory = async (messageText) => {
    if (!user || !recipient) return;
    
    try {
      const chatHistoryRef = ref(database, `users/${user.username}/chatHistory/${recipient.phoneNumber}`);
      
      await update(chatHistoryRef, {
        username: recipient.username,
        phoneNumber: recipient.phoneNumber,
        lastMessage: messageText,
        lastMessageTime: Date.now()
      });
    } catch (error) {
      console.error("Error updating chat history:", error);
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
      // Update chat history
      updateChatHistory(newMessage);
      
      setNewMessage('');
      setLastMessageTime(now);
      setCooldownTime(COOLDOWN_SECONDS);
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

  const goBack = () => {
    router.push('/');
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

  if (!user || !recipient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading chat...</p>
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
                onClick={goBack}
                className="bg-white/20 p-2 rounded-full hover:bg-white/30 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div className="bg-white/20 p-2 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold">Chat with {recipient.username}</h1>
            </div>
            
            <div className="flex items-center space-x-2 bg-white/20 px-3 py-1 rounded-full">
              <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'} animate-pulse`}></div>
              <span className="text-sm font-medium capitalize">{connectionStatus}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Chat Container */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden mb-6">
          {/* Messages Header */}
          <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <div className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-3 py-1 rounded-lg font-medium">
                {recipient.username} ({recipient.phoneNumber})
              </div>
              <div className={`flex items-center ${recipient.status === 'online' ? 'text-green-500' : 'text-gray-500'}`}>
                <div className={`w-2 h-2 rounded-full mr-1 ${recipient.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                <span className="text-xs capitalize">{recipient.status}</span>
              </div>
            </div>
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
      </main>
    </div>
  );
}
